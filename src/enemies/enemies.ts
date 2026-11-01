import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import { createRng } from '../core/random';
import { scaled } from '../game/difficulty';
import type { Destroyed, Target } from '../game/targets';
import { featureAt, groundHeightAt, roadCenterX, roadHeight } from '../world/road';

/** A spiked ball that rolls at the car. Physics-driven, so hits are real collisions. */
interface Roller {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Group;
  hp: number;
  target: Target;
}

/** A drone that flies above the car and drops bombs. No physics body. */
interface Drone {
  mesh: THREE.Group;
  rotors: THREE.Object3D[];
  pos: THREE.Vector3;
  bombsLeft: number;
  bombTimer: number;
  state: 'approach' | 'attack' | 'leave';
  age: number;
  /** Each drone holds its own spot around the car so several don't stack up. */
  offset: THREE.Vector3;
  phase: number;
  hp: number;
  target: Target;
}

interface Bomb {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  /** Red ring on the ground where the bomb will land. */
  marker: THREE.Mesh;
  age: number;
}

/** What the car looks like to enemies. */
export interface EnemyTarget {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

export interface EnemyEvents {
  /** Bombs that went off this frame. */
  explosions: THREE.Vector3[];
  /** Enemies destroyed this frame. */
  killed: Destroyed[];
}

/**
 * Spawns and runs enemies. Add new enemy types here:
 * give them a spawn rule in update() and their own update function.
 */
export class Enemies {
  readonly group = new THREE.Group();
  private rollers: Roller[] = [];
  private rollerByCollider = new Map<number, Roller>();
  private drones: Drone[] = [];
  private bombs: Bomb[] = [];
  private nextRollerZ = 0;
  private nextDroneZ = 0;
  private rng = createRng(CONFIG.road.seed + 77);
  private killedThisFrame: Destroyed[] = [];

