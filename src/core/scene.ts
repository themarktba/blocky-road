import * as THREE from 'three';
import { CONFIG } from '../config';
import { IS_SMALL_SCREEN, IS_TOUCH } from './device';

/** Renderer, scene, lights and resize handling. */
export class SceneSetup {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** The sun follows the car so shadows always look sharp near it. */
  readonly sun: THREE.DirectionalLight;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // Phones have very high pixel ratios; 1.5 looks sharp and is much cheaper than 3.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const sky = new THREE.Color('#9fd3f2');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 80, 260);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 600);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#5c7a3a', 1.6));
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.castShadow = true;
    const shadowSize = IS_SMALL_SCREEN ? 1024 : 2048;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = 40;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 150 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    const resize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.fov = SceneSetup.fovFor(this.camera.aspect, CONFIG.camera.fov);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', resize);
    resize();
  }

  /**
   * On a tall (portrait) screen, widen the vertical FOV so you still see enough
   * of the road to the sides. Landscape screens use the normal FOV.
   */
  static fovFor(aspect: number, baseFov: number): number {
    if (aspect >= 1) return baseFov;
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) / Math.max(aspect, 0.45));
    return Math.min(95, THREE.MathUtils.radToDeg(halfH * 2) * 0.8);
  }

  /** Keep the sun (and its shadow box) centered on a point. */
  followSun(target: THREE.Vector3) {
    this.sun.position.set(target.x + 30, target.y + 60, target.z - 20);
    this.sun.target.position.copy(target);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
