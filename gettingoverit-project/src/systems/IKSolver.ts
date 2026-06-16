/**
 * systems/IKSolver.ts  —  FILE 2: Procedural Inverse Kinematics Solver
 * -----------------------------------------------------------------------------
 * A production-grade 2D FABRIK (Forward And Backward Reaching Inverse
 * Kinematics) solver operating on the gameplay plane (XY).
 *
 * Each arm is a chain of joints:  Shoulder -> Elbow -> Wrist -> Hand
 * with three fixed-length bones (upper arm, forearm, hand). The shoulder is the
 * anchored root (pinned to the torso); the hand is the end effector driven to a
 * target (the grip point on the moving hammer handle).
 *
 * After every FABRIK iteration a rotational-constraint pass clamps each interior
 * joint to an allowed angular window and forces a preferred bend direction, so
 * the elbow can never hyper-extend backward — the arm reads as tense, weighted
 * and anatomically true.
 *
 * The solver exposes per-bone world-space angles (radians) so the renderer can
 * orient the visual arm sub-meshes frame-by-frame.
 */

import { Vector2 } from 'three';
import { IK } from '../data/config';

const EPS = 1e-6;

/** Wrap an angle into (-π, π]. */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

export class IKChain {
  /** Joint positions: joints[0] = shoulder ... joints[n] = hand (n = bones). */
  readonly joints: Vector2[];
  /** Rest length of each bone segment. */
  readonly lengths: number[];
  readonly totalLength: number;
  private readonly boneCount: number;

  /** Preferred bend side: +1 or -1 (mirrored between left/right arms). */
  private readonly bendSign: number;
  private readonly minAngle: number;
  private readonly maxAngle: number;

  private reachable = true;

  constructor(
    boneLengths: number[] = IK.boneLengths as unknown as number[],
    bendSign = 1,
    minAngle: number = IK.minElbowAngle,
    maxAngle: number = IK.maxElbowAngle,
  ) {
    this.lengths = boneLengths.slice();
    this.boneCount = this.lengths.length;
    this.bendSign = Math.sign(bendSign) || 1;
    this.minAngle = minAngle;
    this.maxAngle = maxAngle;

    this.totalLength = this.lengths.reduce((s, l) => s + l, 0);

    // Seed joints in a straight line along +Y so the very first solve has a
    // sane previous pose to converge from.
    this.joints = [];
    let acc = 0;
    this.joints.push(new Vector2(0, 0));
    for (let i = 0; i < this.boneCount; i++) {
      acc += this.lengths[i];
      this.joints.push(new Vector2(0, acc));
    }
  }

  /** True if the last solve target was within total reach (no straightening). */
  get isReachable(): boolean {
    return this.reachable;
  }

  /**
   * Solve the chain so the shoulder sits at `root` and the hand reaches `target`.
   * Mutates the internal joint positions in place.
   */
  solve(root: Vector2, target: Vector2): void {
    const n = this.boneCount;
    const rootDist = root.distanceTo(target);

    // --- Unreachable: stretch the whole chain straight toward the target ---
    if (rootDist >= this.totalLength - EPS) {
      this.reachable = false;
      this.joints[0].copy(root);
      const dx = (target.x - root.x) / (rootDist || 1);
      const dy = (target.y - root.y) / (rootDist || 1);
      for (let i = 0; i < n; i++) {
        this.joints[i + 1].set(
          this.joints[i].x + dx * this.lengths[i],
          this.joints[i].y + dy * this.lengths[i],
        );
      }
      return;
    }

    // --- Reachable: iterative forward/backward reaching ------------------
    this.reachable = true;
    this.joints[0].copy(root);

    for (let iter = 0; iter < IK.iterations; iter++) {
      // Backward pass: place the end effector on the target, walk to the root.
      this.joints[n].copy(target);
      for (let i = n - 1; i >= 0; i--) {
        const r = this.joints[i + 1].distanceTo(this.joints[i]) || EPS;
        const lambda = this.lengths[i] / r;
        // p[i] = (1-λ)·p[i+1] + λ·p[i]
        this.joints[i].set(
          (1 - lambda) * this.joints[i + 1].x + lambda * this.joints[i].x,
          (1 - lambda) * this.joints[i + 1].y + lambda * this.joints[i].y,
        );
      }

      // Forward pass: re-anchor the root, walk back out to the effector.
      this.joints[0].copy(root);
      for (let i = 0; i < n; i++) {
        const r = this.joints[i].distanceTo(this.joints[i + 1]) || EPS;
        const lambda = this.lengths[i] / r;
        // p[i+1] = (1-λ)·p[i] + λ·p[i+1]
        this.joints[i + 1].set(
          (1 - lambda) * this.joints[i].x + lambda * this.joints[i + 1].x,
          (1 - lambda) * this.joints[i].y + lambda * this.joints[i + 1].y,
        );
      }

      // Rotational constraints on every interior joint (elbow, wrist).
      for (let j = 1; j < n; j++) {
        this.constrainJoint(j);
      }

      if (this.joints[n].distanceTo(target) < IK.tolerance) break;
    }
  }

  /**
   * Clamp interior joint `j` to the allowed angular window and force the
   * preferred bend direction. The incoming bone (j-1 -> j) defines the
   * reference; the outgoing bone (j -> j+1) is rotated to satisfy the limits
   * while preserving its (already length-corrected) magnitude.
   */
  private constrainJoint(j: number): void {
    const prev = this.joints[j - 1];
    const cur = this.joints[j];
    const next = this.joints[j + 1];

    const ax = prev.x - cur.x;
    const ay = prev.y - cur.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;

    const aLen = Math.hypot(ax, ay);
    const bLen = Math.hypot(bx, by);
    if (aLen < EPS || bLen < EPS) return;

    const aAng = Math.atan2(ay, ax);
    // Signed interior angle from incoming bone direction to outgoing bone.
    const rel = wrapPi(Math.atan2(by, bx) - aAng);

    // Enforce preferred bend side: if the joint folded the wrong way, mirror it.
    let sign = rel >= 0 ? 1 : -1;
    if (sign !== this.bendSign) sign = this.bendSign;

    // Clamp the magnitude into the anatomical window (no hyper-extension).
    const mag = Math.min(Math.max(Math.abs(rel), this.minAngle), this.maxAngle);

    const newAng = aAng + sign * mag;
    next.set(cur.x + Math.cos(newAng) * bLen, cur.y + Math.sin(newAng) * bLen);
  }

  /** World-space angle (radians) of bone `i` (segment joints[i] -> joints[i+1]). */
  boneAngle(i: number): number {
    const a = this.joints[i];
    const b = this.joints[i + 1];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Midpoint of bone `i`, useful for positioning a centred bone mesh. */
  boneMidpoint(i: number, out: Vector2): Vector2 {
    const a = this.joints[i];
    const b = this.joints[i + 1];
    return out.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
  }
}
