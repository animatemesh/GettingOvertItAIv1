/**
 * systems/HammerController.ts  —  FILE 3: Hammer Physics & Lever Control
 * -----------------------------------------------------------------------------
 * Direct mouse-to-hammer control.
 *
 *   1. The pointer position is raycast from the camera onto the gameplay plane
 *      (z = 0) to obtain a world-space target.
 *   2. The vector from the cauldron grip pivot to that target is capped to a
 *      maximum extension so the handle cannot reach infinitely.
 *   3. A proportional-derivative (PD) controller drives the hammer HEAD toward
 *      the (clamped) target by applying a force at the head point. Because the
 *      force is applied off the centre of mass it produces both the linear and
 *      angular response that swings, hooks, pushes and vaults the hammer — and,
 *      through the grip joint, transfers reaction into the cauldron.
 *
 * The controller publishes the per-step steering force and head world position
 * so the PhysicsManager can translate anchored leverage into cauldron impulses.
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { STEERING, PLANE_Z } from '../data/config';

export interface HammerControllerOpts {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  hammerBody: RAPIER.RigidBody;
  /** Offset from the hammer body origin to the head point, in body-local space. */
  headLocalOffset: THREE.Vector3;
  /** Returns the cauldron grip pivot (world XY) the handle extends from. */
  getPivot: () => THREE.Vector2;
}

export class HammerController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly body: RAPIER.RigidBody;
  private readonly headLocalOffset: THREE.Vector3;
  private readonly getPivot: () => THREE.Vector2;

  /** Pointer position in normalised device coordinates [-1, 1]. */
  private readonly ndc = new THREE.Vector2(0, 0.2);
  private pointerInside = false;

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

  constructor(opts: HammerControllerOpts) {
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.body = opts.hammerBody;
    this.headLocalOffset = opts.headLocalOffset.clone();
    this.getPivot = opts.getPivot;

    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerenter', this.onPointerEnter);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave);
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
    // Keep steering toward the last known target so the hammer doesn't drop.
    this.pointerInside = false;
  };

  /** Recompute the world-space target from the pointer ray and the reach cap. */
  private updateTarget(): void {
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.targetWorld);

    const pivot = this.getPivot();
    if (!hit) {
      // Ray parallel to plane (degenerate); hold target straight above pivot.
      this.targetWorld.set(pivot.x, pivot.y + STEERING.minReach, PLANE_Z);
      return;
    }
    this.targetWorld.z = PLANE_Z;

    // Cap extension: clamp the target into [minReach, maxReach] of the pivot.
    let dx = this.targetWorld.x - pivot.x;
    let dy = this.targetWorld.y - pivot.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const clamped = Math.min(Math.max(dist, STEERING.minReach), STEERING.maxReach);
    if (clamped !== dist) {
      dx = (dx / dist) * clamped;
      dy = (dy / dist) * clamped;
      this.targetWorld.set(pivot.x + dx, pivot.y + dy, PLANE_Z);
    }
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

  /** Velocity of the head point: v_com + ω × r. */
  private computeHeadVelocity(): void {
    const v = this.body.linvel();
    const w = this.body.angvel();
    const t = this.body.translation();
    this.tmpR.set(this.headWorld.x - t.x, this.headWorld.y - t.y, this.headWorld.z - t.z);
    // ω × r
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
  update(): void {
    // Rapier force accumulators PERSIST across steps until reset. Clear last
    // substep's steering force/torque before applying this substep's, otherwise
    // the force compounds every step and the hammer explodes.
    this.body.resetForces(false);
    this.body.resetTorques(false);

    this.updateTarget();
    this.computeHeadWorld();
    this.computeHeadVelocity();

    // PD: F = kp·(target - head) - kd·headVel
    this.tmpForce.set(
      STEERING.kp * (this.targetWorld.x - this.headWorld.x) - STEERING.kd * this.tmpHeadVel.x,
      STEERING.kp * (this.targetWorld.y - this.headWorld.y) - STEERING.kd * this.tmpHeadVel.y,
      0,
    );

    // Clamp the steering force magnitude.
    const mag = this.tmpForce.length();
    if (mag > STEERING.maxForce) {
      this.tmpForce.multiplyScalar(STEERING.maxForce / mag);
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
