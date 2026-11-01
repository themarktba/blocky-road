import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../car/carConfig';
import {
  GRID_DIMS, GRID_SIZE, PARTS, boxesOverlap, partCells, partOrient, partsCost, stat, type CarBlueprint, type PlacedPart,
} from '../car/parts';
import { addPartDetails } from '../car/partVisuals';
import { orientationQuat, rotateOrientation, type RotateAxis } from '../car/orientation';

const G = GRID_SIZE;
const [GX, GY, GZ] = GRID_DIMS;

/** World position of a cell's lowest corner. The build area is centered on x/z. */
function cellToWorld(c: Vec3): THREE.Vector3 {
  return new THREE.Vector3((c[0] - GX / 2) * G, c[1] * G, (c[2] - GZ / 2) * G);
}

function worldToCell(p: THREE.Vector3): Vec3 {
  return [Math.floor(p.x / G + GX / 2), Math.floor(p.y / G), Math.floor(p.z / G + GZ / 2)];
}

/** Build a mesh for one part, positioned in the garage. Shared look with the in-game car. */
function createPartMesh(p: PlacedPart, opacity = 1): THREE.Mesh {
  const def = PARTS[p.partId];
  const size = partCells(p);
  const base = def.cells;
  const transparent = opacity < 1;
  let mesh: THREE.Mesh;
  if (def.category === 'wheel') {
    const r = stat(def, 'wheelRadius');
    const geo = new THREE.CylinderGeometry(r, r, stat(def, 'wheelWidth'), 10).rotateZ(Math.PI / 2);
    mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#222', flatShading: true, transparent, opacity }));
  } else {
    // Built as designed, then turned (below), so spikes/barrels turn with it.
    const geo = new THREE.BoxGeometry(base[0] * G, base[1] * G, base[2] * G);
    mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: def.color, flatShading: true, transparent, opacity }));
    if (!transparent) {
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: '#000', transparent: true, opacity: 0.4 }),
      ));
    }
    addPartDetails(mesh, def.id, [base[0] * G, base[1] * G, base[2] * G]);
    mesh.quaternion.copy(orientationQuat(partOrient(p)));
  }
  const min = cellToWorld(p.cell);
  mesh.position.set(min.x + (size[0] * G) / 2, min.y + (size[1] * G) / 2, min.z + (size[2] * G) / 2);
  mesh.castShadow = !transparent;
  return mesh;
}

export type GarageMode = 'place' | 'remove';

/**
 * The garage: a 3D grid where you build your car out of parts.
 * Click/tap places the selected part (or removes one in remove mode), right click always removes,
 * R turns, T tilts, F rolls the part (any of 24 orientations), Ctrl+Z undoes, drag orbits, scroll/pinch zooms.
 * It edits a CarBlueprint in place and calls onChange after every edit.
 * Every piece costs coins: each edit asks `pay` for the cost difference first
 * (negative = refund), and the edit is skipped if you can't afford it.
 */
