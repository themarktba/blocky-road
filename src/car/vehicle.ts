import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import type { DriveInput } from '../core/input';
import type { Debris } from '../world/debris';
import type { BodyBlock, CarConfig, Vec3, WheelMount } from './carConfig';
import { connectedSet } from './parts';
import { addPartDetails } from './partVisuals';
import { maxAmmo } from './parts';
import { orientationQuat } from './orientation';

/** A block of the car body: collider + mesh + health. */
export interface CarBlockInstance {
  block: BodyBlock;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  hp: number;
  attached: boolean;
  baseColor: THREE.Color;
  /** Weapons: seconds until it can hit/fire again, and shots left (ranged). */
  cooldown: number;
  ammo: number;
}

interface WheelInstance {
  mount: WheelMount;
  attached: boolean;
  hp: number;
  /** Moves up/down with suspension and turns with steering. */
  pivot: THREE.Object3D;
  /** Spins with wheel rotation. */
  spinner: THREE.Object3D;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Brake values in CONFIG are tuned for a car of this mass and scaled for others. */
const BRAKE_REFERENCE_MASS = 200;
const DAMAGED_COLOR = new THREE.Color('#2b1d1a');

/**
 * A physics car built from a CarConfig, using Rapier's ray-cast vehicle controller.
 * Chassis = one dynamic rigid body with one box collider per body block.
 * Wheels  = rays with springs (no wheel colliders), drawn as cylinders.
 *
 * Damage: each block and wheel has hit points. When a block runs out it breaks off,
 * and anything no longer connected to a cabin breaks off with it.
 */
export class Vehicle {
  readonly config: CarConfig;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  /** Visual root – follows the rigid body. */
  readonly group = new THREE.Group();
  readonly blocks: CarBlockInstance[] = [];
  private wheels: WheelInstance[] = [];
  private byCollider = new Map<number, CarBlockInstance>();
  private steering = 0;
  private maxHp = 0;
  /** Spinning bits (saw blades). */
  private spinners: THREE.Object3D[] = [];

  /** Throttle actually applied last step (0..1), used for fuel burn. */
  appliedThrottle = 0;

  constructor(private world: RAPIER.World, config: CarConfig, spawn: THREE.Vector3, private debris: Debris) {
    this.config = config;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    // Rapier uses axis indices: 0 = X, 1 = Y, 2 = Z. Our car's forward is +Z.
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    for (const block of config.blocks) this.addBlock(block);
    this.setupWheels();
    this.applyMassTuning();
    this.applyTuning();
    this.refillAmmo(1); // start with full guns (including ammo box bonus)
  }

  // -------------------------------------------------------------------------
  // Live stats (change as parts break off)
  // -------------------------------------------------------------------------

  get enginePower(): number {
    return this.blocks.reduce((sum, b) => sum + (b.attached ? b.block.enginePower : 0), 0);
  }

  get fuelCapacity(): number {
    return this.blocks.reduce((sum, b) => sum + (b.attached ? b.block.fuelCapacity : 0), 0);
  }

  /** Extra ammo (percent) from ammo boxes still attached. */
  get ammoBonus(): number {
    return this.blocks.reduce((sum, b) => sum + (b.attached ? b.block.ammoBonus : 0), 0);
  }

  /** Most shots this ranged weapon can hold right now. */
  maxAmmo(inst: CarBlockInstance): number {
    return maxAmmo(inst.block.weapon?.ammo ?? 0, this.ammoBonus);
  }

  /** Give every ranged weapon `fraction` of its max ammo (never above max). */
  refillAmmo(fraction: number) {
    for (const w of this.weapons) {
      if (w.block.weapon!.type !== 'ranged') continue;
      const max = this.maxAmmo(w);
      w.ammo = Math.min(max, w.ammo + Math.ceil(max * fraction));
    }
  }

  /** After an ammo box breaks off, guns can't hold more than the new max. */
  clampAmmo() {
    for (const w of this.weapons) w.ammo = Math.min(w.ammo, this.maxAmmo(w));
  }

  get mass(): number {
    return this.body.mass();
  }

  get hasCabin(): boolean {
    return this.blocks.some((b) => b.attached && b.block.category === 'cabin');
  }

