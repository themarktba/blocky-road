/**
 * CarConfig is everything the physics vehicle needs to build a car.
 * It's plain data, made from a blueprint by car/parts.ts → buildCarConfig().
 *
 * Coordinates are in meters in the car's local space:
 *   +Z = forward, +Y = up, +X = left (as seen from behind the car).
 */

export type Vec3 = [number, number, number];

export type PartCategory = 'frame' | 'cabin' | 'engine' | 'fuelTank' | 'ammo' | 'armor' | 'weapon' | 'wheel';

/** How a weapon part works. Weapons always point forward (+Z). */
export interface WeaponSpec {
  /** Melee hits what's right in front of it; ranged shoots projectiles (hold Space). */
  type: 'melee' | 'ranged';
  /** Damage per hit (melee: at low speed; ramming faster does up to 4x). */
  damage: number;
  /** Seconds between hits / shots. */
  cooldown: number;
  /** Melee: extra reach in front of the part (m). Ranged: max targeting distance (m). */
  range: number;
  /** Ranged only: projectile speed (m/s), shots per run, and blast radius (0 = no blast). */
  projectileSpeed?: number;
  ammo?: number;
  splash?: number;
}

/** One solid box of the car body. Each block is its own collider, so it can break off. */
export interface BodyBlock {
  partId: string;
  name: string;
  category: PartCategory;
  /** Grid position (lowest corner cell) and size in cells, after rotation. Used for connectivity. */
  cell: Vec3;
  cells: Vec3;
  /** Full size of the box (m), after rotation (lined up with the car's axes). */
  size: Vec3;
  /** Orientation index (see orientation.ts) and the box size before rotation (m). */
  orient: number;
  baseSize: Vec3;
  /** Which way the part's front points, in car space (weapons fire/hit this way). */
  facing: Vec3;
  /** Center of the box in car space (m). */
  center: Vec3;
  mass: number;
  color: string;
  armor: number;
  /** Hit points before this block breaks off. */
  hp: number;
  enginePower: number;
  fuelCapacity: number;
  /** Ammo boxes: extra ammo for every ranged weapon, in percent of its base ammo. */
  ammoBonus: number;
  /** Set for weapon parts. */
  weapon?: WeaponSpec;
}

export interface WheelMount {
  partId: string;
  name: string;
  /** Grid cell the wheel is mounted in. */
  cell: Vec3;
  /** Where the suspension attaches to the body, in car space (m). */
  position: Vec3;
  /** Front wheels steer. */
  steers: boolean;
  /** True for wheels on the front half of the car. */
  isFront: boolean;
  radius: number;
  width: number;
  /** Grip multiplier on CONFIG.tires.frictionSlip. */
  grip: number;
  mass: number;
}

export interface CarConfig {
  name: string;
  /** Total mass (kg), blocks + wheels. */
  mass: number;
  /** Total engine force (N), shared by the driven wheels. */
  enginePower: number;
  /** Fuel tank size (fuel units). */
  fuelCapacity: number;
  armor: number;
  blocks: BodyBlock[];
  wheels: WheelMount[];
}
