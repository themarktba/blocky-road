import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import { Input } from '../core/input';
import { SceneSetup } from '../core/scene';
import { FollowCamera } from '../core/followCamera';
import { Road, SPAWN_Z, chunkIndexAt, featureAt, gapAt, groundHeightAt, roadCenterX, roadHeight } from '../world/road';
import { Scenery } from '../world/scenery';
import { Pickups } from '../world/pickups';
import { Obstacles } from '../world/obstacles';
import { Debris } from '../world/debris';
import { Enemies } from '../enemies/enemies';
import { ExplosionFx } from '../effects/explosionFx';
import { Weapons } from '../weapons/weapons';
import type { Destroyed, Target } from './targets';
import { Vehicle } from '../car/vehicle';
import type { CarConfig } from '../car/carConfig';
import { buildCarConfig, validateBlueprint } from '../car/parts';
import { Garage } from '../garage/Garage';
import { GarageUi } from '../ui/garageUi';
import { Hud } from '../ui/hud';
import { TouchControls } from '../ui/touchControls';
import { IS_TOUCH } from '../core/device';
import { saveProfile, starterBlueprint, type Profile } from './profile';
import { addFuel, createRunState, endRun, runCoins, updateRun, type RunEndReason, type RunState } from './state';

/**
 * Owns all the systems and switches between the garage and driving.
 * Driving loop: input → fixed-step physics → contacts/damage → game rules → visuals → render.
 */
export class Game {
  private gfx: SceneSetup;
  private world: RAPIER.World;
  private events = new RAPIER.EventQueue(true);
  private input = new Input();
  private camera: FollowCamera;
  private hud: Hud;
  private touch: TouchControls;
  private garage: Garage;
  private garageUi: GarageUi;
  private pickups: Pickups;
  private obstacles: Obstacles;
  private enemies: Enemies;
  private debris: Debris;
  private fx = new ExplosionFx();
  private weapons: Weapons;
  private vehicle: Vehicle | null = null;
  private state: RunState = createRunState(0);
  private gapFallTimer = 0;
  private road: Road;
  private scenery = new Scenery();
  /** Road chunks that currently exist (road, scenery, obstacles and fuel cans). */
  private builtChunks = new Set<number>();
  /** Next full kilometre that pays a bonus. */
  private nextKm = 1;

  private timer = new THREE.Timer();
  private accumulator = 0;
  private readonly fixedDt = 1 / CONFIG.physics.stepHz;

