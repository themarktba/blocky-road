import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import { createRng } from '../core/random';
import { scaled } from '../game/difficulty';
import type { Destroyed, Target } from '../game/targets';
import { chunkRange, featureAt, roadCenterX, roadHeight } from './road';

interface Rock {
  /** Road chunk this rock belongs to (it goes away with the chunk). */
  chunk: number;
  mesh: THREE.Mesh;
  points: Float32Array;
  size: number;
  body: RAPIER.RigidBody | null;
  hp: number;
  target: Target;
}

interface Barrel {
  chunk: number;
  explosive: boolean;
  home: THREE.Vector3;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  mesh: THREE.Group;
  hp: number;
  target: Target;
}

const BARREL_RADIUS = 0.45;
const BARREL_HALF_HEIGHT = 0.6;

/**
 * Things on the road:
 *  - Rocks: fixed, solid. Hitting one hurts. Weapons can smash them.
 *  - Barrels: light, get knocked around. Weapons destroy them.
 *  - Red barrels: explode when hit hard or shot (chain reactions included).
 * Gaps are part of the road shape (see road.ts).
 * Obstacles are built per road chunk as the road streams in; farther chunks get more
 * obstacle groups and more (and bigger groups of) rocks – see CONFIG.difficulty.
 */
export class Obstacles {
  readonly group = new THREE.Group();
  private rocks: Rock[] = [];
  private barrels: Barrel[] = [];
  private barrelByCollider = new Map<number, Barrel>();
  /** Red barrels waiting to explode this frame. */
  private pending: Barrel[] = [];
  private destroyed: Destroyed[] = [];

