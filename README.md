# Blocky Road

**Play it:** https://themarktba.github.io/blocky-road/ (rebuilt and published automatically on every push to `main`).

Low-poly 3D driving game: build a car from parts in the garage, drive as far as you can,
collect fuel, dodge obstacles and enemies, earn coins, spend them on better parts.
Vite + TypeScript + Three.js + Rapier (ray-cast vehicle controller).

## Run

    npm install
    npm run dev        # then open the URL it prints (http://localhost:5173)
    npm run build      # typecheck + production build into dist/

**Garage:** left click place part · right click remove · R turn · T tilt · F roll (Shift = the other way; any of 24 orientations) · Ctrl+Z undo · drag orbit · scroll zoom.
Every piece costs coins each time you put one on the car (price shown on the part); removing a piece or pressing Undo refunds it in full. Parts you can't afford are dimmed. Prices are the `cost` field in `src/car/parts.ts`; starting money is `CONFIG.economy.startingCoins`.
**Driving:** W/S or ↑/↓ gas / brake-reverse · A/D steer · Space fire · R reset upright · Esc end run.
**Run over:** Enter drive again · G garage.

**Phones and tablets** (touch controls appear automatically):
- Driving: steering pad bottom-left (slide your thumb across), gas and brake pedals bottom-right,
  fire button above them when your car has a ranged weapon, reset and end-run buttons at the top.
- Garage: tap to place (or to remove, in Remove mode), drag to orbit, pinch to zoom.
  The toolbar has Place / Remove / Rotate / Undo, plus Full screen where the phone supports it.
- Works in portrait and landscape; landscape gives the best view while driving.
- To test on your phone: run `npm run dev -- --host`, then open the Network URL it prints (same Wi-Fi).

Progress (coins, best distance, your car) is saved in the browser's localStorage.
To wipe it: `localStorage.clear()` in the browser console.

## How the game works

- **Car = parts on a grid.** Every part adds mass and its own stats (engine power, fuel, armor, wheel size/grip).
  Heavier cars accelerate slower, climb worse and burn more fuel.
- A car needs a **cabin**, an **engine**, a **fuel tank** and **3+ wheels**, all connected.
- **Damage:** each part has hit points (more with armor). Hard hits wear the part that was hit;
  explosions hurt everything nearby. A part at 0 HP breaks off, and so does anything no longer
  connected to a cabin (including wheels). Lose the engine → you coast to a stop. Lose the tank →
  no fuel. Lose every cabin → wrecked.
- **Obstacles:** rocks (solid), blue barrels (knockable), red barrels (explode, chain reactions),
  gaps (red/white ramp – jump it or fall in and get put back before it).
- **Enemies:** spiked rollers roll at you (hit them hard enough to smash them for bonus coins);
  drones fly over and drop bombs – the red ring shows where each bomb will land.
- **Weapons** (always face forward):
  - *Melee* (Spike Ram, Buzz Saw): hit whatever is right in front of them, harder at speed. They take
    only a quarter of crash damage, so a ram up front lets you plough through rocks.
  - *Ranged* (Machine Gun, Cannon): hold **Space** to fire. They auto-aim at the closest target ahead
    (enemies first) and have limited ammo per run. Cannon shells explode.
  - Rocks, barrels, rollers and drones all have hit points and pay coins when destroyed.
- **Endless road that gets harder:** there's no finish line. The farther you go, the more obstacle groups there are, the more of them are rocks (in bigger clusters), the scarcer fuel cans get, and the more often drones attack (up to 3 at once). Everything ramps up steadily until full difficulty at `CONFIG.difficulty.fullAt` (6 km) and stays there. Every full kilometre pays `CONFIG.economy.kmBonus` coins. All the start/full values are in `CONFIG.difficulty`.
- **Ammo:** ranged weapons start with their base ammo plus the bonus from **Ammo Box** (+50%) and **Ammo Crate** (+150%) parts – like fuel tanks, but for guns. Lose a box in a crash and the guns hold less. Green ammo crates on the road (only if your car has guns) refill half of every gun (`CONFIG.ammo.crateRefill`); they get scarcer with distance (`CONFIG.difficulty.ammoCrateSpacing`).
- **Coins:** earned per meter driven plus bonuses; spent on parts in the garage.

