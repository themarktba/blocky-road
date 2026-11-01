import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import type { Vehicle } from '../car/vehicle';
import type { Target } from '../game/targets';
import type { ExplosionFx } from '../effects/explosionFx';
import type { Vec3 } from '../car/carConfig';
import { orientationQuat } from '../car/orientation';

/** World direction of a part's front (`facing` is in car space). */
function facingWorld(vehicle: Vehicle, facing: Vec3): THREE.Vector3 {
  return new THREE.Vector3(...facing).applyQuaternion(vehicle.quaternion).normalize();
}

/** Car-space point: a block's center plus an offset given in the part's own (unturned) frame. */
function localPoint(center: Vec3, orient: number, offset: Vec3): THREE.Vector3 {
  return new THREE.Vector3(...offset).applyQuaternion(orientationQuat(orient)).add(new THREE.Vector3(...center));
}


interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  splash: number;
  life: number;
}

/** A shell that hit something and should explode (handled by Game.explode). */
export interface ShellBlast {
  point: THREE.Vector3;
  damage: number;
  radius: number;
}

/** Closest distance from point p to the segment a→b, and where along it (0..1). */
function segmentDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): { dist: number; t: number } {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  return { dist: a.clone().addScaledVector(ab, t).distanceTo(p), t };
}

/**
 * Runs the car's weapons.
 *  - Melee parts hit any target right in front of them; faster = harder.
 *  - Ranged parts fire while the fire key is held, auto-aiming at the closest target ahead.
 * Weapons only deal with Targets, so anything that implements Target can be destroyed.
 */
export class Weapons {
  readonly group = new THREE.Group();
  private projectiles: Projectile[] = [];
  private bulletGeo = new THREE.BoxGeometry(0.08, 0.08, 0.7);
  private shellGeo = new THREE.IcosahedronGeometry(0.18, 0);
  private bulletMat = new THREE.MeshBasicMaterial({ color: '#ffe066' });
  private shellMat = new THREE.MeshBasicMaterial({ color: '#2b2b2b' });

  constructor(private world: RAPIER.World, private fx: ExplosionFx) {}

  reset() {
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles = [];
  }

  /** Melee: call every physics step, before the car moves, so a smashed rock is gone before you hit it. */
  updateMelee(dt: number, vehicle: Vehicle, targets: Target[]) {
    const w = CONFIG.weapons;
    const v = vehicle.body.linvel();
    for (const inst of vehicle.weapons) {
      const spec = inst.block.weapon!;
      if (spec.type !== 'melee') continue;
      inst.cooldown -= dt;
      if (inst.cooldown > 0) continue;
      // The weapon hits whatever is in front of *its* face, which may point sideways, back or up.
      const forward = facingWorld(vehicle, inst.block.facing);
      const speed = Math.max(0, v.x * forward.x + v.y * forward.y + v.z * forward.z);
      const [bx, by, bz] = inst.block.baseSize;
      const front = vehicle.toWorld(localPoint(inst.block.center, inst.block.orient, [0, 0, bz / 2]));
      const halfWidth = Math.max(bx, by) / 2;
      // Look a little further ahead at speed, so we hit before the crash.
      const reach = spec.range + speed * 0.06;
      for (const t of targets) {
        if (!t.alive()) continue;
        const toTarget = t.position().sub(front);
        const ahead = toTarget.dot(forward);
        if (ahead < -t.radius || ahead > reach + t.radius) continue;
        const sideways = toTarget.clone().addScaledVector(forward, -ahead).length();
        if (sideways > halfWidth + t.radius) continue;
        const damage = spec.damage * (1 + Math.min(w.meleeSpeedMax, speed / w.meleeSpeedDivisor));
        t.hit(damage);
        this.fx.burst(front.clone().addScaledVector(forward, Math.max(0, ahead - t.radius)), ['#fff3b0', '#ffd166', '#adb5bd'], 6, 5, 0.5);
        inst.cooldown = spec.cooldown;
        break;
      }
    }
  }

  /** Ranged: fire (if held) and move projectiles. Call once per frame. Returns shells that exploded. */
  update(dt: number, vehicle: Vehicle | null, firing: boolean, targets: Target[]): ShellBlast[] {
    if (vehicle) this.fire(dt, vehicle, firing, targets);
    return this.moveProjectiles(dt, vehicle, targets);
  }

  /** Shots left per ranged weapon (for the HUD). */
  ammo(vehicle: Vehicle): number[] {
    return vehicle.weapons.filter((w) => w.block.weapon!.type === 'ranged').map((w) => w.ammo);
  }

