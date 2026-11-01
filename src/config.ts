/**
 * All the important tuning values live here.
 * Tweak these first if the driving feels off.
 *
 * Car-specific stats (mass, engine power, fuel tank, wheel size) are NOT here:
 * they come from the car's parts (see car/parts.ts and car/presets.ts).
 * The values below are "global feel" values that apply to every car.
 */
export const CONFIG = {
  physics: {
    /** World gravity (m/s²). Real is -9.81; higher = snappier, less floaty jumps. */
    gravity: -16,
    /** Physics steps per second. */
    stepHz: 60,
    /** Max physics steps per frame (stops a spiral of death on slow frames). */
    maxStepsPerFrame: 5,
  },

  driving: {
    /** Multiplier on the car's total engine power. Raise if the car feels sluggish. */
    engineForceScale: 1.0,
    /** Reverse is this fraction of forward force. */
    reverseFactor: 0.5,
    /** Brake strength per wheel when pressing S while moving forward (scaled by car mass). */
    brakeForce: 6,
    /** Small brake applied when no pedal is pressed (rolling resistance, scaled by car mass). */
    idleBrake: 0.2,
    /** Rolling resistance is multiplied by this when out of fuel, so the run ends sooner. */
    noFuelBrakeMultiplier: 4,
    /** Max steering angle in radians at low speed. */
    maxSteer: 0.55,
    /** Steering is reduced to this fraction of maxSteer at high speed. */
    highSpeedSteerFactor: 0.35,
    /** Speed (m/s) at which steering reaches its high-speed reduction. */
    steerFalloffSpeed: 30,
    /** How fast the wheels turn toward the target angle (higher = twitchier). */
    steerSpeed: 6,
    /** Which wheels get engine force: 'rear' | 'front' | 'all'. */
    drive: 'all' as 'rear' | 'front' | 'all',
    /** Top speed limiter in m/s (engine force fades out near this). */
    topSpeed: 38,
    /** How fast (rad/s²) W/S can pitch the car while airborne – keeps jumps fun. 0 = off. */
    airPitchAccel: 1.2,
  },

  suspension: {
    /** Spring strength. Lower = bouncier and softer, higher = stiffer. */
    stiffness: 22,
    /** Damping when the spring compresses. Lower = more bounce. */
    compression: 1.6,
    /** Damping when the spring extends. Lower = more bounce. */
    relaxation: 2.2,
    /** Spring length at rest (m). */
    restLength: 0.45,
    /** How far the wheel can travel (m). */
    maxTravel: 0.35,
    /** Cap on spring force. Keep high so heavy cars don't bottom out. */
    maxForce: 100000,
  },

  tires: {
    /** Forward grip. Lower = more wheelspin/sliding. */
    frictionSlip: 2.2,
    /** Sideways grip. Lower = more drifty. */
    sideFrictionStiffness: 0.9,
  },

  chassis: {
    /** Slows spinning in the air. Higher = less flipping. */
    angularDamping: 0.6,
    /**
     * Extra resistance to rotation, as a multiplier of the car's natural inertia.
     * 0 = realistic (flips easily), 1 = twice as hard to rotate. Arcade games cheat here.
     */
    extraInertia: 0.5,
    /** Lowers the center of mass (m). Lower = harder to roll over in turns. */
    centerOfMassDrop: 0.15,
    /** Air drag. */
    linearDamping: 0.05,
    /** Friction of the car body against the ground (when flipped/scraping). */
    bodyFriction: 0.6,
  },

  fuel: {
    /** Fuel units burned per second at full throttle (for a car of referenceMass). */
    burnPerSecond: 4.5,
    /** Fuel units burned per second while idle (0 = no idle burn). */
    idleBurnPerSecond: 0,
    /** Mass (kg) at which burn rate is exactly burnPerSecond. */
    referenceMass: 200,
    /** How much mass affects burn: 0 = not at all, 1 = double mass burns double. */
    massBurnFactor: 0.5,
    /** Fuel given by each can. */
    canAmount: 35,
    /** How close (m) the car must get to pick up a can. */
    pickupRadius: 3,
  },

  ammo: {
    /** Each ammo crate on the road refills this fraction of every gun's max ammo. */
    crateRefill: 0.5,
  },

  runOver: {
    /** With no fuel, moving forward (along the road) slower than this (m/s) counts as stalled. */
    stoppedSpeed: 0.6,
    /** Seconds the car must be stalled with no fuel before the run ends. */
    stoppedTime: 2,
  },

  damage: {
    /** Hit points of a part with 0 armor (wheels always have this much). */
    baseHp: 50,
    /** Extra hit points per armor point. */
    hpPerArmor: 15,
    /**
     * Hits weaker than this impulse (N·s) do no damage. For scale: the starter car
     * (190 kg) hitting a rock at 90 km/h is about 5000 N·s. Raise = tougher cars.
     */
    impulseThreshold: 200,
    /** Damage per N·s above the threshold. */
    damagePerImpulse: 0.012,
    /** Most damage one hit can do, so a single crash can't wreck everything at once. */
    maxHitDamage: 55,
    /** Hits from enemies count this many times harder. */
    enemyMultiplier: 2.5,
    /** Debris (broken-off parts) disappears after this many seconds. */
    debrisLifetime: 15,
    /** Max broken parts lying around at once. */
    maxDebris: 40,
  },

  explosions: {
    /**
     * damage = to the car (fades quickly toward the edge), targetDamage = to rocks/barrels/enemies,
     * impulse = push per kg. Player cannon shells never hurt your own car.
     */
    barrel: { radius: 5, damage: 45, impulse: 9, targetDamage: 80, hurtsCar: true },
    bomb: { radius: 3.5, damage: 30, impulse: 7, targetDamage: 40, hurtsCar: true },
    shell: { radius: 3, damage: 0, impulse: 6, targetDamage: 0, hurtsCar: false },
  },

  weapons: {
    /** Melee damage multiplier grows with speed: damage × (1 + min(meleeSpeedMax, speed / meleeSpeedDivisor)). */
    meleeSpeedDivisor: 8,
    meleeSpeedMax: 3,
    /** Crash damage a melee part takes is multiplied by this (it's built for hitting things). */
    meleeSelfDamage: 0.25,
    /** Ranged weapons auto-aim at targets within this angle (degrees) of straight ahead. */
    aimConeDegrees: 40,
  },

  obstacles: {
    /** No obstacles before this distance. */
    startZ: 150,
    /** Chance that a barrel is an explosive red one. */
    explosiveChance: 0.35,
    barrelMass: 25,
    /** Hit points of a rock of size 1 (rocks are 0.8–1.5 in size). */
    rockHp: 70,
    barrelHp: 15,
  },

  enemies: {
    /** Rollers: spiked balls that roll at you. */
    rollerStartZ: 280,
    rollerSpacingMin: 150,
    rollerSpacingMax: 260,
    rollerMass: 140,
    rollerHp: 40,
    rollerRadius: 0.9,
    /** How fast rollers can go (m/s) and how hard they push toward you. */
    rollerSpeed: 14,
    rollerAccel: 10,
    /** Hit a roller this hard (impulse, N·s) to destroy it. */
    rollerKillImpulse: 700,

    /** Drones: fly above you and drop bombs. */
    droneStartZ: 650,
    droneHeight: 8,
    droneHp: 30,
    droneBombInterval: 2.6,
    droneBombs: 4,
    /** Random aim error (m) – bigger = easier to dodge. */
    droneBombSpread: 2.5,
  },

  economy: {
    /** Coins a brand-new player starts with (on top of the free starter car). */
    startingCoins: 50,
    /** Coins earned per meter driven. */
    coinsPerMeter: 0.2,
    /** Bonus coins for destroying things. */
    rollerKillBonus: 15,
    droneKillBonus: 25,
    rockBonus: 3,
    /** Bonus coins for every full kilometre driven. */
    kmBonus: 100,
  },

  /**
   * The road never ends, but it gets harder the farther you go.
   * Each pair is [value at the start, value at full difficulty]; in between it blends smoothly.
   * Past `fullAt` the game stays at full difficulty.
   */
  difficulty: {
    /** Distance (m) where full difficulty is reached. */
    fullAt: 6000,
    /** Average distance between obstacle groups (m). Smaller = more obstacles. */
    obstacleSpacing: [62, 30] as [number, number],
    /** Chance an obstacle group is rocks (otherwise barrels). */
    rockChance: [0.4, 0.85] as [number, number],
    /** Most rocks in one group. */
    maxRocks: [2, 4] as [number, number],
    /** Average distance between fuel cans (m). Bigger = scarcer fuel. */
    fuelCanSpacing: [140, 420] as [number, number],
    /** Average distance between ammo crates on the road (m). Only placed if your car has guns. */
    ammoCrateSpacing: [220, 480] as [number, number],
    /** Average distance between drone attacks (m). Smaller = more drones. */
    droneSpacing: [600, 140] as [number, number],
    /** How many drones can be in the air at once. */
    maxDrones: [1, 3] as [number, number],
  },

  road: {
    /** Driveable road width (m). */
    width: 12,
    /** Grass shoulders on each side (m). */
    shoulderWidth: 30,
    /** Length of each road chunk (m). The road is built chunk by chunk as you drive. */
    chunkLength: 100,
    /** How far ahead of the car the road is built (m) – keep it past the fog distance. */
    buildAhead: 350,
    /** How far behind the car chunks are kept before being deleted (m). */
    keepBehind: 150,
    /** Distance between height samples along the road (m). */
    sampleStep: 1,
    /** Seed for the procedural layout (same seed = same road). */
    seed: 1337,
  },

  camera: {
    /** Distance behind the car. */
    distance: 9,
    /** Height above the car. */
    height: 4,
    /** How far ahead of the car to look. */
    lookAhead: 4,
    /** Position smoothing (higher = tighter follow). */
    positionLerp: 4,
    /** Look-target smoothing. */
    lookLerp: 8,
    fov: 65,
  },
} as const;

export type GameConfig = typeof CONFIG;
