import { CONFIG } from '../config';
import type { BodyBlock, CarConfig, PartCategory, Vec3, WeaponSpec, WheelMount } from './carConfig';
import { rotateVec, rotatedCells } from './orientation';

/**
 * PARTS SYSTEM
 * ------------
 * A car is a "blueprint": a list of parts snapped onto a 3D grid (like LEGO).
 * buildCarConfig() turns a blueprint into a CarConfig by adding up part stats.
 *
 * Every part has trade-offs, mostly through mass:
 *   heavier car = slower acceleration, slower on hills, burns more fuel.
 */

export type { PartCategory } from './carConfig';

/** Size of one grid cell in meters. */
export const GRID_SIZE = 0.5;
/** Size of the build area in cells [x, y, z]. */
export const GRID_DIMS: Vec3 = [10, 6, 14];

export interface PartStats {
  mass: number;
  enginePower: number;
  fuelCapacity: number;
  /** Extra ammo for every ranged weapon, in percent (ammo boxes). */
  ammoBonus: number;
  armor: number;
  /** Wheels only. */
  wheelRadius: number;
  wheelWidth: number;
  grip: number;
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  /** Size in grid cells [x, y, z] before rotation. Wheels use one cell (their mount point). */
  cells: Vec3;
  color: string;
  stats: Partial<PartStats>;
  /** Coins paid for each piece you put on the car (refunded when you take it off). */
  cost: number;
  description: string;
  /** Weapon parts only. */
  weapon?: WeaponSpec;
}