  private fire(dt: number, vehicle: Vehicle, firing: boolean, targets: Target[]) {
    const cone = Math.cos(THREE.MathUtils.degToRad(CONFIG.weapons.aimConeDegrees));
    const carVel = vehicle.body.linvel();
    for (const inst of vehicle.weapons) {
      const spec = inst.block.weapon!;
      if (spec.type !== 'ranged') continue;
      inst.cooldown -= dt;
      if (!firing || inst.cooldown > 0 || inst.ammo <= 0) continue;

      // Guns shoot the way their barrel points (forward unless you turned the part).
      const forward = facingWorld(vehicle, inst.block.facing);
      const [, by, bz] = inst.block.baseSize;
      const muzzle = vehicle.toWorld(localPoint(inst.block.center, inst.block.orient, [0, by * 0.15, bz / 2 + 0.4]));

      // Auto-aim: closest live target within range and roughly ahead (left/right angle only,
      // so drones overhead count). Enemies are preferred over obstacles.
      // A gun pointing straight up or down uses a plain 3D cone instead.
      const flatForward = new THREE.Vector3(forward.x, 0, forward.z);
      const vertical = flatForward.lengthSq() < 0.1;
      flatForward.normalize();
      let best: Target | null = null;
      let bestScore = Infinity;
      for (const t of targets) {
        if (!t.alive()) continue;
        const to = t.position().sub(muzzle);
        const d = to.length();
        if (d > spec.range || d < 0.5) continue;
        if (vertical) {
          if (to.clone().normalize().dot(forward) < cone) continue;
        } else {
          const flat = new THREE.Vector3(to.x, 0, to.z);
          if (flat.lengthSq() < 0.01 || flat.normalize().dot(flatForward) < cone) continue;
        }
        const score = t.kind === 'roller' || t.kind === 'drone' ? d * 0.4 : d;
        if (score < bestScore) {
          best = t;
          bestScore = score;
        }
      }
      const dir = best ? best.position().sub(muzzle).normalize() : forward.clone();

      const speed = spec.projectileSpeed ?? 80;
      const isShell = (spec.splash ?? 0) > 0;
      const mesh = new THREE.Mesh(isShell ? this.shellGeo : this.bulletGeo, isShell ? this.shellMat : this.bulletMat);
      mesh.position.copy(muzzle);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.group.add(mesh);
      this.projectiles.push({
        mesh,
        pos: muzzle,
        vel: dir.multiplyScalar(speed).add(new THREE.Vector3(carVel.x, carVel.y, carVel.z)),
        damage: spec.damage,
        splash: spec.splash ?? 0,
        life: spec.range / speed + 0.3,
      });
      this.fx.burst(muzzle, ['#ffd166', '#fff3b0'], isShell ? 6 : 2, 3, isShell ? 0.6 : 0.3);
      inst.ammo--;
      inst.cooldown = spec.cooldown;
    }
  }

  private moveProjectiles(dt: number, vehicle: Vehicle | null, targets: Target[]): ShellBlast[] {
    const blasts: ShellBlast[] = [];
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const next = p.pos.clone().addScaledVector(p.vel, dt);

      // Did we pass through a target?
      let hitT = Infinity;
      let hitTarget: Target | null = null;
      for (const t of targets) {
        if (!t.alive()) continue;
        const { dist, t: along } = segmentDistance(p.pos, next, t.position());
        if (dist < t.radius && along < hitT) {
          hitT = along;
          hitTarget = t;
        }
      }
      // Or into the ground / anything solid (but not our own car)?
      const step = next.clone().sub(p.pos);
      const len = step.length();
      if (len > 0) {
        const ray = new RAPIER.Ray(p.pos, step.clone().divideScalar(len));
        const hit = this.world.castRay(ray, len, true, undefined, undefined, undefined, vehicle?.body);
        if (hit && hit.timeOfImpact / len < hitT) {
          hitT = hit.timeOfImpact / len;
          // Hit a rock/barrel/roller's surface? Credit it to that target.
          const point = p.pos.clone().addScaledVector(step, hitT);
          hitTarget = null;
          for (const t of targets) {
            if (t.alive() && t.position().distanceTo(point) < t.radius + 0.6) {
              hitTarget = t;
              break;
            }
          }
        }
      }

      if (hitT <= 1) {
        const point = p.pos.clone().addScaledVector(step, hitT);
        if (p.splash > 0) {
          blasts.push({ point, damage: p.damage, radius: p.splash });
        } else {
          hitTarget?.hit(p.damage);
          this.fx.burst(point, ['#ffd166', '#adb5bd'], 3, 4, 0.35);
        }
        this.remove(i);
        continue;
      }
      if (p.life <= 0) {
        this.remove(i);
        continue;
      }
      p.pos.copy(next);
      p.mesh.position.copy(next);
    }
    return blasts;
  }

  private remove(i: number) {
    this.projectiles[i].mesh.removeFromParent();
    this.projectiles.splice(i, 1);
  }
}