  /** 0..1 – how much of the car's total hit points are left. */
  get integrity(): number {
    let hp = 0;
    for (const b of this.blocks) if (b.attached) hp += Math.max(0, b.hp);
    for (const w of this.wheels) if (w.attached) hp += Math.max(0, w.hp);
    return this.maxHp > 0 ? hp / this.maxHp : 0;
  }

  /** Weapon parts still attached. */
  get weapons(): CarBlockInstance[] {
    return this.blocks.filter((b) => b.attached && b.block.weapon);
  }

  /** Car-space point → world point. */
  toWorld(local: THREE.Vector3): THREE.Vector3 {
    return local.clone().applyQuaternion(this.quaternion).add(this.position);
  }

  /** Direction the car is facing, in world space. */
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
  }

  /** Is this collider part of the car? */
  blockByCollider(handle: number): CarBlockInstance | undefined {
    return this.byCollider.get(handle);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /**
   * Push suspension/tire/damping values from CONFIG into the physics.
   * Called every step, so tweaking CONFIG in the browser console works live.
   */
  applyTuning() {
    const s = CONFIG.suspension;
    const t = CONFIG.tires;
    const c = this.controller;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      if (!w.attached) continue;
      c.setWheelSuspensionRestLength(i, s.restLength);
      c.setWheelSuspensionStiffness(i, s.stiffness);
      c.setWheelSuspensionCompression(i, s.compression);
      c.setWheelSuspensionRelaxation(i, s.relaxation);
      c.setWheelMaxSuspensionTravel(i, s.maxTravel);
      c.setWheelMaxSuspensionForce(i, s.maxForce);
      c.setWheelFrictionSlip(i, t.frictionSlip * w.mount.grip);
      c.setWheelSideFrictionStiffness(i, t.sideFrictionStiffness * w.mount.grip);
    }
    this.body.setLinearDamping(CONFIG.chassis.linearDamping);
    this.body.setAngularDamping(CONFIG.chassis.angularDamping);
  }