/** All parts in the game. Add new parts here – the garage lists them automatically. */
export const PARTS: Record<string, PartDef> = {
  // Frames: cheap structure to hold things together.
  frame_basic: {
    id: 'frame_basic', name: 'Chassis Plate', category: 'frame', cells: [4, 1, 6], color: '#3d5a80', cost: 25,
    stats: { mass: 70, armor: 1 }, description: 'Big sturdy base plate.',
  },
  frame_block: {
    id: 'frame_block', name: 'Frame Block', category: 'frame', cells: [2, 1, 2], color: '#4a6fa5', cost: 8,
    stats: { mass: 12, armor: 1 }, description: 'Small building block.',
  },
  frame_beam: {
    id: 'frame_beam', name: 'Beam', category: 'frame', cells: [1, 1, 4], color: '#5b7db1', cost: 6,
    stats: { mass: 10, armor: 1 }, description: 'Long, light connector.',
  },
  // Cabins: the driver. Lose every cabin and the car is wrecked.
  cabin_basic: {
    id: 'cabin_basic', name: 'Cabin', category: 'cabin', cells: [4, 2, 2], color: '#ee6c4d', cost: 20,
    stats: { mass: 30, armor: 1 }, description: 'The driver. Keep it safe!',
  },
  cabin_armored: {
    id: 'cabin_armored', name: 'Armored Cabin', category: 'cabin', cells: [4, 2, 2], color: '#c0503a', cost: 120,
    stats: { mass: 65, armor: 5 }, description: 'Much tougher, but heavy.',
  },
  // Engines: power vs weight.
  engine_small: {
    id: 'engine_small', name: 'Small Engine', category: 'engine', cells: [2, 1, 2], color: '#293241', cost: 20,
    stats: { mass: 40, enginePower: 2000 }, description: 'Light and weak.',
  },
  engine_big: {
    id: 'engine_big', name: 'V8 Engine', category: 'engine', cells: [4, 2, 2], color: '#1b1b1e', cost: 90,
    stats: { mass: 90, enginePower: 3600 }, description: 'Lots of power, very heavy.',
  },
  engine_turbo: {
    id: 'engine_turbo', name: 'Turbo Engine', category: 'engine', cells: [2, 1, 2], color: '#6a4c93', cost: 200,
    stats: { mass: 45, enginePower: 3000 }, description: 'Best power for its weight.',
  },
  // Fuel: range vs weight.
  tank_jerry: {
    id: 'tank_jerry', name: 'Jerry Can', category: 'fuelTank', cells: [1, 1, 2], color: '#e63946', cost: 5,
    stats: { mass: 6, fuelCapacity: 35 }, description: 'A little extra fuel.',
  },
  tank_small: {
    id: 'tank_small', name: 'Small Fuel Tank', category: 'fuelTank', cells: [4, 1, 1], color: '#f2cc8f', cost: 10,
    stats: { mass: 15, fuelCapacity: 100 }, description: 'Standard tank.',
  },
  tank_large: {
    id: 'tank_large', name: 'Large Fuel Tank', category: 'fuelTank', cells: [4, 2, 2], color: '#e9c46a', cost: 50,
    stats: { mass: 55, fuelCapacity: 220 }, description: 'Goes far, weighs a lot.',
  },
  // Ammo: like fuel tanks, but for guns. Each box adds a % of every ranged weapon's base ammo.
  ammo_box: {
    id: 'ammo_box', name: 'Ammo Box', category: 'ammo', cells: [2, 1, 1], color: '#606c38', cost: 15,
    stats: { mass: 12, ammoBonus: 50 }, description: 'Every gun carries 50% more ammo.',
  },
  ammo_crate: {
    id: 'ammo_crate', name: 'Ammo Crate', category: 'ammo', cells: [2, 1, 2], color: '#3a4a24', cost: 45,
    stats: { mass: 30, ammoBonus: 150 }, description: 'Every gun carries 150% more ammo. Heavy.',
  },
  // Armor: hit points vs weight.
  armor_plate: {
    id: 'armor_plate', name: 'Armor Plate', category: 'armor', cells: [4, 1, 1], color: '#8d99ae', cost: 30,
    stats: { mass: 35, armor: 4 }, description: 'Shields what is behind it.',
  },
  armor_bumper: {
    id: 'armor_bumper', name: 'Ram Bumper', category: 'armor', cells: [4, 1, 1], color: '#adb5bd', cost: 100,
    stats: { mass: 25, armor: 8 }, description: 'Very tough front bumper.',
  },
  // Weapons: destroy rocks, barrels and enemies. They always face forward.
  spike_ram: {
    id: 'spike_ram', name: 'Spike Ram', category: 'weapon', cells: [4, 1, 1], color: '#6c757d', cost: 25,
    stats: { mass: 35, armor: 4 }, description: 'Melee. Smashes what you drive into. Mount it at the front.',
    weapon: { type: 'melee', damage: 30, cooldown: 0.3, range: 0.6 },
  },
  buzz_saw: {
    id: 'buzz_saw', name: 'Buzz Saw', category: 'weapon', cells: [2, 1, 1], color: '#495057', cost: 90,
    stats: { mass: 28, armor: 3 }, description: 'Melee. Shreds things fast, even at low speed.',
    weapon: { type: 'melee', damage: 45, cooldown: 0.12, range: 0.8 },
  },
  machine_gun: {
    id: 'machine_gun', name: 'Machine Gun', category: 'weapon', cells: [1, 1, 2], color: '#343a40', cost: 40,
    stats: { mass: 15 }, description: 'Ranged. Fast, weak shots. Hold Space to fire.',
    weapon: { type: 'ranged', damage: 7, cooldown: 0.1, range: 50, projectileSpeed: 110, ammo: 150 },
  },
  cannon: {
    id: 'cannon', name: 'Cannon', category: 'weapon', cells: [2, 1, 2], color: '#212529', cost: 140,
    stats: { mass: 45 }, description: 'Ranged. Slow, heavy exploding shells.',
    weapon: { type: 'ranged', damage: 90, cooldown: 1.1, range: 70, projectileSpeed: 60, ammo: 16, splash: 3 },
  },
  // Wheels: size, grip and weight.
  wheel_small: {
    id: 'wheel_small', name: 'Small Wheel', category: 'wheel', cells: [1, 1, 1], color: '#222222', cost: 5,
    stats: { mass: 8, wheelRadius: 0.42, wheelWidth: 0.35, grip: 1 }, description: 'Basic wheel.',
  },
  wheel_offroad: {
    id: 'wheel_offroad', name: 'Off-road Wheel', category: 'wheel', cells: [1, 1, 1], color: '#3a2e1f', cost: 30,
    stats: { mass: 13, wheelRadius: 0.5, wheelWidth: 0.45, grip: 1.35 }, description: 'More grip.',
  },
  wheel_big: {
    id: 'wheel_big', name: 'Monster Wheel', category: 'wheel', cells: [1, 1, 1], color: '#222222', cost: 60,
    stats: { mass: 18, wheelRadius: 0.65, wheelWidth: 0.5, grip: 1.1 }, description: 'Huge, rolls over anything.',
  },
};

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  frame: 'Frame', cabin: 'Cabin', engine: 'Engine', fuelTank: 'Fuel', ammo: 'Ammo', armor: 'Armor', weapon: 'Weapons', wheel: 'Wheels',
};

/** One part placed on the grid. `cell` is the corner cell with the lowest x, y, z. */
export interface PlacedPart {
  partId: string;
  cell: Vec3;
  /** Orientation index into ORIENTATIONS (see orientation.ts). 0/missing = as designed, front = +Z. */
  orient?: number;
}