  private rollerGeo = new THREE.IcosahedronGeometry(CONFIG.enemies.rollerRadius, 0);
  private spikeGeo = new THREE.ConeGeometry(0.2, 0.6, 4);
  private bombGeo = new THREE.IcosahedronGeometry(0.28, 0);
  private markerGeo = new THREE.RingGeometry(1.2, 1.6, 16).rotateX(-Math.PI / 2);
  private mats = {
    roller: new THREE.MeshLambertMaterial({ color: '#5c1a1b', flatShading: true }),
    spike: new THREE.MeshLambertMaterial({ color: '#c9c9c9', flatShading: true }),
    drone: new THREE.MeshLambertMaterial({ color: '#2b2d42', flatShading: true }),
    droneEye: new THREE.MeshBasicMaterial({ color: '#ff4d4d' }),
    rotor: new THREE.MeshLambertMaterial({ color: '#8d99ae' }),
    bomb: new THREE.MeshLambertMaterial({ color: '#111', emissive: '#550000', flatShading: true }),
    marker: new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.8, depthWrite: false }),
  };

  constructor(private world: RAPIER.World) {
    this.reset();
  }

  reset() {
    for (const r of this.rollers) this.removeRoller(r);
    for (const d of this.drones) d.mesh.removeFromParent();
    for (const b of this.bombs) this.removeBomb(b);
    this.rollers = [];
    this.drones = [];
    this.bombs = [];
    this.rng = createRng(CONFIG.road.seed + 77);
    this.nextRollerZ = CONFIG.enemies.rollerStartZ;
    this.nextDroneZ = CONFIG.enemies.droneStartZ;
  }

  /** Everything weapons can hit. */
  get targets(): Target[] {
    return [...this.rollers.map((r) => r.target), ...this.drones.map((d) => d.target)];
  }

  isRoller(colliderHandle: number): boolean {
    return this.rollerByCollider.has(colliderHandle);
  }

  /** A hard hit on a roller (force over one physics step): destroy it if strong enough. */
  hitRoller(colliderHandle: number, force: number) {
    const r = this.rollerByCollider.get(colliderHandle);
    if (r && force / CONFIG.physics.stepHz > CONFIG.enemies.rollerKillImpulse) this.killRoller(r);
  }

  update(dt: number, target: EnemyTarget, spawning: boolean): EnemyEvents {
    const e = CONFIG.enemies;
    const carZ = target.position.z;
    const explosions: THREE.Vector3[] = [];

    // Spawning: rollers appear ahead of the car, drones fly in from behind.
    if (spawning) {
      if (carZ + 90 > this.nextRollerZ) {
        let z = this.nextRollerZ;
        while (featureAt(z)) z += 10;
        this.spawnRoller(z);
        this.nextRollerZ += this.rng.range(e.rollerSpacingMin, e.rollerSpacingMax);
      }
      // Drones come more often, and more of them at once, the farther you get.
      const maxDrones = Math.round(scaled(CONFIG.difficulty.maxDrones, carZ));
      if (carZ > this.nextDroneZ && this.drones.length < maxDrones) {
        this.spawnDrone(target.position);
        this.nextDroneZ = carZ + scaled(CONFIG.difficulty.droneSpacing, carZ) * this.rng.range(0.75, 1.25);
      }
    }

    for (const r of [...this.rollers]) this.updateRoller(r, dt, target);
    for (const d of [...this.drones]) this.updateDrone(d, dt, target);

    // Bombs: explode on touching the ground or the car, or after a while.
    for (const b of [...this.bombs]) {
      b.age += dt;
      const p = b.body.translation();
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.rotation.x += dt * 5;
      b.marker.scale.setScalar(1 + Math.sin(b.age * 18) * 0.12);
      const pos = new THREE.Vector3(p.x, p.y, p.z);
      const nearCar = pos.distanceTo(target.position) < 1.8;
      const onGround = p.y < groundHeightAt(p.x, p.z) + 0.35;
      if (nearCar || onGround || b.age > 6) {
        explosions.push(pos);
        this.removeBomb(b);
      }
    }

    const killed = this.killedThisFrame;
    this.killedThisFrame = [];
    return { explosions, killed };
  }

  // -------------------------------------------------------------------------
  // Rollers
  // -------------------------------------------------------------------------

  private spawnRoller(z: number) {
    const e = CONFIG.enemies;
    const x = roadCenterX(z) + this.rng.range(-3, 3);
    const y = roadHeight(z) + e.rollerRadius + 0.5;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setAngularDamping(0.5).setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(e.rollerRadius).setMass(e.rollerMass).setFriction(1.2).setRestitution(0.3),
      body,
    );
    const mesh = new THREE.Group();
    const core = new THREE.Mesh(this.rollerGeo, this.mats.roller);
    core.castShadow = true;
    mesh.add(core);
    // A spike on every corner of the icosahedron.
    const pos = this.rollerGeo.getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const key = v.toArray().map((n) => n.toFixed(2)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      const spike = new THREE.Mesh(this.spikeGeo, this.mats.spike);
      spike.position.copy(v).multiplyScalar(1.05);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      mesh.add(spike);
    }
    this.group.add(mesh);
    const roller: Roller = {
      body, collider, mesh, hp: e.rollerHp,
      target: {
        kind: 'roller',
        radius: e.rollerRadius + 0.3,
        position: () => {
          const t = body.translation();
          return new THREE.Vector3(t.x, t.y, t.z);
        },
        alive: () => this.rollers.includes(roller),
        hit: (amount) => {
          if (!this.rollers.includes(roller)) return false;
          roller.hp -= amount;
          if (roller.hp > 0) return false;
          this.killRoller(roller);
          return true;
        },
      },
    };
    this.rollers.push(roller);
    this.rollerByCollider.set(collider.handle, roller);
  }

  private updateRoller(r: Roller, dt: number, target: EnemyTarget) {
    const e = CONFIG.enemies;
    const p = r.body.translation();
    const q = r.body.rotation();
    r.mesh.position.set(p.x, p.y, p.z);
    r.mesh.quaternion.set(q.x, q.y, q.z, q.w);

    // Despawn when far behind the car or fallen off the world.
    if (p.z < target.position.z - 60 || p.y < groundHeightAt(p.x, p.z) - 20) {
      this.removeRoller(r);
      return;
    }
    // Only active when the car is near.
    if (Math.abs(p.z - target.position.z) > 70) return;

    // Push toward where the car will be in a moment.
    const aim = target.position.clone().addScaledVector(target.velocity, 0.4);
    const dir = new THREE.Vector3(aim.x - p.x, 0, aim.z - p.z);
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    const v = r.body.linvel();
    const along = v.x * dir.x + v.z * dir.z;
    if (along < e.rollerSpeed) {
      const mass = r.body.mass();
      r.body.applyImpulse({ x: dir.x * e.rollerAccel * mass * dt, y: 0, z: dir.z * e.rollerAccel * mass * dt }, true);
    }
  }

  private killRoller(r: Roller) {
    const p = r.body.translation();
    this.killedThisFrame.push({ kind: 'roller', position: new THREE.Vector3(p.x, p.y, p.z) });
    this.removeRoller(r);
  }

  private removeRoller(r: Roller) {
    if (!this.rollers.includes(r)) return;
    this.rollerByCollider.delete(r.collider.handle);
    this.world.removeRigidBody(r.body);
    r.mesh.removeFromParent();
    this.rollers.splice(this.rollers.indexOf(r), 1);
  }

  // -------------------------------------------------------------------------
  // Drones
  // -------------------------------------------------------------------------

  private spawnDrone(carPos: THREE.Vector3) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.2), this.mats.drone);
    body.castShadow = true;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), this.mats.droneEye);
    eye.position.set(0, -0.05, -0.62);
    mesh.add(body, eye);
    const rotors: THREE.Object3D[] = [];
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.15), this.mats.drone);
      arm.position.set(x, 0.15, z);
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.12), this.mats.rotor);
      rotor.position.set(x, 0.25, z);
      mesh.add(arm, rotor);
      rotors.push(rotor);
    }
    const n = this.drones.length;
    const offset = new THREE.Vector3(n === 0 ? 0 : n % 2 ? -3.5 : 3.5, n * 1.5, n * 4);
    const pos = carPos.clone().add(new THREE.Vector3(offset.x, CONFIG.enemies.droneHeight + 6, -30));
    mesh.position.copy(pos);
    this.group.add(mesh);
    const drone: Drone = {
      mesh, rotors, pos, state: 'approach', age: 0, hp: CONFIG.enemies.droneHp, offset, phase: this.rng.next() * 6,
      bombsLeft: CONFIG.enemies.droneBombs, bombTimer: 1.5,
      target: {
        kind: 'drone',
        radius: 1.1,
        position: () => drone.pos.clone(),
        alive: () => this.drones.includes(drone),
        hit: (amount) => {
          if (!this.drones.includes(drone)) return false;
          drone.hp -= amount;
          if (drone.hp > 0) return false;
          this.killedThisFrame.push({ kind: 'drone', position: drone.pos.clone() });
          this.removeDrone(drone);
          return true;
        },
      },
    };
    this.drones.push(drone);
  }

  private updateDrone(d: Drone, dt: number, target: EnemyTarget) {
    const e = CONFIG.enemies;
    d.age += dt;
    for (const r of d.rotors) r.rotation.y += dt * 40;

    // Hover ahead of the car (so bombs fall in its path), weaving side to side.
    const ground = groundHeightAt(target.position.x, target.position.z);
    const goal = target.position.clone().addScaledVector(target.velocity, 0.5);
    goal.x += Math.sin(d.age * 1.3 + d.phase) * 3 + d.offset.x;
    goal.z += d.offset.z;
    goal.y = Math.max(goal.y, ground) + e.droneHeight + d.offset.y;
    if (d.state === 'leave') goal.set(d.pos.x, d.pos.y + 20, d.pos.z + 40);

    const before = d.pos.clone();
    d.pos.lerp(goal, 1 - Math.exp(-(d.state === 'approach' ? 2 : 3.5) * dt));
    d.mesh.position.copy(d.pos);
    // Tilt toward the direction of travel.
    const vel = d.pos.clone().sub(before).divideScalar(Math.max(dt, 1e-4));
    d.mesh.rotation.set(THREE.MathUtils.clamp(vel.z * 0.02, -0.4, 0.4), 0, THREE.MathUtils.clamp(-vel.x * 0.03, -0.4, 0.4));

    // Start bombing once close (or after a few seconds, so a fast car can't outrun it forever).
    if (d.state === 'approach' && (d.pos.distanceTo(goal) < 12 || d.age > 4)) d.state = 'attack';
    if (d.state === 'attack') {
      d.bombTimer -= dt;
      if (d.bombTimer <= 0 && d.bombsLeft > 0) {
        this.dropBomb(d, target);
        d.bombsLeft--;
        d.bombTimer = e.droneBombInterval;
      }
      if (d.bombsLeft === 0 && d.bombTimer < e.droneBombInterval - 1) d.state = 'leave';
    }
    if (d.state === 'leave' && d.age > 4 && d.pos.y > target.position.y + 25) this.removeDrone(d);
  }

  private removeDrone(d: Drone) {
    d.mesh.removeFromParent();
    const i = this.drones.indexOf(d);
    if (i >= 0) this.drones.splice(i, 1);
  }

  /** Drop a bomb aimed at where the car will be when it lands (with a little error so you can dodge). */
  private dropBomb(d: Drone, target: EnemyTarget) {
    const g = Math.abs(CONFIG.physics.gravity);
    const height = Math.max(1, d.pos.y - target.position.y);
    const flight = Math.sqrt((2 * height) / g);
    const aim = target.position.clone().addScaledVector(target.velocity, flight);
    const spread = CONFIG.enemies.droneBombSpread;
    aim.x += this.rng.range(-spread, spread);
    aim.z += this.rng.range(-spread, spread);
    const vx = (aim.x - d.pos.x) / flight;
    const vz = (aim.z - d.pos.z) / flight;

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(d.pos.x, d.pos.y - 0.5, d.pos.z).setLinvel(vx, 0, vz).setCcdEnabled(true),
    );
    // Sensor: bombs don't bounce off things, they just fall and we check where they are.
    this.world.createCollider(RAPIER.ColliderDesc.ball(0.28).setSensor(true).setMass(5), body);
    const mesh = new THREE.Mesh(this.bombGeo, this.mats.bomb);
    mesh.position.copy(d.pos);
    const marker = new THREE.Mesh(this.markerGeo, this.mats.marker);
    marker.position.set(aim.x, groundHeightAt(aim.x, aim.z) + 0.08, aim.z);
    this.group.add(mesh, marker);
    this.bombs.push({ body, mesh, marker, age: 0 });
  }

  private removeBomb(b: Bomb) {
    this.world.removeRigidBody(b.body);
    b.mesh.removeFromParent();
    b.marker.removeFromParent();
    const i = this.bombs.indexOf(b);
    if (i >= 0) this.bombs.splice(i, 1);
  }
}
