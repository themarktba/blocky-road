import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';

interface DebrisItem {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  age: number;
}

type Vec = { x: number; y: number; z: number };

/**
 * Loose physics pieces: parts that broke off the car.
 * They tumble around for a while and then disappear.
 */
export class Debris {
  readonly group = new THREE.Group();
  private items: DebrisItem[] = [];

  constructor(private world: RAPIER.World) {}

  /**
   * Turn a visual object into a physics piece.
   * `object` is moved into the debris group; its current world transform is kept.
   */
  spawn(object: THREE.Object3D, collider: RAPIER.ColliderDesc, linvel: Vec, angvel: Vec) {
    object.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    object.matrixWorld.decompose(pos, quat, new THREE.Vector3());
    object.removeFromParent();
    object.position.copy(pos);
    object.quaternion.copy(quat);
    object.scale.set(1, 1, 1);
    this.group.add(object);

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(quat)
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setAngvel(angvel)
        .setLinearDamping(0.1)
        .setAngularDamping(0.3),
    );
    this.world.createCollider(collider.setFriction(0.8).setRestitution(0.2), body);
    this.items.push({ body, object, age: 0 });

    // Too many pieces? Remove the oldest.
    while (this.items.length > CONFIG.damage.maxDebris) this.removeAt(0);
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += dt;
      const p = item.body.translation();
      const q = item.body.rotation();
      item.object.position.set(p.x, p.y, p.z);
      item.object.quaternion.set(q.x, q.y, q.z, q.w);
      // Shrink away at the end of its life.
      const left = CONFIG.damage.debrisLifetime - item.age;
      if (left < 1) item.object.scale.setScalar(Math.max(0.01, left));
      if (left <= 0 || p.y < -100) this.removeAt(i);
    }
  }

  private removeAt(i: number) {
    const item = this.items[i];
    this.world.removeRigidBody(item.body);
    item.object.removeFromParent();
    this.items.splice(i, 1);
  }

  clear() {
    while (this.items.length) this.removeAt(this.items.length - 1);
  }
}