export interface CarBlueprint {
  name: string;
  parts: PlacedPart[];
}

export function stat(def: PartDef, key: keyof PartStats): number {
  return def.stats[key] ?? 0;
}

/** Orientation actually used for a part. Wheels always stand upright, so they ignore it. */
export function partOrient(p: PlacedPart): number {
  return PARTS[p.partId].category === 'wheel' ? 0 : p.orient ?? 0;
}

/** Size in cells of a placed part, taking rotation into account. */
export function partCells(p: PlacedPart): Vec3 {
  return rotatedCells(PARTS[p.partId].cells, partOrient(p));
}

/** A ranged weapon's ammo with ammo-box bonus (in percent) added. */
export function maxAmmo(baseAmmo: number, bonusPercent: number): number {
  return Math.round(baseAmmo * (1 + bonusPercent / 100));
}

/** Hit points of a part. */
export function partHp(def: PartDef): number {
  return CONFIG.damage.baseHp + stat(def, 'armor') * CONFIG.damage.hpPerArmor;
}

// ---------------------------------------------------------------------------
// Grid geometry helpers (shared by the garage, validation and damage)
// ---------------------------------------------------------------------------

/** Do two cell boxes overlap? */
export function boxesOverlap(a: Vec3, as: Vec3, b: Vec3, bs: Vec3): boolean {
  for (let i = 0; i < 3; i++) if (a[i] >= b[i] + bs[i] || b[i] >= a[i] + as[i]) return false;
  return true;
}

/** Do two cell boxes share a face (touch without overlapping)? */
export function boxesTouch(a: Vec3, as: Vec3, b: Vec3, bs: Vec3): boolean {
  let touching = 0;
  for (let i = 0; i < 3; i++) {
    const overlap = Math.min(a[i] + as[i], b[i] + bs[i]) - Math.max(a[i], b[i]);
    if (overlap < 0) return false;
    if (overlap === 0) touching++;
  }
  return touching === 1;
}

/** Indices of boxes reachable from `start` indices through touching faces. */
export function connectedSet(boxes: { cell: Vec3; cells: Vec3 }[], start: number[]): Set<number> {
  const seen = new Set<number>(start);
  const queue = [...start];
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < boxes.length; j++) {
      if (seen.has(j)) continue;
      if (boxesTouch(boxes[i].cell, boxes[i].cells, boxes[j].cell, boxes[j].cells)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen;
}

/** Problems that stop a blueprint from being driven. Empty array = good to go. */
export function validateBlueprint(bp: CarBlueprint): string[] {
  const errors: string[] = [];
  const parts = bp.parts.filter((p) => PARTS[p.partId]);
  const count = (cat: PartCategory) => parts.filter((p) => PARTS[p.partId].category === cat).length;
  if (count('cabin') === 0) errors.push('Add a cabin (the driver).');
  if (count('engine') === 0) errors.push('Add an engine.');
  if (count('fuelTank') === 0) errors.push('Add a fuel tank.');
  if (count('wheel') < 3) errors.push('Add at least 3 wheels.');

  const boxes = parts.map((p) => ({ cell: p.cell, cells: partCells(p) }));
  for (let i = 0; i < boxes.length; i++) {
    for (let k = 0; k < 3; k++) {
      if (boxes[i].cell[k] < 0 || boxes[i].cell[k] + boxes[i].cells[k] > GRID_DIMS[k]) {
        errors.push('A part is outside the build area.');
        break;
      }
    }
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i].cell, boxes[i].cells, boxes[j].cell, boxes[j].cells)) {
        errors.push('Two parts overlap.');
        i = boxes.length;
        break;
      }
    }
  }

  const cabins = parts.map((p, i) => (PARTS[p.partId].category === 'cabin' ? i : -1)).filter((i) => i >= 0);
  if (cabins.length) {
    const reached = connectedSet(boxes, cabins);
    if (reached.size < parts.length) errors.push('Some parts are not connected to the cabin.');
  }
  return errors;
}

/** Quick totals for the garage stats panel (works on unfinished blueprints too). */
/** Total coins the parts on a car are worth. */
export function partsCost(parts: PlacedPart[]): number {
  return parts.reduce((sum, p) => sum + PARTS[p.partId].cost, 0);
}