  private barrelGeo = new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, BARREL_HALF_HEIGHT * 2, 10);
  private bandGeo = new THREE.CylinderGeometry(BARREL_RADIUS + 0.02, BARREL_RADIUS + 0.02, 0.1, 10);
  private mats = {
    barrel: new THREE.MeshLambertMaterial({ color: '#457b9d', flatShading: true }),
    explosive: new THREE.MeshLambertMaterial({ color: '#d62828', emissive: '#400', flatShading: true }),
    band: new THREE.MeshLambertMaterial({ color: '#1d3557' }),
    hazard: new THREE.MeshLambertMaterial({ color: '#ffd166' }),
    rock: new THREE.MeshLambertMaterial({ color: '#7d7d7d', flatShading: true }),
  };

  constructor(private world: RAPIER.World) {}

  /** Place the obstacles for road chunk `index`. */
  build(index: number) {
    const o = CONFIG.obstacles;
    const d = CONFIG.difficulty;
    const [z0, z1] = chunkRange(index);
    const rng = createRng(CONFIG.road.seed + 31 + index * 7919);
    const half = CONFIG.road.width / 2 - 1;
    const step = (z: number) => scaled(d.obstacleSpacing, z) * rng.range(0.7, 1.3);
    for (let z = Math.max(z0, o.startZ) + rng.next() * step(z0); z < z1; z += step(z)) {
      // Keep ramps, bumps and gaps clear.
      if (featureAt(z - 12) || featureAt(z) || featureAt(z + 12)) continue;
      const cx = roadCenterX(z);
      if (rng.next() < scaled(d.rockChance, z)) {
        // A few rocks, spread out along the road so there's usually a way past (or shoot through).
        const count = 1 + Math.floor(rng.next() * Math.round(scaled(d.maxRocks, z)));
        for (let i = 0; i < count; i++) {
          const x = cx + rng.range(-half + 1, half - 1);
          const zz = z + rng.range(-4, 4) + i * 5;
          this.addRock(index, new THREE.Vector3(x, roadHeight(zz), zz), rng.range(0.8, 1.5), rng.next() * Math.PI);
        }
      } else {
        // A cluster of barrels.
        const count = Math.floor(rng.range(3, 7));
        const bx = cx + rng.range(-half + 2, half - 2);
        for (let i = 0; i < count; i++) {
          const x = bx + rng.range(-2.2, 2.2);
          const zz = z + rng.range(-2.2, 2.2);
          const explosive = rng.next() < o.explosiveChance;
          this.addBarrel(index, new THREE.Vector3(x, roadHeight(zz) + BARREL_HALF_HEIGHT + 0.05, zz), explosive);
        }
      }
    }
  }

  /** Everything weapons can hit (alive or not – check alive()). */
  get targets(): Target[] {
    return [...this.rocks.map((r) => r.target), ...this.barrels.map((b) => b.target)];
  }

  /** Rocks/barrels destroyed since the last call. */
  drainDestroyed(): Destroyed[] {
    const d = this.destroyed;
    this.destroyed = [];
    return d;
  }

  // -------------------------------------------------------------------------
  // Rocks
  // -------------------------------------------------------------------------

  /** Remove everything that belongs to road chunk `index`. */
  drop(index: number) {
    for (const r of this.rocks) {
      if (r.chunk !== index) continue;
      if (r.body) this.world.removeRigidBody(r.body);
      r.body = null;
      r.mesh.removeFromParent();
      r.mesh.geometry.dispose();
    }
    for (const b of this.barrels) {
      if (b.chunk !== index) continue;
      this.removeBarrelBody(b);
      b.mesh.removeFromParent();
    }
    this.rocks = this.rocks.filter((r) => r.chunk !== index);
    this.barrels = this.barrels.filter((b) => b.chunk !== index);
    this.pending = this.pending.filter((b) => b.chunk !== index);
  }

  private addRock(chunk: number, base: THREE.Vector3, size: number, yaw: number) {
    const geo = new THREE.DodecahedronGeometry(size, 0);
    geo.scale(1.2, 0.8, 1);
    const mesh = new THREE.Mesh(geo, this.mats.rock);
    mesh.position.copy(base).add(new THREE.Vector3(0, size * 0.45, 0));
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);

    const rock: Rock = {
      chunk, mesh, size, body: null, hp: 0,
      points: new Float32Array(geo.getAttribute('position').array as Float32Array),
      target: {
        kind: 'rock',
        radius: size * 1.1,
        position: () => mesh.position.clone(),
        alive: () => rock.body !== null,
        hit: (amount) => {
          if (!rock.body) return false;
          rock.hp -= amount;
          if (rock.hp > 0) return false;
          this.destroyed.push({ kind: 'rock', position: mesh.position.clone() });
          this.world.removeRigidBody(rock.body);
          rock.body = null;
          mesh.visible = false;
          return true;
        },
      },
    };
    this.rocks.push(rock);
    this.spawnRock(rock);
  }

  private spawnRock(rock: Rock) {
    const m = rock.mesh;
    rock.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(m.position.x, m.position.y, m.position.z).setRotation(m.quaternion),
    );
    const desc = RAPIER.ColliderDesc.convexHull(rock.points) ?? RAPIER.ColliderDesc.ball(rock.size);
    this.world.createCollider(desc.setFriction(0.8), rock.body);
    rock.hp = CONFIG.obstacles.rockHp * rock.size;
    m.visible = true;
  }

  // -------------------------------------------------------------------------
  // Barrels
  // -------------------------------------------------------------------------

  private addBarrel(chunk: number, home: THREE.Vector3, explosive: boolean) {
    const mesh = new THREE.Group();
    const can = new THREE.Mesh(this.barrelGeo, explosive ? this.mats.explosive : this.mats.barrel);
    can.castShadow = true;
    mesh.add(can);
    for (const y of [-0.35, 0.35]) {
      const band = new THREE.Mesh(this.bandGeo, explosive ? this.mats.hazard : this.mats.band);
      band.position.y = y;
      mesh.add(band);
    }
    this.group.add(mesh);
    const barrel: Barrel = {
      chunk, explosive, home, body: null, collider: null, mesh, hp: 0,
      target: {
        kind: 'barrel',
        radius: 0.7,
        position: () => mesh.position.clone(),
        alive: () => barrel.body !== null && !this.pending.includes(barrel),
        hit: (amount) => {
          if (!barrel.target.alive()) return false;
          barrel.hp -= amount;
          if (barrel.hp > 0) return false;
          if (barrel.explosive) {
            this.pending.push(barrel); // explodes in update()
          } else {
            this.destroyed.push({ kind: 'barrel', position: mesh.position.clone() });
            this.removeBarrelBody(barrel);
            mesh.visible = false;
          }
          return true;
        },
      },
    };
    this.barrels.push(barrel);
    this.spawnBarrel(barrel);
  }

  private spawnBarrel(b: Barrel) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.home.x, b.home.y, b.home.z).setCanSleep(true).setSleeping(true),
    );
    let desc = RAPIER.ColliderDesc.cylinder(BARREL_HALF_HEIGHT, BARREL_RADIUS)
      .setMass(CONFIG.obstacles.barrelMass)
      .setFriction(0.7)
      .setRestitution(0.2);
    if (b.explosive) {
      // Tell us when it's hit hard so it can blow up.
      desc = desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(3500);
    }
    b.body = body;
    b.collider = this.world.createCollider(desc, body);
    b.hp = CONFIG.obstacles.barrelHp;
    this.barrelByCollider.set(b.collider.handle, b);
    b.mesh.visible = true;
    b.mesh.position.copy(b.home);
    b.mesh.quaternion.identity();
  }

  /** Called with contact-force events. Returns true if the collider was an explosive barrel. */
  onHardHit(colliderHandle: number): boolean {
    const b = this.barrelByCollider.get(colliderHandle);
    if (!b || !b.explosive || !b.body) return false;
    if (!this.pending.includes(b)) this.pending.push(b);
    return true;
  }

  /** Sync meshes and return positions of barrels that exploded this frame. */
  update(): THREE.Vector3[] {
    for (const b of this.barrels) {
      if (!b.body || b.body.isSleeping()) continue;
      const p = b.body.translation();
      const q = b.body.rotation();
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    const blasts: THREE.Vector3[] = [];
    const now = this.pending;
    this.pending = [];
    for (const b of now) {
      if (!b.body) continue;
      blasts.push(b.mesh.position.clone());
      this.removeBarrelBody(b);
      b.mesh.visible = false;
    }
    return blasts;
  }

  private removeBarrelBody(b: Barrel) {
    if (b.collider) this.barrelByCollider.delete(b.collider.handle);
    if (b.body) this.world.removeRigidBody(b.body);
    b.body = null;
    b.collider = null;
  }

  /** Remove everything (new run). The road streaming builds fresh obstacles. */
  clear() {
    for (const i of new Set([...this.rocks.map((r) => r.chunk), ...this.barrels.map((b) => b.chunk)])) this.drop(i);
    this.pending = [];
    this.destroyed = [];
  }
}
