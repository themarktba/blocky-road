import type * as THREE from 'three';

export type TargetKind = 'rock' | 'barrel' | 'roller' | 'drone';

/**
 * Anything weapons and explosions can destroy. Obstacles and enemies each provide their
 * own targets; the weapon system only needs this interface. Add new destructible things
 * by giving them a Target.
 */
export interface Target {
  kind: TargetKind;
  /** Rough size, for hit tests (m). */
  radius: number;
  /** World position right now. */
  position(): THREE.Vector3;
  alive(): boolean;
  /** Apply damage. Returns true if this hit destroyed it. */
  hit(amount: number): boolean;
}

/** Something that got destroyed this frame (for effects and coins). */
export interface Destroyed {
  kind: TargetKind;
  position: THREE.Vector3;
}