export function blueprintTotals(bp: CarBlueprint) {
  const t = { mass: 0, enginePower: 0, fuelCapacity: 0, ammoBonus: 0, armor: 0, wheels: 0, parts: 0, melee: 0, ranged: 0, shots: [] as number[] };
  for (const p of bp.parts) {
    const def = PARTS[p.partId];
    if (!def) continue;
    t.mass += stat(def, 'mass');
    t.enginePower += stat(def, 'enginePower');
    t.fuelCapacity += stat(def, 'fuelCapacity');
    t.ammoBonus += stat(def, 'ammoBonus');
    t.armor += stat(def, 'armor');
    if (def.category === 'wheel') t.wheels++;
    if (def.weapon?.type === 'melee') t.melee++;
    if (def.weapon?.type === 'ranged') t.ranged++;
    t.parts++;
  }
  // Shots each ranged weapon starts with, including ammo box bonus.
  for (const p of bp.parts) {
    const w = PARTS[p.partId]?.weapon;
    if (w?.type === 'ranged') t.shots.push(maxAmmo(w.ammo ?? 0, t.ammoBonus));
  }
  return t;
}

/** Adds up a blueprint's parts into a CarConfig the vehicle can be built from. */
export function buildCarConfig(blueprint: CarBlueprint): CarConfig {
  const parts = blueprint.parts.filter((p) => PARTS[p.partId]);
  const bodyParts = parts.filter((p) => PARTS[p.partId].category !== 'wheel');
  const wheelParts = parts.filter((p) => PARTS[p.partId].category === 'wheel');
  if (bodyParts.length === 0) throw new Error(`Blueprint "${blueprint.name}" has no body parts`);
  if (wheelParts.length === 0) throw new Error(`Blueprint "${blueprint.name}" has no wheels`);

  // Center the car on x/z using the body bounds; the bottom of the body sits at y = 0.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of bodyParts) {
    const c = partCells(p);
    minX = Math.min(minX, p.cell[0]); maxX = Math.max(maxX, p.cell[0] + c[0]);
    minY = Math.min(minY, p.cell[1]);
    minZ = Math.min(minZ, p.cell[2]); maxZ = Math.max(maxZ, p.cell[2] + c[2]);
  }
  const offX = (minX + maxX) / 2;
  const offZ = (minZ + maxZ) / 2;
  const toLocal = (gx: number, gy: number, gz: number): Vec3 => [
    (gx - offX) * GRID_SIZE,
    (gy - minY) * GRID_SIZE,
    (gz - offZ) * GRID_SIZE,
  ];

  const config: CarConfig = {
    name: blueprint.name, mass: 0, enginePower: 0, fuelCapacity: 0, armor: 0, blocks: [], wheels: [],
  };

  for (const p of parts) {
    const def = PARTS[p.partId];
    config.mass += stat(def, 'mass');
    config.enginePower += stat(def, 'enginePower');
    config.fuelCapacity += stat(def, 'fuelCapacity');
    config.armor += stat(def, 'armor');
  }

  for (const p of bodyParts) {
    const def = PARTS[p.partId];
    const [cx, cy, cz] = partCells(p);
    const orient = partOrient(p);
    const block: BodyBlock = {
      partId: def.id,
      name: def.name,
      category: def.category,
      cell: [...p.cell],
      cells: [cx, cy, cz],
      size: [cx * GRID_SIZE, cy * GRID_SIZE, cz * GRID_SIZE],
      orient,
      baseSize: [def.cells[0] * GRID_SIZE, def.cells[1] * GRID_SIZE, def.cells[2] * GRID_SIZE],
      facing: rotateVec([0, 0, 1], orient).map(Math.round) as Vec3,
      center: toLocal(p.cell[0] + cx / 2, p.cell[1] + cy / 2, p.cell[2] + cz / 2),
      mass: stat(def, 'mass'),
      color: def.color,
      armor: stat(def, 'armor'),
      hp: partHp(def),
      enginePower: stat(def, 'enginePower'),
      fuelCapacity: stat(def, 'fuelCapacity'),
      ammoBonus: stat(def, 'ammoBonus'),
      weapon: def.weapon,
    };
    config.blocks.push(block);
  }

  for (const p of wheelParts) {
    const def = PARTS[p.partId];
    const position = toLocal(p.cell[0] + 0.5, p.cell[1] + 0.5, p.cell[2] + 0.5);
    const isFront = position[2] > 0;
    const wheel: WheelMount = {
      partId: def.id,
      name: def.name,
      cell: [...p.cell],
      position,
      isFront,
      steers: isFront,
      radius: stat(def, 'wheelRadius'),
      width: stat(def, 'wheelWidth'),
      grip: stat(def, 'grip') || 1,
      mass: stat(def, 'mass'),
    };
    config.wheels.push(wheel);
  }

  return config;
}
