/**
 * systems/SlamVfx.ts
 * -----------------------------------------------------------------------------
 * Lightweight pooled particle bursts for hammer ground-slams (and ability FX).
 *
 * A single THREE.Points with additive blending holds the whole pool; "dead"
 * particles fade their colour to black (invisible under additive blending) so
 * there is no per-frame allocation and no draw-call churn. Call `burst()` on a
 * slam and `update(dt)` once per frame.
 */

import * as THREE from 'three';

const MAX_PARTICLES = 800;

export class SlamVfx {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly points: THREE.Points;

  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 3);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly baseCol = new Float32Array(MAX_PARTICLES * 3);
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    // Park all particles far below the world and dark (invisible).
    for (let i = 0; i < MAX_PARTICLES; i++) this.pos[i * 3 + 1] = -10000;

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));

    const material = new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /**
   * Emit a burst of `count` particles at `(x,y,z)` in the given colour, biased
   * upward/outward. `speed` scales the spray (bigger = more violent).
   */
  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count = 28, speed = 4): void {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;

      const ang = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 1.1; // bias upward
      const spread = 0.5 + Math.random() * 1.0;
      const s = speed * (0.5 + Math.random() * 0.8);

      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(ang) * spread * s;
      this.vel[i * 3 + 1] = up * s;
      this.vel[i * 3 + 2] = Math.sin(ang) * spread * s * 0.4; // keep mostly in-plane
      const life = 0.4 + Math.random() * 0.5;
      this.life[i] = life;
      this.maxLife[i] = life;
      this.baseCol[i * 3] = c.r;
      this.baseCol[i * 3 + 1] = c.g;
      this.baseCol[i * 3 + 2] = c.b;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const g = 9.0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -10000;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= g * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i]; // 1 -> 0
      this.col[i * 3] = this.baseCol[i * 3] * t;
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1] * t;
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2] * t;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
