import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import { createRng, hash2 } from '../core/random';

/**
 * The road runs along +Z. Its shape is defined by two pure functions:
 *   roadCenterX(z) – sideways sway of the road
 *   roadHeight(z)  – height of the road surface
 * Everything else (mesh, physics collider, pickup placement, obstacles)
 * is built from these, so changing the road layout only means changing them.
 * The road is endless: features are generated on demand as something asks about
 * a stretch of road, and the meshes are built chunk by chunk around the car.
 */

export type RoadFeatureType = 'ramp' | 'bumps' | 'gap';

/** A section of road with something special on it. Obstacles/enemies can use this later. */
export interface RoadFeature {
  type: RoadFeatureType;
  start: number;
  end: number;
  /** Ramps and gaps: where the take-off edge is (between start and end). For gaps the pit runs lip → end. */
  lip: number;
  /** Peak height (ramp/gap take-off) or bump height (bumps). */
  height: number;
}

/** Where the road begins (a little behind the start line so you can reverse a bit). */
export const ROAD_START_Z = -30;
/** Where the car spawns. */
export const SPAWN_Z = 0;

const FLAT_START = 40;
/** How deep gaps are (m). */
export const GAP_DEPTH = 12;
/** No gaps before this distance. */
const FIRST_GAP_Z = 450;

const featureRng = createRng(CONFIG.road.seed);
/** All features generated so far, sorted by start and never overlapping. */
const features: RoadFeature[] = [];
/** Where the next feature may start. */
let featureCursor = 110;

/** Make sure features exist up to (a bit past) z. Generated in order, so the road is always the same. */
function ensureFeatures(upTo: number) {
  const rng = featureRng;
  while (featureCursor < upTo + 400) {
    let z = featureCursor;
    const roll = rng.next();
    if (z > FIRST_GAP_Z && roll < 0.2) {
      // Gap = take-off ramp, then a deep pit you have to jump over.
      const up = rng.range(11, 14);
      const gap = rng.range(11, 16);
      features.push({ type: 'gap', start: z, lip: z + up, end: z + up + gap, height: rng.range(1.8, 2.3) });
      z += up + gap;
    } else if (roll < 0.5) {
      // Ramp = up-slope to a lip, then a long down-slope to land on.
      const up = rng.range(10, 16);
      const down = up * 2.2;
      // The first ramp is a small one so new players don't flip straight away.
      const height = features.length === 0 ? 1.4 : rng.range(1.6, 2.6);
      features.push({ type: 'ramp', start: z, lip: z + up, end: z + up + down, height });
      z += up + down;
    } else if (roll < 0.88) {
      const count = Math.floor(rng.range(3, 7));
      const len = count * 5;
      features.push({ type: 'bumps', start: z, lip: z + len, end: z + len, height: rng.range(0.2, 0.4) });
      z += len;
    }
    z += rng.range(90, 180);
    featureCursor = z;
  }
}

