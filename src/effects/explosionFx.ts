import * as THREE from 'three';

interface Blast {
  ball: THREE.Mesh | null;
  chunks: { mesh: THREE.Mesh; vel: THREE.Vector3 }[];
  age: number;
  radius: number;
}

const LIFE = 0.9;

/** Visual-only explosion: an expanding fireball plus flying blocky bits. Physics is handled elsewhere. */
export class ExplosionFx {
  readonly group = new THREE.Group();
  private blasts: Blast[] = [];
  private ballGeo = new THREE.IcosahedronGeometry(1, 1);
  private chunkGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  private chunkMats = ['#ff9f1c', '#ffbf69', '#3d3d3d', '#e63946'].map(
    (c) => new THREE.MeshBasicMaterial({ color: c }),
  );

  private burstMats = new Map<string, THREE.Material>();

  /** Flying bits without a fireball: sparks from hits, shattering rocks. */
  burst(position: THREE.Vector3, colors: string[], count: number, speed: number, size = 1) {
    const chunks: Blast['chunks'] = [];
    for (let i = 0; i < count; i++) {
      const color = colors[i % colors.length];
      let mat = this.burstMats.get(color);
      if (!mat) this.burstMats.set(color, (mat = new THREE.MeshBasicMaterial({ color })));
      const mesh = new THREE.Mesh(this.chunkGeo, mat);
      mesh.position.copy(position);
      mesh.scale.setScalar(size);
      mesh.userData.size = size;
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random()));
      this.group.add(mesh);
      chunks.push({ mesh, vel });
    }
    this.blasts.push({ ball: null, chunks, age: 0, radius: 0 });
  }

  spawn(position: THREE.Vector3, radius: number) {
    const ball = new THREE.Mesh(
      this.ballGeo,
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9 }),
    );
    ball.position.copy(position);
    ball.scale.setScalar(0.3);
    this.group.add(ball);

    const chunks: Blast['chunks'] = [];
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(this.chunkGeo, this.chunkMats[i % this.chunkMats.length]);
      mesh.position.copy(position);
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(6 + Math.random() * 8);
      this.group.add(mesh);
      chunks.push({ mesh, vel });
    }
    this.blasts.push({ ball, chunks, age: 0, radius });
  }

  update(dt: number) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.age += dt;
      const t = b.age / LIFE;
      if (b.ball) {
        b.ball.scale.setScalar(0.3 + (1 - Math.pow(1 - Math.min(1, t * 2.5), 3)) * b.radius * 0.8);
        (b.ball.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - t));
      }
      for (const c of b.chunks) {
        c.vel.y -= 20 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += dt * 8;
        c.mesh.rotation.y += dt * 6;
        c.mesh.scale.setScalar(Math.max(0.01, 1 - t) * (c.mesh.userData.size ?? 1));
      }
      if (t >= 1) {
        if (b.ball) {
          b.ball.removeFromParent();
          (b.ball.material as THREE.Material).dispose();
        }
        for (const c of b.chunks) c.mesh.removeFromParent();
        this.blasts.splice(i, 1);
      }
    }
  }
}
