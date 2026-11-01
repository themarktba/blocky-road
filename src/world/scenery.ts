import * as THREE from 'three';
import { CONFIG } from '../config';
import { createRng } from '../core/random';
import { chunkRange, featureAt, groundHeightAt, roadCenterX } from './road';

// Shared by every chunk: only the instance lists differ.
const TRUNK_GEO = new THREE.BoxGeometry(0.5, 2, 0.5).translate(0, 1, 0);
const LEAVES_GEO = new THREE.ConeGeometry(1.6, 3.2, 5).translate(0, 3.4, 0);
const ROCK_GEO = new THREE.DodecahedronGeometry(0.9, 0).translate(0, 0.4, 0);
const TRUNK_MAT = new THREE.MeshLambertMaterial({ color: '#7a5230' });
const LEAVES_MAT = new THREE.MeshLambertMaterial({ color: '#2e8b57', flatShading: true });
const ROCK_MAT = new THREE.MeshLambertMaterial({ color: '#8d8d8d', flatShading: true });

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = true;
  return mesh;
}

/**
 * Decorative low-poly trees and rocks beside the road (no physics).
 * Built per road chunk alongside the road, using instancing so they cost almost nothing.
 */
export class Scenery {
  readonly group = new THREE.Group();
  private chunks = new Map<number, THREE.InstancedMesh[]>();

  build(index: number) {
    if (this.chunks.has(index)) return;
    const [z0, z1] = chunkRange(index);
    // Seeded per chunk, so a chunk looks the same every time it is rebuilt.
    const rng = createRng(CONFIG.road.seed + 99 + index * 7919);
    const halfRoad = CONFIG.road.width / 2;
    const trees: THREE.Matrix4[] = [];
    const rocks: THREE.Matrix4[] = [];
    for (let z = Math.max(z0, 10); z < z1; z += 6) {
      for (const side of [-1, 1]) {
        if (rng.next() > 0.55) continue;
        const offset = halfRoad + rng.range(5, CONFIG.road.shoulderWidth * 0.8);
        const tz = z + rng.range(-2, 2);
        if (featureAt(tz - 2)?.type === 'gap' || featureAt(tz + 2)?.type === 'gap') continue;
        const x = roadCenterX(tz) + side * offset;
        const y = groundHeightAt(x, tz) - 0.1;
        const s = rng.range(0.7, 1.4);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, tz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI), 0)),
          new THREE.Vector3(s, s, s),
        );
        (rng.next() < 0.75 ? trees : rocks).push(m);
      }
    }
    const meshes = [instanced(TRUNK_GEO, TRUNK_MAT, trees), instanced(LEAVES_GEO, LEAVES_MAT, trees), instanced(ROCK_GEO, ROCK_MAT, rocks)];
    this.group.add(...meshes);
    this.chunks.set(index, meshes);
  }

  drop(index: number) {
    for (const m of this.chunks.get(index) ?? []) {
      m.removeFromParent();
      m.dispose();
    }
    this.chunks.delete(index);
  }
}