export class Garage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private partsGroup = new THREE.Group();
  private partMeshes: THREE.Mesh[] = [];
  private floor: THREE.Mesh;
  private ghost: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private down: { x: number; y: number; button: number } | null = null;
  private active = false;
  /** Fingers/buttons currently down, and whether this gesture used more than one (pinch = not a tap). */
  private pointersDown = new Set<number>();
  private multiTouch = false;
  /** Earlier versions of the blueprint, for undo. */
  private history: string[] = [];

  mode: GarageMode = 'place';

  selectedPartId: string | null = 'frame_block';
  /** Orientation for the next part placed (index into ORIENTATIONS). */
  orientation = 0;
  /** Where the ghost currently is, and whether it can be placed there. */
  private preview: { part: PlacedPart; valid: boolean } | null = null;

  constructor(
    private dom: HTMLCanvasElement,
    public blueprint: CarBlueprint,
    private onChange: () => void,
    private pay: (coins: number) => boolean,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(-7, 6, -8);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 18;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.enabled = false;

    this.scene.background = new THREE.Color('#25313d');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#3b4a57', 1.8));
    const sun = new THREE.DirectionalLight('#fff4e0', 2);
    sun.position.set(-6, 12, -4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);

    // Workshop floor + build grid.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: '#33414e' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(this.createGridLines());

    // Invisible floor of the build area: what the mouse hits when not pointing at a part.
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(GX * G, GZ * G).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.scene.add(this.floor);

    // "FRONT" arrow so you know which way the car will drive.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#ffd166' }));
    arrow.position.set(0, 0.05, (GZ / 2) * G + 0.8);
    arrow.scale.y = 0.2;
    this.scene.add(arrow);

    this.scene.add(this.partsGroup);
    this.rebuild();

    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.isPrimary) this.pointersDown.clear(); // first finger of a new gesture
      this.pointersDown.add(e.pointerId);
      if (this.pointersDown.size > 1) this.multiTouch = true;
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
    // A finger can lift anywhere (even over a menu): always forget it, or later taps look like pinches.
    const forget = (e: PointerEvent) => {
      this.pointersDown.delete(e.pointerId);
      if (this.pointersDown.size === 0) this.multiTouch = false;
    };
    window.addEventListener('pointerup', forget);
    window.addEventListener('pointercancel', forget);
    dom.addEventListener('pointerleave', () => (this.pointerInside = false));
    dom.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.code === 'KeyZ') {
          e.preventDefault();
          this.undo();
        }
        return;
      }
      if (e.code === 'KeyR') this.rotate('y', e.shiftKey ? 3 : 1);
      if (e.code === 'KeyT') this.rotate('x', e.shiftKey ? 3 : 1);
      if (e.code === 'KeyF') this.rotate('z', e.shiftKey ? 3 : 1);
    });
    const resize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      // Pull the camera's FOV wider on portrait screens so the whole build area fits.
      this.camera.fov = this.camera.aspect < 1 ? Math.min(80, 50 / Math.max(this.camera.aspect, 0.5)) : 50;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  private createGridLines(): THREE.Object3D {
    const pts: number[] = [];
    const x0 = (-GX / 2) * G, x1 = (GX / 2) * G, z0 = (-GZ / 2) * G, z1 = (GZ / 2) * G;
    for (let i = 0; i <= GX; i++) pts.push(x0 + i * G, 0, z0, x0 + i * G, 0, z1);
    for (let i = 0; i <= GZ; i++) pts.push(x0, 0, z0 + i * G, x1, 0, z0 + i * G);
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const group = new THREE.Group();
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#5f7a8c', transparent: true, opacity: 0.6 })));
    // Outline of the whole build volume.
    const box = new THREE.BoxGeometry(GX * G, GY * G, GZ * G).translate(0, (GY * G) / 2, 0);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: '#5f7a8c', transparent: true, opacity: 0.25 })));
    return group;
  }

  setActive(on: boolean) {
    this.active = on;
    this.controls.enabled = on;
    if (!on && this.ghost) this.ghost.visible = false;
  }

  /** Recreate all part meshes from the blueprint. */
  rebuild() {
    for (const m of this.partMeshes) m.removeFromParent();
    this.partMeshes = this.blueprint.parts.map((p, i) => {
      const mesh = createPartMesh(p);
      mesh.userData.partIndex = i;
      this.partsGroup.add(mesh);
      return mesh;
    });
  }

  /** Turn the part being placed a quarter turn (or `times` quarter turns) around a garage axis. */
  rotate(axis: RotateAxis, times = 1) {
    for (let i = 0; i < times; i++) this.orientation = rotateOrientation(this.orientation, axis);
    this.onChange();
  }

  /** Back to the part's normal orientation. */
  resetRotation() {
    this.orientation = 0;
    this.onChange();
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  undo() {
    const prev = this.history[this.history.length - 1];
    if (!prev) return;
    const parts: PlacedPart[] = JSON.parse(prev);
    if (!this.pay(partsCost(parts) - partsCost(this.blueprint.parts))) return;
    this.history.pop();
    this.blueprint.parts = parts;
    this.preview = null;
    this.rebuild();
    this.onChange();
  }

  /** Remember the current blueprint so the next edit can be undone. */
  private snapshot() {
    this.history.push(JSON.stringify(this.blueprint.parts));
    if (this.history.length > 50) this.history.shift();
  }

  /** Swap in a whole new car (e.g. the starter car). Returns false if you can't afford it. */
  setBlueprint(bp: CarBlueprint): boolean {
    if (bp === this.blueprint) return true;
    if (!this.pay(partsCost(bp.parts) - partsCost(this.blueprint.parts))) return false;
    this.snapshot();
    this.blueprint = bp;
    this.preview = null;
    this.rebuild();
    this.onChange();
    return true;
  }

  update() {
    this.controls.update();
    this.updatePreview();
  }

  // -------------------------------------------------------------------------
  // Mouse
  // -------------------------------------------------------------------------

  private onPointerMove(e: PointerEvent) {
    if (!this.active) return;
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerInside = true;
  }

  private onPointerUp(e: PointerEvent) {
    this.pointersDown.delete(e.pointerId);
    const wasMulti = this.multiTouch;
    if (this.pointersDown.size === 0) this.multiTouch = false;
    if (!this.active || !this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    const button = this.down.button;
    this.down = null;
    // A drag (orbit) or a pinch (zoom) is not a tap. Fingers wobble more than mice.
    if (wasMulti || moved > (e.pointerType === 'touch' ? 12 : 6)) return;
    this.onPointerMove(e);
    if (button === 2 || (button === 0 && this.mode === 'remove')) this.removeAtPointer();
    else if (button === 0) this.placeAtPointer();
    // Fingers don't hover: hide the ghost after a tap.
    if (e.pointerType === 'touch') this.pointerInside = false;
  }

  private hit() {
    this.partsGroup.updateMatrixWorld(); // parts may have just been rebuilt
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects([...this.partMeshes, this.floor], false)[0];
  }

  /** Work out where the selected part would go for the current mouse position. */
  private computePlacement(): PlacedPart | null {
    if (!this.selectedPartId || !this.pointerInside || this.mode === 'remove') return null;
    const h = this.hit();
    if (!h || !h.face) return null;
    const probe: PlacedPart = { partId: this.selectedPartId, cell: [0, 0, 0], orient: this.orientation };
    const size = partCells(probe);

    // Cell next to the face we're pointing at, and which axis/direction that face points.
    const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    let axis = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(normal.getComponent(k)) > Math.abs(normal.getComponent(axis))) axis = k;
    const sign = Math.sign(normal.getComponent(axis)) || 1;
    const target = worldToCell(h.point.clone().addScaledVector(normal, G * 0.5));

    const cell: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      if (k === axis) cell[k] = sign > 0 ? target[k] : target[k] - size[k] + 1;
      else cell[k] = target[k] - Math.floor((size[k] - 1) / 2);
    }
    if (h.object === this.floor) cell[1] = 0;
    return { ...probe, cell };
  }

  private canPlace(part: PlacedPart): boolean {
    const size = partCells(part);
    for (let k = 0; k < 3; k++) {
      if (part.cell[k] < 0 || part.cell[k] + size[k] > GRID_DIMS[k]) return false;
    }
    return !this.blueprint.parts.some((p) => boxesOverlap(p.cell, partCells(p), part.cell, size));
  }

  private updatePreview() {
    const part = this.active ? this.computePlacement() : null;
    const key = part ? `${part.partId}|${part.cell.join()}|${part.orient}` : '';
    const prevKey = this.preview ? `${this.preview.part.partId}|${this.preview.part.cell.join()}|${this.preview.part.orient}` : '';
    if (key === prevKey) return;

    if (this.ghost) {
      this.ghost.removeFromParent();
      this.ghost = null;
    }
    this.preview = null;
    if (!part) return;
    const valid = this.canPlace(part);
    this.preview = { part, valid };
    this.ghost = createPartMesh(part, 0.55);
    (this.ghost.material as THREE.MeshLambertMaterial).color.set(valid ? '#7bd389' : '#ef476f');
    (this.ghost.material as THREE.MeshLambertMaterial).depthWrite = false;
    this.scene.add(this.ghost);
  }

  private placeAtPointer() {
    this.updatePreview();
    if (!this.preview || !this.preview.valid) return;
    if (!this.pay(PARTS[this.preview.part.partId].cost)) return;
    this.snapshot();
    this.blueprint.parts.push(this.preview.part);
    this.preview = null;
    this.rebuild();
    this.onChange();
  }

  private removeAtPointer() {
    const h = this.hit();
    if (!h || h.object === this.floor) return;
    const i = h.object.userData.partIndex as number;
    this.pay(-PARTS[this.blueprint.parts[i].partId].cost); // full refund
    this.snapshot();
    this.blueprint.parts.splice(i, 1);
    this.preview = null;
    this.rebuild();
    this.onChange();
  }
}