/** Index of the last feature starting at or before z (binary search), or -1. */
function featureIndexBefore(z: number): number {
  ensureFeatures(z);
  let lo = 0, hi = features.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (features[mid].start <= z) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Sideways position of the road center at distance z. Gentle sway, mostly straight. */
export function roadCenterX(z: number): number {
  const amount = smoothstep(FLAT_START, 300, z);
  return amount * (7 * Math.sin(z * 0.006) + 3 * Math.sin(z * 0.017 + 2));
}

function featureHeight(f: RoadFeature, z: number): number {
  if (f.type === 'gap') {
    if (z < f.start || z >= f.end) return 0;
    if (z <= f.lip) return f.height * Math.pow((z - f.start) / (f.lip - f.start), 1.2);
    return -GAP_DEPTH;
  }
  if (z < f.start || z > f.end) return 0;
  if (f.type === 'ramp') {
    if (z <= f.lip) {
      // Up-slope, slightly curved at the bottom so you don't scrape going in.
      const t = (z - f.start) / (f.lip - f.start);
      return f.height * Math.pow(t, 1.2);
    }
    // Down-slope landing.
    const t = (z - f.lip) / (f.end - f.lip);
    return f.height * (1 - t);
  }
  // Bumps: a row of rounded humps, 5 m apart.
  const local = (z - f.start) % 5;
  if (local > 3) return 0;
  return f.height * 0.5 * (1 - Math.cos((local / 3) * Math.PI * 2));
}

/** Height of the road surface at distance z. */
export function roadHeight(z: number): number {
  const hills = smoothstep(FLAT_START, 250, z);
  let h = hills * (3.0 * Math.sin(z * 0.012) + 1.4 * Math.sin(z * 0.031 + 1.3) + 0.5 * Math.sin(z * 0.07));
  const f = featureAt(z);
  if (f) h += featureHeight(f, z);
  // A wall behind the start so you can't reverse off the beginning.
  if (z < ROAD_START_Z + 8) h += (ROAD_START_Z + 8 - z) * 1.5;
  return h;
}

/** Is z over the pit of a gap? */
export function gapAt(z: number): RoadFeature | undefined {
  const f = featureAt(z);
  return f?.type === 'gap' && z > f.lip && z < f.end ? f : undefined;
}

/** Returns the feature at z, if any. */
export function featureAt(z: number): RoadFeature | undefined {
  const f = features[featureIndexBefore(z)];
  return f && z <= f.end ? f : undefined;
}

// ---------------------------------------------------------------------------
// Building the mesh + collider
// ---------------------------------------------------------------------------

type Surface = 'road' | 'curb' | 'grass';

/** Cross-section of the road: [x offset from center, height offset, surface of the strip to the right]. */
function crossSection(): { x: number; dy: number; surface: Surface }[] {
  const w = CONFIG.road.width / 2;
  const s = CONFIG.road.shoulderWidth;
  return [
    { x: -w - s, dy: 6, surface: 'grass' },
    { x: -w - s * 0.5, dy: 1.2, surface: 'grass' },
    { x: -w - 1, dy: 0.05, surface: 'curb' },
    { x: -w, dy: 0, surface: 'road' },
    { x: -w / 2, dy: 0, surface: 'road' },
    { x: 0, dy: 0, surface: 'road' },
    { x: w / 2, dy: 0, surface: 'road' },
    { x: w, dy: 0, surface: 'curb' },
    { x: w + 1, dy: 0.05, surface: 'grass' },
    { x: w + s * 0.5, dy: 1.2, surface: 'grass' },
    { x: w + s, dy: 6, surface: 'grass' },
  ];
}

/** Height of the ground at any (x, z), including the raised grass shoulders. */
export function groundHeightAt(x: number, z: number): number {
  const cs = crossSection();
  const dx = x - roadCenterX(z);
  let dy = cs[cs.length - 1].dy;
  if (dx <= cs[0].x) dy = cs[0].dy;
  for (let i = 0; i < cs.length - 1; i++) {
    if (dx >= cs[i].x && dx <= cs[i + 1].x) {
      const t = (dx - cs[i].x) / (cs[i + 1].x - cs[i].x);
      dy = cs[i].dy + (cs[i + 1].dy - cs[i].dy) * t;
      break;
    }
  }
  return roadHeight(z) + dy;
}

const COLORS = {
  road: [new THREE.Color('#4a4a52'), new THREE.Color('#55555e')],
  curb: [new THREE.Color('#e8e8e8'), new THREE.Color('#d6453a')],
  grass: [new THREE.Color('#6ab04c'), new THREE.Color('#5c9e40'), new THREE.Color('#78bd55')],
  ramp: [new THREE.Color('#f5b041'), new THREE.Color('#e67e22')],
  gapRamp: [new THREE.Color('#f1faee'), new THREE.Color('#d62828')],
  pit: [new THREE.Color('#4a3b33'), new THREE.Color('#3b2f2a')],
};

/** Modulo that is always positive (JS % is negative for negative numbers). */
const mod = (a: number, n: number) => ((a % n) + n) % n;

function surfaceColor(surface: Surface, z: number, col: number): THREE.Color {
  const f = featureAt(z);
  const gap = f?.type === 'gap' && z < f.end ? f : undefined;
  if (gap) {
    if (z >= gap.lip) return COLORS.pit[Math.round(hash2(z, col))];
    if (surface === 'road') return COLORS.gapRamp[mod(Math.floor(z / 1.5), 2)];
  }
  if (surface === 'road') {
    if (f?.type === 'ramp' && z <= f.lip) return COLORS.ramp[mod(Math.floor(z / 2), 2)];
    return COLORS.road[hash2(Math.floor(z), col) > 0.5 ? 1 : 0];
  }
  if (surface === 'curb') return COLORS.curb[mod(Math.floor(z / 2), 2)];
  return COLORS.grass[Math.min(2, Math.floor(hash2(Math.floor(z / 2), col) * 3))];
}

export interface RoadChunk {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  startZ: number;
  endZ: number;
}

/** Builds one chunk of road between z0 and z1: a faceted mesh and a matching trimesh collider. */
function buildChunk(world: RAPIER.World, material: THREE.Material, z0: number, z1: number): RoadChunk {
  const cs = crossSection();
  const step = CONFIG.road.sampleStep;
  const rows = Math.round((z1 - z0) / step) + 1;
  const cols = cs.length;

  // Indexed grid for physics.
  const verts = new Float32Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * step;
    const cx = roadCenterX(z);
    const h = roadHeight(z);
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3;
      verts[i] = cx + cs[c].x;
      verts[i + 1] = h + cs[c].dy;
      verts[i + 2] = z;
    }
  }
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Counter-clockwise when seen from above (+Y), so normals face up.
      indices[k++] = a; indices[k++] = d; indices[k++] = b;
      indices[k++] = b; indices[k++] = d; indices[k++] = e;
    }
  }

  // Non-indexed copy for rendering, so each face gets one flat color (low-poly look).
  const positions = new Float32Array(indices.length * 3);
  const colors = new Float32Array(indices.length * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const first = Math.min(indices[t], indices[t + 1], indices[t + 2]);
    const r = Math.floor(first / cols);
    const c = Math.min(indices[t] % cols, indices[t + 1] % cols, indices[t + 2] % cols);
    const z = z0 + r * step;
    const color = surfaceColor(cs[c].surface, z, c);
    for (let v = 0; v < 3; v++) {
      const src = indices[t + v] * 3;
      const dst = (t + v) * 3;
      positions[dst] = verts[src];
      positions[dst + 1] = verts[src + 1];
      positions[dst + 2] = verts[src + 2];
      colors[dst] = color.r;
      colors[dst + 1] = color.g;
      colors[dst + 2] = color.b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliderDesc = RAPIER.ColliderDesc.trimesh(verts, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
    .setFriction(1.0);
  world.createCollider(colliderDesc, body);

  return { mesh, body, startZ: z0, endZ: z1 };
}

const DASH_GEO = new THREE.BoxGeometry(0.3, 0.04, 3);
const DASH_MAT = new THREE.MeshLambertMaterial({ color: '#f4f1de' });

/** White dashes down the middle of the road between z0 and z1. */
function buildCenterLine(z0: number, z1: number): THREE.InstancedMesh {
  const dashes: number[] = [];
  for (let z = Math.max(4, Math.ceil((z0 - 4) / 8) * 8 + 4); z < z1; z += 8) {
    const f1 = featureAt(z)?.type, f2 = featureAt(z + 3)?.type;
    if (f1 === 'ramp' || f2 === 'ramp' || f1 === 'gap' || f2 === 'gap') continue;
    dashes.push(z);
  }
  const inst = new THREE.InstancedMesh(DASH_GEO, DASH_MAT, dashes.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  dashes.forEach((z, i) => {
    const zc = z + 1.5;
    const slope = Math.atan2(roadHeight(zc + 1.5) - roadHeight(zc - 1.5), 3);
    const yaw = Math.atan2(roadCenterX(zc + 1.5) - roadCenterX(zc - 1.5), 3);
    q.setFromEuler(euler.set(-slope, yaw, 0, 'YXZ'));
    m.compose(new THREE.Vector3(roadCenterX(zc), roadHeight(zc) + 0.03, zc), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m);
  });
  inst.receiveShadow = true;
  return inst;
}

/**
 * The endless road. Call build(i)/drop(i) for chunk i (see chunkRange) as the car moves;
 * only the chunks near the car exist at any time.
 */
export class Road {
  readonly group = new THREE.Group();
  private chunks = new Map<number, { chunk: RoadChunk; line: THREE.InstancedMesh }>();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  constructor(private world: RAPIER.World) {}

  build(i: number) {
    if (this.chunks.has(i)) return;
    const [z0, z1] = chunkRange(i);
    const chunk = buildChunk(this.world, this.material, z0, z1);
    const line = buildCenterLine(z0, z1);
    this.group.add(chunk.mesh, line);
    this.chunks.set(i, { chunk, line });
  }

  drop(i: number) {
    const c = this.chunks.get(i);
    if (!c) return;
    c.chunk.mesh.removeFromParent();
    c.chunk.mesh.geometry.dispose();
    c.line.removeFromParent();
    c.line.dispose();
    this.world.removeRigidBody(c.chunk.body);
    this.chunks.delete(i);
  }
}

/** Start and end z of road chunk i. Chunk 0 starts at ROAD_START_Z. */
export function chunkRange(i: number): [number, number] {
  const len = CONFIG.road.chunkLength;
  return [ROAD_START_Z + i * len, ROAD_START_Z + (i + 1) * len];
}

/** Index of the chunk containing z. */
export function chunkIndexAt(z: number): number {
  return Math.floor((z - ROAD_START_Z) / CONFIG.road.chunkLength);
}
