import * as THREE from 'three';
import type { Vec3 } from './carConfig';

const metal = new THREE.MeshLambertMaterial({ color: '#d0d4d8', flatShading: true });
const dark = new THREE.MeshLambertMaterial({ color: '#1b1b1e', flatShading: true });
const brass = new THREE.MeshLambertMaterial({ color: '#e9c46a', flatShading: true });

/**
 * Extra detail meshes on top of a part's plain box (spikes, saw blade, gun barrels).
 * Used by both the garage and the in-game car so they look the same.
 * `size` is the box size in meters. Weapons always face +Z (forward).
 * Objects tagged with userData.spin = true are spun by the vehicle.
 */
export function addPartDetails(box: THREE.Object3D, partId: string, size: Vec3) {
  const [sx, sy, sz] = size;
  const front = sz / 2;
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    box.add(mesh);
    return mesh;
  };

  switch (partId) {
    case 'spike_ram': {
      const count = Math.max(2, Math.round(sx / 0.45));
      const geo = new THREE.ConeGeometry(0.11, 0.4, 4).rotateX(Math.PI / 2);
      for (let i = 0; i < count; i++) {
        const spike = add(new THREE.Mesh(geo, metal));
        spike.position.set(-sx / 2 + (sx / count) * (i + 0.5), 0, front + 0.2);
      }
      break;
    }
    case 'buzz_saw': {
      const r = Math.min(0.42, sx / 2);
      const holder = new THREE.Object3D();
      holder.position.set(0, 0, front + 0.05);
      holder.userData.spin = true;
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 12).rotateZ(Math.PI / 2), metal);
      blade.castShadow = true;
      holder.add(blade);
      // Teeth.
      const tooth = new THREE.BoxGeometry(0.05, 0.1, 0.1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const t = new THREE.Mesh(tooth, metal);
        t.position.set(0, Math.cos(a) * r, Math.sin(a) * r);
        t.rotation.x = -a;
        holder.add(t);
      }
      box.add(holder);
      break;
    }
    case 'ammo_box':
    case 'ammo_crate': {
      // Yellow stripe and a row of bullet tips on the lid.
      const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, sy * 0.25, sz + 0.02), brass));
      stripe.castShadow = false;
      const tipGeo = new THREE.ConeGeometry(0.04, 0.12, 5);
      const count = Math.max(3, Math.round(sx / 0.15));
      for (let row = 0; row < Math.max(1, Math.round(sz / 0.5)); row++) {
        for (let i = 0; i < count; i++) {
          const tip = add(new THREE.Mesh(tipGeo, brass));
          tip.position.set(-sx / 2 + (sx / count) * (i + 0.5), sy / 2 + 0.06, -sz / 2 + 0.25 + row * 0.5);
        }
      }
      break;
    }
    case 'machine_gun': {
      const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6).rotateX(Math.PI / 2), dark));
      barrel.position.set(0, sy * 0.15, front + 0.2);
      break;
    }
    case 'cannon': {
      const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.8, 8).rotateX(Math.PI / 2), dark));
      barrel.position.set(0, sy * 0.1, front + 0.35);
      break;
    }
  }
}