## Code map

| File | What it does |
|---|---|
| `src/config.ts` | **All tuning values**: physics, driving, suspension, tires, fuel, damage, explosions, obstacles, enemies, economy, road, camera. |
| `src/main.ts` | Loads Rapier and the saved profile, starts the game. |
| `src/game/Game.ts` | Switches garage ↔ driving. Driving loop: input → physics → contacts/damage → rules → render. |
| `src/game/state.ts` | Run state (fuel, distance, coins, end reason) and the rules that update it. |
| `src/game/profile.ts` | Saved progress: coins, best distance, current blueprint. |
| `src/car/parts.ts` | **Part catalog**, grid helpers, blueprint validation, `buildCarConfig(blueprint)`. |
| `src/car/presets.ts` | Ready-made blueprints (`STARTER_CAR`, `HAULER_CAR`). |
| `src/car/carConfig.ts` | `CarConfig` type: what the vehicle is built from. |
| `src/car/vehicle.ts` | Rapier vehicle: one collider per part, ray-cast wheels, driving, damage and breaking off. |
| `src/garage/Garage.ts` | 3D build grid: ghost preview, place/remove/rotate, orbit camera. |
| `src/car/orientation.ts` | The 24 ways a part can be turned; weapons fire/hit the way their front points. |
| `src/ui/garageUi.ts` | Garage panels: part list, buying, car stats, problems, Drive button. |
| `src/ui/hud.ts` | Driving HUD, alerts, and the "Run over" screen. |
| `src/ui/touchControls.ts` | On-screen driving buttons for touch devices (they press the same keys as the keyboard). |
| `src/core/device.ts` | Touch / small-screen detection. |
| `src/world/road.ts` | Road shape (`roadHeight`, `roadCenterX`, `groundHeightAt`), ramps/bumps/gaps, mesh + collider, built in chunks ahead of the car (endless). |
| `src/game/difficulty.ts` | How hard the road is at a given distance (`difficultyAt`, `scaled`). |
| `src/world/obstacles.ts` | Rocks and barrels (red ones explode). |
| `src/world/pickups.ts` | Fuel cans and ammo crates on the road. |
| `src/world/debris.ts` | Broken-off parts as physics pieces that despawn after a while. |
| `src/world/scenery.ts` | Decorative trees and rocks. |
| `src/enemies/enemies.ts` | Rollers, drones and bombs: spawning and behavior. |
| `src/weapons/weapons.ts` | Melee hits, ranged firing/auto-aim, projectiles. |
| `src/game/targets.ts` | `Target` interface: anything weapons and explosions can destroy. |
| `src/car/partVisuals.ts` | Extra detail meshes for parts (spikes, saw, gun barrels), shared by garage and car. |
| `src/effects/explosionFx.ts` | Explosion visuals (fireball + flying bits). |
| `src/core/*` | Input, renderer/lights, follow camera, seeded random. |

## Common changes

- **New part:** add an entry to `PARTS` in `src/car/parts.ts`. The garage picks it up automatically.
  For a weapon, give it a `weapon: { type, damage, cooldown, range, ... }` spec.
- **Weapon balance:** each weapon's numbers are in `PARTS`; shared rules are in `CONFIG.weapons`;
  target toughness is `CONFIG.obstacles.rockHp/barrelHp` and `CONFIG.enemies.rollerHp/droneHp`.
- **Harder/easier:** `CONFIG.damage` (toughness), `CONFIG.enemies` (spawn spacing, bombs),
  `CONFIG.obstacles` (spacing, explosive chance), `CONFIG.fuel` (burn rate, can amount).
- **New enemy:** follow the roller/drone pattern in `src/enemies/enemies.ts` (spawn rule in `update()`,
  its own update function). Contact damage from physics bodies works automatically.

## Live tuning

In the browser console, `CONFIG` and `game` are available. Most values apply instantly:

    CONFIG.suspension.stiffness = 30
    CONFIG.tires.frictionSlip = 1.5
    CONFIG.damage.damagePerImpulse = 0.006

Mass values (`chassis.extraInertia`, `chassis.centerOfMassDrop`) need `game.vehicle.applyMassTuning()`.
Copy values you like into `src/config.ts`.
