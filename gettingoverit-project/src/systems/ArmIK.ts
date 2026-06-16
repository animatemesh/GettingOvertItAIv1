/**
 * systems/ArmIK.ts
 * -----------------------------------------------------------------------------
 * Analytic 2-bone inverse kinematics for a skinned skeleton arm
 * (upperarm -> lowerarm -> hand). Given a world-space target for the hand and a
 * "pole" hint that decides which way the elbow bends, it computes the elbow
 * position via the law of cosines and writes minimal-twist local rotations onto
 * the two bones so the hand reaches the target.
 *
 * Each bone's "forward" (the direction toward its child) is captured from the
 * bind pose, so the solver works for any rig whose bones point along a
 * consistent local axis (here +Y). Lengths are measured in world space on first
 * solve, so it is robust to the model's group scale.
 *
 * The chain's nominal end effector is `hand` (the wrist), but an optional
 * `grip` bone further down the chain (e.g. a finger root) can be supplied —
 * the reach length is then measured out to `grip` instead, so the target
 * lands at the fingers rather than the wrist. `grip` must be a descendant of
 * `hand`; it does not need to be a direct child.
 */

import { Quaternion, Vector3 } from 'three';
import type { Bone } from 'three';

export class ArmIK {
  private readonly upper: Bone;
  private readonly lower: Bone;
  private readonly hand: Bone;
  private readonly grip: Bone;

  private inited = false;
  private L1 = 0; // upper -> lower (world rest length)
  private L2 = 0; // lower -> grip  (world rest length)
  private readonly fwdUpper = new Vector3(0, 1, 0);
  private readonly fwdLower = new Vector3(0, 1, 0);
  private readonly bindUpperQuat = new Quaternion();
  private readonly bindLowerQuat = new Quaternion();
  private readonly bindUpperDir = new Vector3(0, 1, 0);
  private readonly bindLowerDir = new Vector3(0, 1, 0);
  private readonly delta = new Quaternion();

  // Scratch (no per-frame allocation).
  private readonly pUpper = new Vector3();
  private readonly pLower = new Vector3();
  private readonly pHand = new Vector3();
  private readonly toTarget = new Vector3();
  private readonly n = new Vector3();
  private readonly poleVec = new Vector3();
  private readonly elbow = new Vector3();
  private readonly dir = new Vector3();
  private readonly dLocal = new Vector3();
  private readonly qParent = new Quaternion();
  private readonly qParentInv = new Quaternion();

  constructor(upper: Bone, lower: Bone, hand: Bone, grip?: Bone) {
    this.upper = upper;
    this.lower = lower;
    this.hand = hand;
    this.grip = grip ?? hand;
  }

  /** Measure rest lengths + bind forward axes once the rig is in the scene. */
  private init(): void {
    this.upper.updateWorldMatrix(true, true);
    this.upper.getWorldPosition(this.pUpper);
    this.lower.getWorldPosition(this.pLower);
    this.grip.getWorldPosition(this.pHand);

    this.L1 = Math.max(this.pUpper.distanceTo(this.pLower), 1e-4);
    this.L2 = Math.max(this.pLower.distanceTo(this.pHand), 1e-4);

    // Bind forward = direction toward child in each bone's LOCAL space.
    // (fwdLower is taken from the direct child `hand`, not `grip`, since
    // `grip` may not be a direct child — but the bind axis is identical
    // either way, only the reach length L2 differs.)
    this.fwdUpper.copy(this.lower.position).normalize();
    this.fwdLower.copy(this.hand.position).normalize();
    if (this.fwdUpper.lengthSq() < 1e-8) this.fwdUpper.set(0, 1, 0);
    if (this.fwdLower.lengthSq() < 1e-8) this.fwdLower.set(0, 1, 0);

    this.bindUpperQuat.copy(this.upper.quaternion);
    this.bindLowerQuat.copy(this.lower.quaternion);
    this.bindUpperDir.copy(this.fwdUpper).applyQuaternion(this.bindUpperQuat).normalize();
    this.bindLowerDir.copy(this.fwdLower).applyQuaternion(this.bindLowerQuat).normalize();

    this.inited = true;
  }

  /**
   * Solve so the hand reaches `target` (world), bending toward `pole` (world).
   * Purely visual — guarded against degenerate inputs.
   */
  solve(target: Vector3, pole: Vector3): void {
    if (!this.inited) this.init();

    this.upper.getWorldPosition(this.pUpper);

    this.toTarget.subVectors(target, this.pUpper);
    const rawDist = this.toTarget.length();
    if (rawDist < 1e-5) return;

    const reach = (this.L1 + this.L2) * 0.999;
    const dist = Math.min(rawDist, reach);
    this.n.copy(this.toTarget).multiplyScalar(1 / rawDist); // unit toward target

    // Law of cosines: angle at the shoulder between (shoulder->target) and
    // (shoulder->elbow).
    const cosA = clamp((this.L1 * this.L1 + dist * dist - this.L2 * this.L2) / (2 * this.L1 * dist), -1, 1);
    const A = Math.acos(cosA);

    // Pole projected perpendicular to the target axis decides the bend plane.
    this.poleVec.subVectors(pole, this.pUpper);
    this.poleVec.addScaledVector(this.n, -this.poleVec.dot(this.n));
    if (this.poleVec.lengthSq() < 1e-8) {
      // Fallback perpendicular if pole is colinear with the arm.
      this.poleVec.set(0, 0, 1).addScaledVector(this.n, -this.n.z);
      if (this.poleVec.lengthSq() < 1e-8) this.poleVec.set(0, 1, 0);
    }
    this.poleVec.normalize();

    // Elbow world position.
    this.elbow
      .copy(this.pUpper)
      .addScaledVector(this.n, this.L1 * Math.cos(A))
      .addScaledVector(this.poleVec, this.L1 * Math.sin(A));

    // Aim upper arm at the elbow, then forearm from the elbow to the target.
    this.dir.subVectors(this.elbow, this.pUpper).normalize();
    this.aim(this.upper, this.fwdUpper, this.dir);

    this.dir.subVectors(target, this.elbow).normalize();
    this.aim(this.lower, this.fwdLower, this.dir);
  }

  /** Rotate `bone` so its local forward axis points along `worldDir`. */
  private aim(bone: Bone, _fwdLocal: Vector3, worldDir: Vector3): void {
    const parent = bone.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(this.qParent);
    this.qParentInv.copy(this.qParent).invert();

    // Express the desired direction in the parent's frame, then find the
    // minimal rotation taking the bind forward axis to it while preserving the
    // bone's bind-space twist/orientation.
    this.dLocal.copy(worldDir).applyQuaternion(this.qParentInv).normalize();
    const bindQuat = bone === this.upper ? this.bindUpperQuat : this.bindLowerQuat;
    const bindDir = bone === this.upper ? this.bindUpperDir : this.bindLowerDir;
    this.delta.setFromUnitVectors(bindDir, this.dLocal);
    bone.quaternion.copy(this.delta).multiply(bindQuat);
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
