/**
 * systems/PhysicsManager.ts  —  FILE 4: Leverage Translation & Collision Manager
 * -----------------------------------------------------------------------------
 * Reads the contact pairs between the hammer head and the map terrain each
 * substep. When the head is pressed into a ledge (an "anchor"), it translates
 * the rotational/linear steering force the player applies at the head into a
 * deterministic linear counter-impulse on the cauldron's centre of mass — the
 * vault/hang/slide behaviour at the heart of the climb.
 *
 * Model (a gamey but physically-plausible augmentation that runs on top of the
 * automatic reaction provided by the grip joint):
 *
 *   n  = outward surface normal at the anchor (terrain -> head)
 *   F  = steering force applied at the head this step
 *   P  = max(0, -(F·n))            normal push into the surface
 *   Ft = F - (F·n)·n              tangential component of the push
 *   tt = min(|Ft|, μ·P)          tangential force the friction cone can hold
 *
 *   R  = P·n  -  (Ft/|Ft|)·tt     reaction delivered to the cauldron
 *
 * If |Ft| exceeds μ·P the head slips (only μ·P of the tangential push is
 * transmitted); otherwise the catch holds and the body vaults. The resulting
 * impulse R·dt·gain is clamped and applied to the cauldron COM.
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { HammerController } from './HammerController';
import { LEVERAGE } from '../data/config';

export interface PhysicsManagerOpts {
  world: RAPIER.World;
  cauldronBody: RAPIER.RigidBody;
  headCollider: RAPIER.Collider;
  controller: HammerController;
  /** Returns true if a collider handle belongs to climbable terrain. */
  isTerrain: (handle: number) => boolean;
}

export class PhysicsManager {
  private readonly world: RAPIER.World;
  private readonly cauldron: RAPIER.RigidBody;
  private readonly headCollider: RAPIER.Collider;
  private readonly controller: HammerController;
  private readonly isTerrain: (handle: number) => boolean;

  // Published state (for HUD / audio feedback).
  anchored = false;
  touchingTerrain = false;
  readonly contactNormal = new THREE.Vector3();
  readonly lastLeverageImpulse = new THREE.Vector3();
  /** Set true on the frame a fresh hard contact begins (for impact feedback). */
  impactStarted = false;

  // Scratch.
  private readonly nAccum = new THREE.Vector3();
  private readonly headPos = new THREE.Vector3();
  private readonly otherPos = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly Ft = new THREE.Vector3();
  private readonly R = new THREE.Vector3();

  constructor(opts: PhysicsManagerOpts) {
    this.world = opts.world;
    this.cauldron = opts.cauldronBody;
    this.headCollider = opts.headCollider;
    this.controller = opts.controller;
    this.isTerrain = opts.isTerrain;
  }

  /** Call from the fixed-step `afterStep` hook. */
  update(dt: number, eventQueue: RAPIER.EventQueue): void {
    this.drainEvents(eventQueue);
    this.computeAnchor();
    if (this.anchored) {
      this.applyLeverage(dt);
    } else {
      this.lastLeverageImpulse.set(0, 0, 0);
    }
  }

  reset(): void {
    this.anchored = false;
    this.touchingTerrain = false;
    this.impactStarted = false;
    this.contactNormal.set(0, 0, 0);
    this.lastLeverageImpulse.set(0, 0, 0);
    this.nAccum.set(0, 0, 0);
  }

  /** Drain collision start/stop events to flag fresh impacts and clear the queue. */
  private drainEvents(eventQueue: RAPIER.EventQueue): void {
    this.impactStarted = false;
    const headHandle = this.headCollider.handle;
    eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      if (h1 === headHandle && this.isTerrain(h2)) this.impactStarted = true;
      else if (h2 === headHandle && this.isTerrain(h1)) this.impactStarted = true;
    });
  }

  /**
   * Aggregate the current head/terrain contacts into a single outward normal.
   * Sets `anchored` and `contactNormal`.
   */
  private computeAnchor(): void {
    this.nAccum.set(0, 0, 0);
    // Use the head world position the controller published this step.
    this.headPos.copy(this.controller.headWorld);

    let contactCount = 0;

    this.world.contactPairsWith(this.headCollider, (other) => {
      if (!this.isTerrain(other.handle)) return;

      const ot = other.translation();
      this.otherPos.set(ot.x, ot.y, ot.z);

      this.world.contactPair(this.headCollider, other, (manifold, _flipped) => {
        const num = manifold.numContacts();
        if (num === 0) return;
        const n = manifold.normal();
        this.tmpN.set(n.x, n.y, 0); // project onto plane

        const len = this.tmpN.length();
        if (len < 1e-6) return;
        this.tmpN.multiplyScalar(1 / len);

        // Orient outward: from terrain toward the head.
        const towardHead =
          this.tmpN.x * (this.headPos.x - this.otherPos.x) +
          this.tmpN.y * (this.headPos.y - this.otherPos.y);
        if (towardHead < 0) this.tmpN.multiplyScalar(-1);

        this.nAccum.addScaledVector(this.tmpN, num);
        contactCount += num;
      });
    });

    if (contactCount === 0) {
      this.touchingTerrain = false;
      this.anchored = false;
      this.contactNormal.set(0, 0, 0);
      return;
    }
    this.touchingTerrain = true;

    const aLen = this.nAccum.length();
    if (aLen < 1e-6) {
      this.anchored = false;
      this.contactNormal.set(0, 0, 0);
      return;
    }
    this.contactNormal.copy(this.nAccum).multiplyScalar(1 / aLen);

    // Anchored only if the player is actually pressing into this surface.
    const F = this.controller.steerForce;
    const fDotN = F.x * this.contactNormal.x + F.y * this.contactNormal.y;
    const push = Math.max(0, -fDotN);
    this.anchored = push > LEVERAGE.anchorForceThreshold;
  }

  /** Convert the anchored push into a clamped counter-impulse on the cauldron. */
  private applyLeverage(dt: number): void {
    const F = this.controller.steerForce;
    const n = this.contactNormal;

    const fDotN = F.x * n.x + F.y * n.y;
    const push = Math.max(0, -fDotN); // magnitude pressing into the ledge

    // Tangential component of the steering force: Ft = F - (F·n)·n
    this.Ft.set(F.x - fDotN * n.x, F.y - fDotN * n.y, 0);
    const ftLen = this.Ft.length();

    // Coulomb cone: friction can hold at most μ·P of tangential push.
    const maxHold = LEVERAGE.frictionSlip * push;
    const held = Math.min(ftLen, maxHold);

    // Reaction on the cauldron: vault along +n, plus held tangential reaction.
    this.R.set(n.x * push, n.y * push, 0);
    if (ftLen > 1e-6) {
      this.R.x -= (this.Ft.x / ftLen) * held;
      this.R.y -= (this.Ft.y / ftLen) * held;
    }

    // Impulse = R · dt · gain, clamped.
    this.R.multiplyScalar(dt * LEVERAGE.gain);
    const impLen = this.R.length();
    if (impLen > LEVERAGE.maxImpulse) {
      this.R.multiplyScalar(LEVERAGE.maxImpulse / impLen);
    }

    this.lastLeverageImpulse.copy(this.R);
    this.cauldron.applyImpulse({ x: this.R.x, y: this.R.y, z: 0 }, true);
  }
}
