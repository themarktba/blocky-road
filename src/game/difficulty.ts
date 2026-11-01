import { CONFIG } from '../config';

/** How hard the road is at distance z: 0 at the start, 1 at CONFIG.difficulty.fullAt and beyond. */
export function difficultyAt(z: number): number {
  const t = Math.min(1, Math.max(0, z / CONFIG.difficulty.fullAt));
  return t; // grows steadily with distance
}

/** Blend a [start, full] pair from CONFIG.difficulty for distance z. */
export function scaled(pair: readonly [number, number], z: number): number {
  const t = difficultyAt(z);
  return pair[0] + (pair[1] - pair[0]) * t;
}
