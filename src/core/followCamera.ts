import * as THREE from 'three';
import { CONFIG } from '../config';

/**
 * Third-person camera that smoothly follows a target.
 * It follows the car's heading (yaw) only, so it doesn't spin wildly when the car flips.
 */
export class FollowCamera {
  private position = new THREE.Vector3();
  private look = new THREE.Vector3();
  private heading = 0;
  private initialized = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Snap straight to the target (used on spawn/reset). */
  snap() {
    this.initialized = false;
  }

  update(dt: number, targetPos: THREE.Vector3, targetQuat: THREE.Quaternion, speed: number) {
    const c = CONFIG.camera;
    // Car's forward direction flattened onto the ground.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(targetQuat);
    forward.y = 0;
    let targetHeading = this.heading;
    if (forward.lengthSq() > 0.01) targetHeading = Math.atan2(forward.x, forward.z);

    if (!this.initialized) {
      this.heading = targetHeading;
    } else {
      // Rotate the shortest way round, smoothly.
      let diff = targetHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-3 * dt));
    }

    const dir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    // Pull back a little more at speed for a sense of velocity.
    const dist = c.distance + Math.min(Math.abs(speed), 30) * 0.08;
    const desiredPos = targetPos.clone().addScaledVector(dir, -dist).add(new THREE.Vector3(0, c.height, 0));
    const desiredLook = targetPos.clone().addScaledVector(dir, c.lookAhead).add(new THREE.Vector3(0, 1, 0));

    if (!this.initialized) {
      this.position.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialized = true;
    } else {
      this.position.lerp(desiredPos, 1 - Math.exp(-c.positionLerp * dt));
      this.look.lerp(desiredLook, 1 - Math.exp(-c.lookLerp * dt));
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }
}
