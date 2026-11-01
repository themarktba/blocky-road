import type { CarBlueprint, PlacedPart } from './parts';

/**
 * Ready-made cars. Grid cells are 0.5 m, build area is GRID_DIMS (10 x 6 x 14 cells).
 * x = sideways, y = up, z = forward (higher z = front of the car).
 */

/** Shift parts so a car designed around (0,0,0) sits in the middle of the build area. */
function centered(parts: PlacedPart[]): PlacedPart[] {
  return parts.map((p) => ({ ...p, cell: [p.cell[0] + 3, p.cell[1], p.cell[2] + 4] }));
}

export const STARTER_CAR: CarBlueprint = {
  name: 'Starter Buggy',
  parts: centered([
    { partId: 'frame_basic', cell: [0, 0, 0] }, // 4 x 1 x 6 cells = 2 m x 0.5 m x 3 m
    { partId: 'tank_small', cell: [0, 1, 0] }, // rear
    { partId: 'cabin_basic', cell: [0, 1, 2] }, // middle
    { partId: 'engine_small', cell: [1, 1, 4] }, // front
    // Wheels in the cells just outside the frame: left x = -1, right x = 4; rear z = 0, front z = 5.
    { partId: 'wheel_small', cell: [-1, 0, 0] },
    { partId: 'wheel_small', cell: [4, 0, 0] },
    { partId: 'wheel_small', cell: [-1, 0, 5] },
    { partId: 'wheel_small', cell: [4, 0, 5] },
  ]),
};

/** A heavier build using unlockable parts – handy for testing trade-offs. */
export const HAULER_CAR: CarBlueprint = {
  name: 'Hauler',
  parts: centered([
    { partId: 'frame_basic', cell: [0, 0, 0] },
    { partId: 'tank_large', cell: [0, 1, 0] },
    { partId: 'cabin_basic', cell: [0, 1, 2] },
    { partId: 'engine_big', cell: [0, 1, 4] },
    { partId: 'wheel_big', cell: [-1, 0, 0] },
    { partId: 'wheel_big', cell: [4, 0, 0] },
    { partId: 'wheel_big', cell: [-1, 0, 5] },
    { partId: 'wheel_big', cell: [4, 0, 5] },
  ]),
};
