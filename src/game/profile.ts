import { CONFIG } from '../config';
import { PARTS, type CarBlueprint, type PlacedPart } from '../car/parts';
import { STARTER_CAR } from '../car/presets';

/** Progress that survives between runs and page reloads (saved in localStorage). */
export interface Profile {
  coins: number;
  bestDistance: number;
  /** The car currently in the garage. Its parts are already paid for. */
  blueprint: CarBlueprint;
}

const KEY = 'blocky-road-profile-v1';

/** Old unlock prices, used once to refund saves from before parts were paid per piece. */
const OLD_UNLOCK_PRICES: Record<string, number> = {
  cabin_armored: 300, engine_big: 250, engine_turbo: 600, tank_large: 150, armor_plate: 100,
  armor_bumper: 350, buzz_saw: 280, cannon: 420, wheel_offroad: 180, wheel_big: 300,
};

/**
 * Old saves stored `rot: 1` (a flat quarter turn) and weapons kept firing forward.
 * Now that maps to orientation 1, except square weapons, which stay facing forward.
 */
function migratePart(p: PlacedPart & { rot?: number }): PlacedPart {
  const { rot, ...part } = p;
  if (rot === 1 && part.orient === undefined) {
    const def = PARTS[part.partId];
    part.orient = def.weapon && def.cells[0] === def.cells[2] ? 0 : 1;
  }
  return part;
}

function cloneBlueprint(bp: CarBlueprint): CarBlueprint {
  return { name: bp.name, parts: bp.parts.map((p) => ({ ...p, cell: [...p.cell] })) };
}

export function defaultProfile(): Profile {
  // New players get the starter car for free, plus a little money to tinker with.
  return { coins: CONFIG.economy.startingCoins, bestDistance: 0, blueprint: cloneBlueprint(STARTER_CAR) };
}

export function starterBlueprint(): CarBlueprint {
  return cloneBlueprint(STARTER_CAR);
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const data = JSON.parse(raw) as Partial<Profile> & { unlocked?: unknown };
    const profile = defaultProfile();
    if (typeof data.coins === 'number') profile.coins = data.coins;
    if (typeof data.bestDistance === 'number') profile.bestDistance = data.bestDistance;
    // Parts used to be unlocked once; give that money back now that every piece costs coins.
    if (Array.isArray(data.unlocked)) {
      for (const id of data.unlocked) profile.coins += OLD_UNLOCK_PRICES[id as string] ?? 0;
    }
    if (data.blueprint && Array.isArray(data.blueprint.parts)) {
      profile.blueprint = {
        name: data.blueprint.name || 'My Car',
        parts: data.blueprint.parts.filter((p) => p && p.partId in PARTS && Array.isArray(p.cell)).map(migratePart),
      };
    }
    if (Array.isArray(data.unlocked)) saveProfile(profile); // refund only once
    return profile;
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Storage blocked (private mode etc.) – progress just won't persist.
  }
}
