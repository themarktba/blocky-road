import { CONFIG } from '../config';

/** Which screen the game is on. */
export type GamePhase = 'garage' | 'driving' | 'runOver';

export type RunEndReason = 'fuel' | 'stalled' | 'wrecked' | 'gaveUp';

/** Everything about the current run that isn't physics. Plain data = easy to show. */
export interface RunState {
  phase: GamePhase;
  fuel: number;
  fuelCapacity: number;
  /** Furthest distance reached this run (m). */
  distance: number;
  /** Seconds the car has been stalled (no fuel or no engine). */
  stoppedTimer: number;
  cansCollected: number;
  enemiesDestroyed: number;
  obstaclesDestroyed: number;
  partsLost: number;
  bonusCoins: number;
  endReason: RunEndReason | null;
}

export function createRunState(fuelCapacity: number): RunState {
  return {
    phase: 'driving',
    fuel: fuelCapacity,
    fuelCapacity,
    distance: 0,
    stoppedTimer: 0,
    cansCollected: 0,
    enemiesDestroyed: 0,
    obstaclesDestroyed: 0,
    partsLost: 0,
    bonusCoins: 0,
    endReason: null,
  };
}

/** Coins earned so far this run. */
export function runCoins(state: RunState): number {
  return Math.floor(state.distance * CONFIG.economy.coinsPerMeter) + state.bonusCoins;
}

/** Fuel burned per second at full throttle for a car of this mass. */
export function burnRate(carMass: number): number {
  const f = CONFIG.fuel;
  const massRatio = carMass / f.referenceMass;
  return f.burnPerSecond * (1 + f.massBurnFactor * (massRatio - 1));
}

export function addFuel(state: RunState, amount: number) {
  state.fuel = Math.min(state.fuelCapacity, state.fuel + amount);
}

/** End the run. */
export function endRun(state: RunState, reason: RunEndReason) {
  if (state.phase !== 'driving') return;
  state.phase = 'runOver';
  state.endReason = reason;
}

/**
 * Advance the run by dt seconds. Returns true if the run just ended.
 * `throttle` is how hard the engine worked (0..1).
 */
export function updateRun(
  state: RunState,
  dt: number,
  opts: { throttle: number; carMass: number; distance: number; forwardSpeed: number; hasEngine: boolean },
): boolean {
  if (state.phase !== 'driving') return false;
  const f = CONFIG.fuel;

  const burn = opts.throttle * burnRate(opts.carMass) + f.idleBurnPerSecond;
  state.fuel = Math.max(0, state.fuel - burn * dt);
  state.distance = Math.max(state.distance, opts.distance);

  // Can't drive (no fuel or engine gone) and not making forward progress → run over.
  const canDrive = state.fuel > 0 && opts.hasEngine;
  const stalled = opts.forwardSpeed < CONFIG.runOver.stoppedSpeed;
  if (!canDrive && stalled) {
    state.stoppedTimer += dt;
  } else {
    state.stoppedTimer = 0;
  }
  if (state.stoppedTimer >= CONFIG.runOver.stoppedTime) {
    endRun(state, state.fuel <= 0 ? 'fuel' : 'stalled');
    return true;
  }
  return false;
}
