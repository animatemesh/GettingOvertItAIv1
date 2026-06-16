/**
 * systems/HammerController.ts
 * -----------------------------------------------------------------------------
 * Direct mouse-to-hammer control.
 *
 * The pointer is projected onto the gameplay plane, converted into a direction
 * plus a desired reach from the cauldron grip pivot, and then fed into a PD
 * controller that drives the hammer head toward that moving target. Unlike the
 * earlier fixed-length version, the hammer can now retract and extend along the
 * handle, which makes downward pushes, tighter placements, and Bennett-style
 * precision launches possible.
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PLANE_Z, STEERING } from '../data/config';

export interface HammerControllerOpts {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  hammerBody: RAPIER.RigidBody;
  /** Offset from the hammer body origin to the head point, in body-local space. */
  headLocalOffset: THREE.Vector3;
  /** Returns the cauldron grip pivot (world XY) the handle extends from. */
  getPivot: () => THREE.Vector2;
  /** Current hammer reach, in world units. */
  getReach: () => number;
  /** Applies a new hammer reach to the player visuals and colliders. */
  setReach: (reach: number) => void;
  /** True while terrain contact is active, allowing extra push-overreach. */
  canOverdrive: () => boolean;
}

export class HammerController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly body: RAPIER.RigidBody;
  private readonly headLocalOffset: THREE.Vector3;
  private readonly getPivot: () => THREE.Vector2;
  private readonly getReach: () => number;
  private readonly setReach: (reach: number) => void;
  private readonly canOverdrive: () => boolean;

  /** Pointer position in normalised device coordinates [-1, 1]. */
  private readonly ndc = new THREE.Vector2(0, 0.2);
  private pointerInside = false;
  /** Last stable aim direction, reused inside the dead zone to avoid spin. */
  private readonly lastDir = new THREE.Vector2(0, 1);

  private desiredReach: number = STEERING.maxReach;
  private currentReach: number = STEERING.maxReach;

  // Published per-step outputs (mutated in place; do not reassign externally).
  readonly targetWorld = new THREE.Vector3(0, 1, PLANE_Z);
  readonly headWorld = new THREE.Vector3();
  readonly steerForce = new THREE.Vector3();

  // Scratch objects to avoid per-frame allocation.
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLANE_Z);
  private readonly q = new THREE.Quaternion();
  private readonly tmpHeadVel = new THREE.Vector3();
  private readonly tmpR = new THREE.Vector3();
  private readonly tmpForce = new THREE.Vector3();
  private readonly aimNdc = new THREE.Vector2();
  private sensitivity = 1;

  constructor(opts: HammerControllerOpts) {
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.body = opts.hammerBody;
    this.headLocalOffset = opts.headLocalOffset;
    this.getPivot = opts.getPivot;
    this.getReach = opts.getReach;
    this.setReach = opts.setReach;
    this.canOverdrive = opts.canOverdrive;

    this.currentReach = this.getReach();
    this.desiredReach = this.currentReach;

    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerenter', this.onPointerEnter);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave);
  }

  setSensitivity(value: number): void {
    this.sensitivity = THREE.MathUtils.clamp(value, 0.5, 2.8);
  }

  reset(): void {
    this.currentReach = this.getReach();
    this.desiredReach = this.currentReach;
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerInside = true;
  };

  private onPointerEnter = (): void => {
    this.pointerInside = true;
  };

  private onPointerLeave = (): void => {
    // Keep steering toward the last known target so the hammer does not drop.
    this.pointerInside = false;
  };

  /**
   * Recompute the world-space target from the current pointer ray. The pointer
   * chooses both the swing direction and how far the head should retract or
   * extend from the grip pivot.
   */
  private updateTarget(): void {
    this.aimNdc.set(
      THREE.MathUtils.clamp(this.ndc.x * this.sensitivity, -1.8, 1.8),
      THREE.MathUtils.clamp(this.ndc.y * this.sensitivity, -1.8, 1.8),
    );
    this.ray.setFromCamera(this.aimNdc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.targetWorld);

    const pivot = this.getPivot();

    if (!hit) {
      this.targetWorld.set(
        pivot.x + this.lastDir.x * this.desiredReach,
        pivot.y + this.lastDir.y * this.desiredReach,
        PLANE_Z,
      );
      return;
    }
    this.targetWorld.z = PLANE_Z;

    const dx = this.targetWorld.x - pivot.x;
    const dy = this.targetWorld.y - pivot.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-4) this.lastDir.set(dx / dist, dy / dist);

    const maxTargetReach = STEERING.maxReach + (this.canOverdrive() ? STEERING.anchorOverreach : 0);
    this.desiredReach = THREE.MathUtils.clamp(dist, STEERING.minReach, maxTargetReach);
    this.targetWorld.set(
      pivot.x + this.lastDir.x * this.desiredReach,
      pivot.y + this.lastDir.y * this.desiredReach,
      PLANE_Z,
    );
  }

  /** Smooth the hammer's physical reach toward the requested cursor radius. */
  private updateReach(dt: number): void {
    const delta = this.desiredReach - this.currentReach;
    if (Math.abs(delta) < 1e-5) return;

    const maxStep = STEERING.reachSpeed * Math.sqrt(this.sensitivity) * dt;
    if (Math.abs(delta) <= maxStep) {
      this.currentReach = this.desiredReach;
    } else {
      this.currentReach += Math.sign(delta) * maxStep;
    }

    this.setReach(this.currentReach);
    this.currentReach = this.getReach();
  }

  /** Compute the current world position of the hammer head point. */
  private computeHeadWorld(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.headWorld.copy(this.headLocalOffset).applyQuaternion(this.q);
    this.headWorld.x += t.x;
    this.headWorld.y += t.y;
    this.headWorld.z += t.z;
  }

  /** Velocity of the head point: v_com + omega x r. */
  private computeHeadVelocity(): void {
    const v = this.body.linvel();
    const w = this.body.angvel();
    const t = this.body.translation();
    this.tmpR.set(this.headWorld.x - t.x, this.headWorld.y - t.y, this.headWorld.z - t.z);
    this.tmpHeadVel.set(
      w.y * this.tmpR.z - w.z * this.tmpR.y,
      w.z * this.tmpR.x - w.x * this.tmpR.z,
      w.x * this.tmpR.y - w.y * this.tmpR.x,
    );
    this.tmpHeadVel.x += v.x;
    this.tmpHeadVel.y += v.y;
    this.tmpHeadVel.z += v.z;
  }

  /**
   * Apply one PD steering step. Call inside the fixed-step `beforeStep` hook so
   * the force is integrated by the very next world.step().
   */
  update(dt: number): void {
    // Rapier force accumulators persist across steps until reset. Clear the
    // last substep's steering force and torque before applying this one.
    this.body.resetForces(false);
    this.body.resetTorques(false);

    this.updateTarget();
    this.updateReach(dt);
    this.computeHeadWorld();
    this.computeHeadVelocity();

    const gainScale = this.sensitivity;
    const dampingScale = Math.sqrt(this.sensitivity);
    this.tmpForce.set(
      STEERING.kp * gainScale * (this.targetWorld.x - this.headWorld.x) - STEERING.kd * dampingScale * this.tmpHeadVel.x,
      STEERING.kp * gainScale * (this.targetWorld.y - this.headWorld.y) - STEERING.kd * dampingScale * this.tmpHeadVel.y,
      0,
    );

    const mag = this.tmpForce.length();
    const maxForce = STEERING.maxForce * gainScale;
    if (mag > maxForce) {
      this.tmpForce.multiplyScalar(maxForce / mag);
    }

    this.steerForce.copy(this.tmpForce);
    this.body.addForceAtPoint(this.tmpForce, this.headWorld, true);
  }

  /** Whether the pointer is currently over the canvas (for HUD/feedback). */
  get active(): boolean {
    return this.pointerInside;
  }

  dispose(): void {
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerenter', this.onPointerEnter);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave);
  }
}