  /**
   * Wheels have no colliders, so their mass is added here as "additional mass".
   * We place it low to drop the center of mass, and add extra rotational inertia,
   * both from CONFIG.chassis. This makes the car less tippy (arcade cheat).
   * Re-run whenever parts break off. Call game.vehicle.applyMassTuning() after changing those values.
   */
  applyMassTuning() {
    const { extraInertia, centerOfMassDrop } = CONFIG.chassis;
    const blocks = this.blocks.filter((b) => b.attached).map((b) => b.block);
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const b of blocks) {
      m += b.mass;
      cx += b.center[0] * b.mass; cy += b.center[1] * b.mass; cz += b.center[2] * b.mass;
    }
    const wheelMass = this.wheels.reduce((s, w) => s + (w.attached ? w.mount.mass : 0), 0);
    const extraMass = Math.max(1, wheelMass);
    if (m === 0) {
      this.body.setAdditionalMassProperties(extraMass, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0, w: 1 }, true);
      return;
    }
    cx /= m; cy /= m; cz /= m;
    let ix = 0, iy = 0, iz = 0;
    for (const b of blocks) {
      const [sx, sy, sz] = b.size;
      const dx = b.center[0] - cx, dy = b.center[1] - cy, dz = b.center[2] - cz;
      ix += (b.mass / 12) * (sy * sy + sz * sz) + b.mass * (dy * dy + dz * dz);
      iy += (b.mass / 12) * (sx * sx + sz * sz) + b.mass * (dx * dx + dz * dz);
      iz += (b.mass / 12) * (sx * sx + sy * sy) + b.mass * (dx * dx + dy * dy);
    }
    const total = m + extraMass;
    // Where to put the extra mass so the combined center of mass drops by centerOfMassDrop.
    const extraY = cy - (centerOfMassDrop * total) / extraMass;
    this.body.setAdditionalMassProperties(
      extraMass,
      { x: cx, y: extraY, z: cz },
      { x: ix * extraInertia, y: iy * extraInertia, z: iz * extraInertia },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  private addBlock(block: BodyBlock) {
    const [sx, sy, sz] = block.size;
    const [cx, cy, cz] = block.center;
    const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(cx, cy, cz)
      .setMass(block.mass)
      .setFriction(CONFIG.chassis.bodyFriction)
      .setRestitution(0.1)
      // Report hard hits so we can apply damage.
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CONFIG.damage.impulseThreshold * CONFIG.physics.stepHz);
    const collider = this.world.createCollider(desc, this.body);

    const baseColor = new THREE.Color(block.color);
    // The mesh is built as designed and then turned, so details (spikes, barrels) turn with it.
    const [bx, by, bz] = block.baseSize;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(bx, by, bz),
      new THREE.MeshLambertMaterial({ color: baseColor.clone(), flatShading: true }),
    );
    mesh.position.set(cx, cy, cz);
    mesh.quaternion.copy(orientationQuat(block.orient));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Thin dark outline for the blocky look.
    mesh.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: '#000', transparent: true, opacity: 0.35 }),
    ));
    addPartDetails(mesh, block.partId, block.baseSize);
    mesh.traverse((o) => {
      if (o.userData.spin) this.spinners.push(o);
    });
    this.group.add(mesh);
    const inst: CarBlockInstance = {
      block, collider, mesh, hp: block.hp, attached: true, baseColor,
      cooldown: 0, ammo: block.weapon?.ammo ?? 0,
    };
    this.blocks.push(inst);
    this.byCollider.set(collider.handle, inst);
    this.maxHp += block.hp;
  }

  private setupWheels() {
    const s = CONFIG.suspension;
    const tireMat = new THREE.MeshLambertMaterial({ color: '#222', flatShading: true });
    const hubMat = new THREE.MeshLambertMaterial({ color: '#d9d9d9', flatShading: true });

    this.config.wheels.forEach((w) => {
      const [x, y, z] = w.position;
      this.controller.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, s.restLength, w.radius);

      // Visual: pivot (suspension + steering) → spinner (roll) → low-poly cylinder (axis along X).
      const pivot = new THREE.Object3D();
      const spinner = new THREE.Object3D();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, w.width, 10), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      const hub = new THREE.Mesh(new THREE.BoxGeometry(w.width + 0.02, w.radius * 0.6, w.radius * 0.6), hubMat);
      spinner.add(tire, hub);
      pivot.add(spinner);
      pivot.position.set(x, y - s.restLength, z);
      this.group.add(pivot);
      const hp = CONFIG.damage.baseHp;
      this.wheels.push({ mount: w, attached: true, hp, pivot, spinner });
      this.maxHp += hp;
    });
  }

  // -------------------------------------------------------------------------
  // Driving
  // -------------------------------------------------------------------------

  /** Forward speed in m/s (negative when reversing). */
  get forwardSpeed(): number {
    return this.controller.currentVehicleSpeed();
  }

  /** Total speed in m/s. */
  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  get position(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  get quaternion(): THREE.Quaternion {
    const q = this.body.rotation();
    return new THREE.Quaternion(q.x, q.y, q.z, q.w);
  }

  get wheelsOnGround(): number {
    let n = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      if (this.wheels[i].attached && this.controller.wheelIsInContact(i)) n++;
    }
    return n;
  }

  /**
   * Apply driving input and update the vehicle controller.
   * Call once per physics step, BEFORE world.step().
   */
  physicsStep(dt: number, input: DriveInput, hasFuel: boolean) {
    const d = CONFIG.driving;
    const c = this.controller;
    const speed = this.forwardSpeed;
    const massScale = this.mass / BRAKE_REFERENCE_MASS;
    this.applyTuning();

    // Steering: smooth toward target, and less steering at high speed.
    const speedT = Math.min(1, Math.abs(speed) / d.steerFalloffSpeed);
    const maxSteer = d.maxSteer * (1 - speedT * (1 - d.highSpeedSteerFactor));
    // Our +X is the car's left, so "steer right" is a negative angle.
    const targetSteer = -input.steer * maxSteer;
    this.steering += (targetSteer - this.steering) * Math.min(1, d.steerSpeed * dt);

    const power = this.enginePower * d.engineForceScale;
    const canDrive = hasFuel && power > 0;
    let engine = 0;
    // Rolling resistance. Without an engine there's nothing to coast with, so the car slows faster.
    let brake = d.idleBrake * massScale * (canDrive ? 1 : d.noFuelBrakeMultiplier);
    this.appliedThrottle = 0;

    if (input.throttle > 0) {
      if (speed < -1) {
        // Rolling backwards: W brakes first.
        brake = d.brakeForce * massScale;
      } else if (canDrive) {
        brake = 0;
        // Fade engine force out as we approach top speed.
        const fade = Math.max(0, 1 - Math.max(0, speed) / d.topSpeed);
        engine = power * input.throttle * fade;
        this.appliedThrottle = input.throttle;
      }
    } else if (input.throttle < 0) {
      if (speed > 1 || !canDrive) {
        // Moving forward (or can't reverse): S brakes.
        brake = d.brakeForce * massScale;
      } else {
        brake = 0;
        const fade = Math.max(0, 1 - Math.max(0, -speed) / (d.topSpeed * 0.4));
        engine = -power * d.reverseFactor * fade;
        this.appliedThrottle = d.reverseFactor;
      }
    }

    const driven = this.wheels
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.attached && (d.drive === 'all' || (d.drive === 'front' ? w.mount.isFront : !w.mount.isFront)));
    const perWheel = driven.length ? engine / driven.length : 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      c.setWheelSteering(i, w.attached && w.mount.steers ? this.steering : 0);
      c.setWheelEngineForce(i, driven.some((x) => x.i === i) ? perWheel : 0);
      c.setWheelBrake(i, w.attached ? brake : 0);
    }

    // A little air control: W/S pitches the car while all wheels are off the ground.
    if (d.airPitchAccel > 0 && input.throttle !== 0 && this.wheelsOnGround === 0) {
      const inertia = this.body.principalInertia();
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
      const impulse = axis.multiplyScalar(input.throttle * d.airPitchAccel * inertia.x * dt);
      this.body.applyTorqueImpulse(impulse, true);
    }

    c.updateVehicle(dt);
  }

  // -------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------

  /**
   * A hard contact on one of our colliders. `force` is the contact force over one physics step.
   * Returns names of parts that broke off. `multiplier` > 1 for enemy hits.
   */
  applyImpact(colliderHandle: number, force: number, multiplier = 1): string[] {
    const inst = this.byCollider.get(colliderHandle);
    if (!inst || !inst.attached) return [];
    const d = CONFIG.damage;
    const impulse = force / CONFIG.physics.stepHz;
    const excess = impulse - d.impulseThreshold;
    if (excess <= 0) return [];
    // Melee weapons are built for hitting things.
    if (inst.block.weapon?.type === 'melee') multiplier *= CONFIG.weapons.meleeSelfDamage;
    return this.damageBlock(inst, Math.min(d.maxHitDamage, excess * d.damagePerImpulse * multiplier));
  }

  /** Explosion damage: everything within `radius` of a world point, fading quickly with distance. */
  damageArea(point: THREE.Vector3, radius: number, damage: number): string[] {
    const lost: string[] = [];
    const toWorld = (local: Vec3) => new THREE.Vector3(...local).applyQuaternion(this.quaternion).add(this.position);
    for (const b of this.blocks) {
      if (!b.attached) continue;
      const d = toWorld(b.block.center).distanceTo(point);
      if (d < radius) lost.push(...this.damageBlock(b, damage * (1 - d / radius) ** 2));
    }
    for (const w of this.wheels) {
      if (!w.attached) continue;
      const d = toWorld(w.mount.position).distanceTo(point);
      if (d < radius) {
        w.hp -= damage * (1 - d / radius) ** 2;
        if (w.hp <= 0) {
          this.detachWheel(w);
          lost.push(w.mount.name);
        }
      }
    }
    if (lost.length) lost.push(...this.dropDisconnected());
    if (lost.length) this.applyMassTuning();
    return lost;
  }

  private damageBlock(inst: CarBlockInstance, amount: number): string[] {
    if (!inst.attached || amount <= 0) return [];
    inst.hp -= amount;
    // Darken as it gets damaged.
    const health = Math.max(0, inst.hp / inst.block.hp);
    (inst.mesh.material as THREE.MeshLambertMaterial).color.copy(inst.baseColor).lerp(DAMAGED_COLOR, (1 - health) * 0.75);
    if (inst.hp > 0) return [];
    this.detachBlock(inst);
    const lost = [inst.block.name, ...this.dropDisconnected()];
    this.applyMassTuning();
    return lost;
  }

  /** Breaks off every block and wheel that's no longer connected to a cabin. */
  private dropDisconnected(): string[] {
    const blocks = this.blocks.filter((b) => b.attached);
    const wheels = this.wheels.filter((w) => w.attached);
    const boxes = [
      ...blocks.map((b) => ({ cell: b.block.cell, cells: b.block.cells })),
      ...wheels.map((w) => ({ cell: w.mount.cell, cells: [1, 1, 1] as Vec3 })),
    ];
    const cabins = blocks.map((b, i) => (b.block.category === 'cabin' ? i : -1)).filter((i) => i >= 0);
    if (cabins.length === 0) return []; // Wrecked anyway – leave the rest.
    const keep = connectedSet(boxes, cabins);
    const lost: string[] = [];
    blocks.forEach((b, i) => {
      if (!keep.has(i)) {
        this.detachBlock(b);
        lost.push(b.block.name);
      }
    });
    wheels.forEach((w, i) => {
      if (!keep.has(blocks.length + i)) {
        this.detachWheel(w);
        lost.push(w.mount.name);
      }
    });
    return lost;
  }

  /** Velocity of a point on the car (for debris to fly off naturally). */
  private velocityAt(worldPoint: THREE.Vector3) {
    const v = this.body.linvel();
    const w = this.body.angvel();
    const r = worldPoint.clone().sub(this.position);
    const cross = new THREE.Vector3(w.x, w.y, w.z).cross(r);
    return { x: v.x + cross.x, y: v.y + cross.y + 2, z: v.z + cross.z };
  }

  private randomSpin() {
    return { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 };
  }

  private detachBlock(inst: CarBlockInstance) {
    if (!inst.attached) return;
    inst.attached = false;
    this.byCollider.delete(inst.collider.handle);
    this.world.removeCollider(inst.collider, true);
    const worldPos = new THREE.Vector3(...inst.block.center).applyQuaternion(this.quaternion).add(this.position);
    const [sx, sy, sz] = inst.block.baseSize; // debris keeps the mesh's own (turned) frame
    this.debris.spawn(
      inst.mesh,
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setMass(inst.block.mass),
      this.velocityAt(worldPos),
      this.randomSpin(),
    );
  }

  private detachWheel(w: WheelInstance) {
    if (!w.attached) return;
    w.attached = false;
    const i = this.wheels.indexOf(w);
    // The controller can't remove wheels, so make this one do nothing.
    const c = this.controller;
    c.setWheelSuspensionRestLength(i, 0.001);
    c.setWheelMaxSuspensionTravel(i, 0.001);
    c.setWheelMaxSuspensionForce(i, 0);
    c.setWheelRadius(i, 0.001);
    c.setWheelFrictionSlip(i, 0);
    c.setWheelSideFrictionStiffness(i, 0);
    c.setWheelEngineForce(i, 0);
    // The cylinder collider's axis is Y; the tire's axis is the pivot's X.
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const worldPos = new THREE.Vector3().setFromMatrixPosition(w.pivot.matrixWorld);
    this.debris.spawn(
      w.pivot,
      RAPIER.ColliderDesc.cylinder(w.mount.width / 2, w.mount.radius).setRotation(rot).setMass(w.mount.mass),
      this.velocityAt(worldPos),
      this.randomSpin(),
    );
  }

  // -------------------------------------------------------------------------
  // Visuals & housekeeping
  // -------------------------------------------------------------------------

  /** Copy physics state to the meshes. Call once per rendered frame. */
  syncVisuals(dt = 0) {
    for (const s of this.spinners) s.rotation.x += dt * 25;
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
    const s = CONFIG.suspension;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      if (!w.attached) continue;
      const mount = w.mount.position;
      const len = this.controller.wheelSuspensionLength(i) ?? s.restLength;
      w.pivot.position.set(mount[0], mount[1] - len, mount[2]);
      w.pivot.quaternion.setFromAxisAngle(UP, this.controller.wheelSteering(i) ?? 0);
      w.spinner.rotation.x = this.controller.wheelRotation(i) ?? 0;
    }
    this.group.updateMatrixWorld();
  }

  /** Put the car upright at a position, facing a heading (radians around Y), and stop it. */
  placeAt(position: THREE.Vector3, heading = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    this.body.setTranslation(position, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steering = 0;
  }

  /** Remove from physics and the scene. */
  dispose() {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
    this.group.removeFromParent();
  }
}
