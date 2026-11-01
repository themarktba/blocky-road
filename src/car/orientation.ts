import * as THREE from 'three';
import type { Vec3 } from './carConfig';

/**
 * PART ORIENTATIONS
 * A block can face 24 ways (6 directions for its front × 4 spins around that direction).
 * A placed part stores an index into ORIENTATIONS (0 = as designed: front = +Z, top = +Y).
 * Index 1 is a 90° turn around the vertical axis.
 */

export type RotateAxis = 'y' | 'x' | 'z';

const AXES: Record<RotateAxis, THREE.Vector3> = {
  y: new THREE.Vector3(0, 1, 0), // turn (left/right)
  x: new THREE.Vector3(1, 0, 0), // tilt (nose up/down)
  z: new THREE.Vector3(0, 0, 1), // roll (onto its side)
};

const quarterTurn = (axis: RotateAxis) => new THREE.Quaternion().setFromAxisAngle(AXES[axis], Math.PI / 2);

function findIndex(list: THREE.Quaternion[], q: THREE.Quaternion): number {
  // q and -q are the same rotation, hence the abs().
  return list.findIndex((o) => Math.abs(o.dot(q)) > 0.999);
}

/** All 24 orientations, found by turning the identity around y, x and z until nothing new appears. */
export const ORIENTATIONS: THREE.Quaternion[] = (() => {
  const list = [new THREE.Quaternion()];
  for (let i = 0; i < list.length; i++) {
    for (const axis of ['y', 'x', 'z'] as RotateAxis[]) {
      const q = quarterTurn(axis).multiply(list[i]).normalize();
      if (findIndex(list, q) < 0) list.push(q);
    }
  }
  return list;
})();

/** Orientation after turning `index` a quarter turn around a garage axis. */
export function rotateOrientation(index: number, axis: RotateAxis): number {
  const q = quarterTurn(axis).multiply(ORIENTATIONS[index] ?? ORIENTATIONS[0]);
  return Math.max(0, findIndex(ORIENTATIONS, q));
}

export function orientationQuat(index: number | undefined): THREE.Quaternion {
  return ORIENTATIONS[index ?? 0] ?? ORIENTATIONS[0];
}

/** A local vector (e.g. a size or an offset) turned by an orientation. */
export function rotateVec(v: Vec3, index: number | undefined): Vec3 {
  const r = new THREE.Vector3(...v).applyQuaternion(orientationQuat(index));
  return [r.x, r.y, r.z];
}

/** Size of a box after rotation (always positive whole cells if the input is). */
export function rotatedCells(cells: Vec3, index: number | undefined): Vec3 {
  const r = rotateVec(cells, index);
  return [Math.round(Math.abs(r[0])), Math.round(Math.abs(r[1])), Math.round(Math.abs(r[2]))];
}