  constructor(container: HTMLElement, private profile: Profile) {
    this.gfx = new SceneSetup(container);
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = this.fixedDt;

    this.road = new Road(this.world);
    this.pickups = new Pickups();
    this.obstacles = new Obstacles(this.world);
    this.enemies = new Enemies(this.world);
    this.debris = new Debris(this.world);
    this.weapons = new Weapons(this.world, this.fx);
    this.gfx.scene.add(this.road.group, this.scenery.group, this.pickups.group, this.obstacles.group,
      this.enemies.group, this.debris.group, this.fx.group, this.weapons.group);

    this.camera = new FollowCamera(this.gfx.camera);
    this.hud = new Hud(container, {
      onRestart: () => this.startRun(),
      onGarage: () => this.enterGarage(),
    });

    this.garage = new Garage(this.gfx.renderer.domElement, profile.blueprint, () => this.onBlueprintChanged(), (c) => this.pay(c));
    this.garageUi = new GarageUi(container, {
      onSelect: (id) => {
        this.garage.selectedPartId = id;
        this.garage.mode = 'place'; // picking a part means you want to place it
        this.renderGarageUi();
      },
      onMode: (mode) => {
        this.garage.mode = mode;
        this.renderGarageUi();
      },
      onRotate: (axis) => this.garage.rotate(axis),
      onResetRotation: () => this.garage.resetRotation(),
      onUndo: () => this.garage.undo(),
      onDrive: () => this.startRun(),
      onStarter: () => this.garage.setBlueprint(starterBlueprint()),
      onClear: () => this.garage.setBlueprint({ name: 'My Car', parts: [] }),
    });

    this.touch = new TouchControls(container, this.input, () => this.finishRun('gaveUp'));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state.phase === 'driving') this.finishRun('gaveUp');
    });

    // Expose for debugging/tuning in the browser console: window.game, window.CONFIG.
    // Most driving values are read every step, so e.g. CONFIG.tires.frictionSlip = 1.5 works live.
    Object.assign(window, { game: this, CONFIG });
  }

  start() {
    this.enterGarage();
    this.timer.connect(document); // pauses the clock while the tab is hidden
    this.gfx.renderer.setAnimationLoop((time) => this.frame(time));
  }

  // -------------------------------------------------------------------------
  // Garage
  // -------------------------------------------------------------------------

  enterGarage() {
    if (this.state.phase === 'driving') this.finishRun('gaveUp');
    this.state.phase = 'garage';
    this.hud.hideRunOver();
    this.hud.show(false);
    this.touch.show(false);
    this.garage.setActive(true);
    this.garageUi.show(true);
    this.renderGarageUi();
  }

  private onBlueprintChanged() {
    this.profile.blueprint = this.garage.blueprint;
    saveProfile(this.profile);
    this.renderGarageUi();
  }

  private renderGarageUi() {
    this.garageUi.render(this.profile, this.garage.blueprint, {
      selected: this.garage.selectedPartId,
      mode: this.garage.mode,
      rotated: this.garage.orientation !== 0,
      canUndo: this.garage.canUndo,
    });
  }

  /** Spend coins on parts (negative = refund). Returns false, with a message, if you can't afford it. */
  private pay(coins: number): boolean {
    if (coins > this.profile.coins) {
      this.garageUi.flash(`Need ${coins - this.profile.coins} more coins`);
      return false;
    }
    this.profile.coins -= coins;
    saveProfile(this.profile);
    return true;
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  /** Build the car from the garage blueprint and start driving. */
  startRun() {
    const errors = validateBlueprint(this.garage.blueprint);
    if (errors.length) {
      this.enterGarage();
      this.garageUi.flash(errors[0]);
      return;
    }
    const config = buildCarConfig(this.garage.blueprint);

    this.vehicle?.dispose();
    this.debris.clear();
    // Fresh obstacles and fuel cans for the new run; the road itself is kept.
    for (const i of this.builtChunks) this.dropChunk(i);
    this.pickups.clear();
    this.pickups.ammoCrates = config.blocks.some((b) => b.weapon?.type === 'ranged');
    this.obstacles.clear();
    this.enemies.reset();
    this.streamWorld(SPAWN_Z);
    this.nextKm = 1;
    this.weapons.reset();

    this.vehicle = new Vehicle(this.world, config, this.spawnPoint(SPAWN_Z, config), this.debris);
    this.gfx.scene.add(this.vehicle.group);
    this.state = createRunState(config.fuelCapacity);
    this.gapFallTimer = 0;
    this.accumulator = 0;

    this.garage.setActive(false);
    this.garageUi.show(false);
    this.hud.hideRunOver();
    this.hud.show(true);
    this.touch.show(IS_TOUCH);
    this.touch.setFireVisible(config.blocks.some((b) => b.weapon?.type === 'ranged'));
    this.camera.snap();
  }

  // -------------------------------------------------------------------------
  // Endless road: build chunks ahead of the car, delete the ones far behind
  // -------------------------------------------------------------------------

  private streamWorld(carZ: number) {
    const first = Math.max(0, chunkIndexAt(carZ - CONFIG.road.keepBehind));
    const last = chunkIndexAt(carZ + CONFIG.road.buildAhead);
    for (const i of this.builtChunks) if (i < first || i > last) this.dropChunk(i);
    for (let i = first; i <= last; i++) {
      if (this.builtChunks.has(i)) continue;
      this.road.build(i);
      this.scenery.build(i);
      this.obstacles.build(i);
      this.pickups.build(i);
      this.builtChunks.add(i);
    }
  }

  private dropChunk(i: number) {
    this.road.drop(i);
    this.scenery.drop(i);
    this.obstacles.drop(i);
    this.pickups.drop(i);
    this.builtChunks.delete(i);
  }

  private finishRun(reason: RunEndReason) {
    if (this.state.phase !== 'driving') return;
    endRun(this.state, reason);
    this.onRunOver();
  }

  private onRunOver() {
    this.touch.show(false);
    const earned = runCoins(this.state);
    const isBest = this.state.distance > this.profile.bestDistance;
    if (isBest) this.profile.bestDistance = this.state.distance;
    this.profile.coins += earned;
    saveProfile(this.profile);
    this.hud.showRunOver(this.state, this.profile, isBest, earned);
  }

  /** Point above the road center at distance z, high enough for this car's wheels. */
  private spawnPoint(z: number, config?: CarConfig): THREE.Vector3 {
    const c = config ?? this.vehicle?.config;
    let lowest = 0;
    if (c) {
      for (const w of c.wheels) lowest = Math.min(lowest, w.position[1] - CONFIG.suspension.restLength - w.radius);
    }
    return new THREE.Vector3(roadCenterX(z), roadHeight(z) + 0.4 - lowest, z);
  }

  /** Heading (radians) of the road at z, so the car is placed facing along it. */
  private roadHeading(z: number): number {
    return Math.atan2(roadCenterX(z + 1) - roadCenterX(z - 1), 2);
  }

  /** Put the car back upright on the road near where it is now (before a gap if it's in one). */
  private resetCar(atZ?: number) {
    if (!this.vehicle) return;
    let z = Math.max(SPAWN_Z, atZ ?? this.vehicle.position.z);
    const f = featureAt(z);
    if (f?.type === 'gap') z = f.start - 25;
    this.vehicle.placeAt(this.spawnPoint(z), this.roadHeading(z));
    this.camera.snap();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(time: number) {
    this.timer.update(time);
    // Clamp: never negative, and at most 0.1 s so a hiccup can't launch the physics.
    const dt = Math.max(0, Math.min(this.timer.getDelta(), 0.1));
    if (this.state.phase === 'garage' || !this.vehicle) {
      this.input.read(); // drop key presses made in the garage
      this.garage.update();
      this.gfx.renderer.render(this.garage.scene, this.garage.camera);
      return;
    }
    this.driveFrame(dt, this.vehicle);
  }

  private driveFrame(dt: number, vehicle: Vehicle) {
    const input = this.input.read();
    const driving = this.state.phase === 'driving';
    const controls = driving ? input : { throttle: 0, steer: 0, reset: false, fire: false };
    if (driving && input.reset) this.resetCar();

    // Things weapons can hit, near the car.
    const carZ = vehicle.position.z;
    this.streamWorld(carZ);
    const targets = [...this.obstacles.targets, ...this.enemies.targets]
      .filter((t) => t.alive() && Math.abs(t.position().z - carZ) < 90);

    // Fixed-step physics so the car behaves the same at any frame rate.
    this.world.gravity = { x: 0, y: CONFIG.physics.gravity, z: 0 };
    this.accumulator += dt;
    let steps = 0;
    let throttleSum = 0;
    while (this.accumulator >= this.fixedDt && steps < CONFIG.physics.maxStepsPerFrame) {
      if (driving) this.weapons.updateMelee(this.fixedDt, vehicle, targets);
      vehicle.physicsStep(this.fixedDt, controls, this.state.fuel > 0);
      this.world.step(this.events);
      this.handleContacts(vehicle);
      throttleSum += vehicle.appliedThrottle;
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === CONFIG.physics.maxStepsPerFrame) this.accumulator = 0;

    const pos = vehicle.position;
    const speed = vehicle.speed;
    const v = vehicle.body.linvel();

    // Fell off the world, or into a gap? Put it back.
    if (pos.y < groundHeightAt(pos.x, pos.z) - 15) this.resetCar();
    const gap = gapAt(pos.z);
    this.gapFallTimer = gap && pos.y < roadHeight(gap.start) - 3 ? this.gapFallTimer + dt : 0;
    if (gap && this.gapFallTimer > 0.6) {
      this.resetCar(gap.start - 1);
      this.hud.flash('Fell in a gap!', 'bad');
    }

    // Weapons, obstacles and enemies.
    for (const b of this.weapons.update(dt, vehicle, controls.fire, targets)) {
      this.explode(b.point, 'shell', { targetDamage: b.damage, radius: b.radius });
    }
    for (const p of this.obstacles.update()) this.explode(p, 'barrel');
    const enemyEvents = this.enemies.update(dt, { position: pos, velocity: new THREE.Vector3(v.x, v.y, v.z) }, driving);
    for (const p of enemyEvents.explosions) this.explode(p, 'bomb');
    this.onDestroyed([...this.obstacles.drainDestroyed(), ...enemyEvents.killed], driving);
    this.debris.update(dt);
    this.fx.update(dt);

    // Pickups.
    const picked = this.pickups.update(dt, pos);
    if (picked.fuel > 0 && driving) {
      addFuel(this.state, picked.fuel * CONFIG.fuel.canAmount);
      this.state.cansCollected += picked.fuel;
      this.hud.flash(`+${picked.fuel * CONFIG.fuel.canAmount} fuel`);
    }
    if (picked.ammo > 0 && driving) {
      vehicle.refillAmmo(picked.ammo * CONFIG.ammo.crateRefill);
      this.hud.flash('+ammo');
    }

    // Car stats change as parts break off.
    this.state.fuelCapacity = vehicle.fuelCapacity;
    this.state.fuel = Math.min(this.state.fuel, this.state.fuelCapacity);
    vehicle.clampAmmo(); // a lost ammo box lowers how much the guns can hold
    if (driving && !vehicle.hasCabin) this.finishRun('wrecked');
    // Every full kilometre pays a bonus – and from here on it only gets harder.
    if (this.state.phase === 'driving' && this.state.distance >= this.nextKm * 1000) {
      this.state.bonusCoins += CONFIG.economy.kmBonus;
      this.hud.flash(`${this.nextKm} km! +${CONFIG.economy.kmBonus} · it gets harder`);
      this.nextKm++;
    }

    const ended = updateRun(this.state, dt, {
      throttle: steps > 0 ? throttleSum / steps : 0,
      carMass: vehicle.mass,
      distance: pos.z - SPAWN_Z,
      forwardSpeed: v.z, // speed along the road
      hasEngine: vehicle.enginePower > 0,
    });
    if (ended) this.onRunOver();

    // Visuals.
    vehicle.syncVisuals(dt);
    this.camera.update(dt, pos, vehicle.quaternion, speed);
    this.gfx.followSun(pos);
    this.hud.update(dt, this.state, speed, vehicle.integrity, this.weapons.ammo(vehicle));
    this.gfx.render();
  }

  // -------------------------------------------------------------------------
  // Collisions, damage, explosions
  // -------------------------------------------------------------------------

  private handleContacts(vehicle: Vehicle) {
    this.events.drainContactForceEvents((e) => {
      const h1 = e.collider1();
      const h2 = e.collider2();
      const force = e.totalForceMagnitude();

      // Red barrels go boom when hit hard.
      this.obstacles.onHardHit(h1);
      this.obstacles.onHardHit(h2);

      const carHandle = vehicle.blockByCollider(h1) ? h1 : vehicle.blockByCollider(h2) ? h2 : null;
      if (carHandle === null) return;
      const other = carHandle === h1 ? h2 : h1;
      const enemy = this.enemies.isRoller(other);
      if (enemy) this.enemies.hitRoller(other, force);
      this.partsLost(vehicle.applyImpact(carHandle, force, enemy ? CONFIG.damage.enemyMultiplier : 1));
    });
  }

  /** Effects and coins for rocks, barrels and enemies that were destroyed. */
  private onDestroyed(list: Destroyed[], driving: boolean) {
    const e = CONFIG.economy;
    for (const d of list) {
      if (d.kind === 'rock') {
        this.fx.burst(d.position, ['#7d7d7d', '#5f5f5f', '#a0a0a0'], 14, 7, 1.4);
      } else if (d.kind === 'barrel') {
        this.fx.burst(d.position, ['#457b9d', '#1d3557'], 10, 6, 0.9);
      } else {
        this.fx.spawn(d.position, 2.5);
      }
      if (!driving) continue;
      const bonus = d.kind === 'rock' ? e.rockBonus : d.kind === 'roller' ? e.rollerKillBonus : d.kind === 'drone' ? e.droneKillBonus : 0;
      this.state.bonusCoins += bonus;
      if (d.kind === 'roller' || d.kind === 'drone') {
        this.state.enemiesDestroyed++;
        this.hud.flash(`${d.kind === 'drone' ? 'Drone down!' : 'Smashed!'} +${bonus}`);
      } else {
        this.state.obstaclesDestroyed++;
      }
    }
  }

  /**
   * Blow something up: visuals, push everything nearby, damage the car (unless it's our own shell),
   * and damage rocks/barrels/enemies in range (which sets off chain reactions).
   */
  private explode(point: THREE.Vector3, kind: 'barrel' | 'bomb' | 'shell', override?: { targetDamage: number; radius: number }) {
    const cfg = CONFIG.explosions[kind];
    const radius = override?.radius ?? cfg.radius;
    const { damage, impulse, hurtsCar } = cfg;
    const targetDamage = override?.targetDamage ?? cfg.targetDamage;
    this.fx.spawn(point, radius);

    // Push every dynamic body in range away from the blast (and a bit up).
    const bodies = new Set<RAPIER.RigidBody>();
    this.world.intersectionsWithShape(point, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius), (collider) => {
      const body = collider.parent();
      if (body && body.isDynamic()) bodies.add(body);
      return true;
    });
    for (const body of bodies) {
      const p = body.translation();
      const dir = new THREE.Vector3(p.x - point.x, p.y - point.y, p.z - point.z);
      const dist = dir.length();
      const falloff = Math.max(0, 1 - dist / radius);
      dir.normalize().add(new THREE.Vector3(0, 0.8, 0)).normalize();
      const j = dir.multiplyScalar(impulse * body.mass() * falloff);
      // Hit the car off-center so it tumbles.
      body.applyImpulseAtPoint(j, { x: (p.x + point.x) / 2, y: (p.y + point.y) / 2, z: (p.z + point.z) / 2 }, true);
    }

    if (hurtsCar && this.vehicle && this.state.phase === 'driving') {
      this.partsLost(this.vehicle.damageArea(point, radius, damage));
    }
    // Damage everything destructible in range (red barrels then explode next frame: chain reactions).
    const targets: Target[] = [...this.obstacles.targets, ...this.enemies.targets];
    for (const t of targets) {
      if (!t.alive()) continue;
      const d = Math.max(0, t.position().distanceTo(point) - t.radius);
      if (d < radius) t.hit(targetDamage * Math.max(0.3, 1 - d / radius));
    }
  }

  private partsLost(names: string[]) {
    if (!names.length || this.state.phase !== 'driving') return;
    this.state.partsLost += names.length;
    for (const n of names) this.hud.alert(`Lost: ${n}`);
  }
}
