import * as THREE from 'three';
import { CONFIG } from '../config';
import { createRng, type Rng } from '../core/random';
import { scaled } from '../game/difficulty';
import { chunkRange, featureAt, roadCenterX, roadHeight } from './road';

export type PickupKind = 'fuel' | 'ammo';

interface Pickup {
  kind: PickupKind;
  chunk: number;
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}

const RED = new THREE.MeshLambertMaterial({ color: '#e63946', emissive: '#5a0d12' });
const DARK = new THREE.MeshLambertMaterial({ color: '#222' });
const OLIVE = new THREE.MeshLambertMaterial({ color: '#606c38', emissive: '#1c2210', flatShading: true });
const BRASS = new THREE.MeshLambertMaterial({ color: '#ffd166', emissive: '#4a3300', flatShading: true });
const CAN_BODY = new THREE.BoxGeometry(0.9, 1.2, 0.45);
const CAN_HANDLE = new THREE.BoxGeometry(0.5, 0.15, 0.2);
const CAN_SPOUT = new THREE.BoxGeometry(0.18, 0.3, 0.18);
const CRATE_BODY = new THREE.BoxGeometry(1.1, 0.7, 0.8);
const CRATE_BAND = new THREE.BoxGeometry(1.14, 0.16, 0.84);
const BULLET = new THREE.ConeGeometry(0.07, 0.25, 5);

/** One blocky red jerry can. */
function createCanMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(CAN_BODY, RED);
  const handle = new THREE.Mesh(CAN_HANDLE, DARK);
  handle.position.set(-0.1, 0.7, 0);
  const spout = new THREE.Mesh(CAN_SPOUT, DARK);
  spout.position.set(0.3, 0.72, 0);
  for (const m of [body, handle, spout]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** One olive ammo crate with a yellow band and bullets on top. */
function createCrateMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(CRATE_BODY, OLIVE);
  const band = new THREE.Mesh(CRATE_BAND, BRASS);
  body.castShadow = true;
  g.add(body, band);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(BULLET, BRASS);
    b.position.set(-0.36 + i * 0.24, 0.48, 0);
    g.add(b);
  }
  return g;
}

/**
 * Pickups along the road: red fuel cans and green ammo crates.
 * Pickup is a simple distance check (no physics needed).
 * Both are placed per road chunk and get scarcer the farther you go (CONFIG.difficulty).
 */
export class Pickups {
  readonly group = new THREE.Group();
  private items: Pickup[] = [];
  private time = 0;
  /** Ammo crates are only placed when the car has guns (set before the run starts). */
  ammoCrates = true;

  /** Place the pickups for road chunk `index`. */
  build(index: number) {
    const [z0, z1] = chunkRange(index);
    this.place('fuel', index, z0, z1, createRng(CONFIG.road.seed + 7 + index * 7919), CONFIG.difficulty.fuelCanSpacing, 60);
    if (this.ammoCrates) {
      this.place('ammo', index, z0, z1, createRng(CONFIG.road.seed + 13 + index * 7919), CONFIG.difficulty.ammoCrateSpacing, 150);
    }
  }

  private place(kind: PickupKind, index: number, z0: number, z1: number, rng: Rng, spacing: readonly [number, number], firstZ: number) {
    const halfRoad = CONFIG.road.width / 2 - 1.5;
    const step = (z: number) => scaled(spacing, z) * rng.range(0.8, 1.2);
    // Random start offset so pickups spread evenly even when the spacing is longer than a chunk.
    for (let z = Math.max(z0, firstZ) + rng.next() * step(z0); z < z1; z += step(z)) {
      // Not on a ramp or over a gap.
      let cz = z;
      while (featureAt(cz)?.type === 'ramp' || featureAt(cz)?.type === 'gap') cz += 4;
      const x = roadCenterX(cz) + rng.range(-halfRoad, halfRoad);
      const position = new THREE.Vector3(x, roadHeight(cz) + (kind === 'fuel' ? 1.1 : 0.9), cz);
      const mesh = kind === 'fuel' ? createCanMesh() : createCrateMesh();
      mesh.position.copy(position);
      this.group.add(mesh);
      this.items.push({ kind, chunk: index, mesh, position, collected: false });
    }
  }

  /** Remove the pickups of road chunk `index`. */
  drop(index: number) {
    for (const p of this.items) if (p.chunk === index) p.mesh.removeFromParent();
    this.items = this.items.filter((p) => p.chunk !== index);
  }

  /** Spins the pickups and returns how many of each the car grabbed this frame. */
  update(dt: number, carPosition: THREE.Vector3): Record<PickupKind, number> {
    this.time += dt;
    const picked = { fuel: 0, ammo: 0 };
    const r2 = CONFIG.fuel.pickupRadius ** 2;
    for (const p of this.items) {
      if (p.collected) continue;
      if (Math.abs(p.position.z - carPosition.z) > 200) continue;
      p.mesh.rotation.y = this.time * 2;
      p.mesh.position.y = p.position.y + Math.sin(this.time * 3 + p.position.z) * 0.15;
      if (p.position.distanceToSquared(carPosition) < r2) {
        p.collected = true;
        p.mesh.visible = false;
        picked[p.kind]++;
      }
    }
    return picked;
  }

  /** Remove all pickups (new run). The road streaming places fresh ones. */
  clear() {
    for (const p of this.items) p.mesh.removeFromParent();
    this.items = [];
  }
}
