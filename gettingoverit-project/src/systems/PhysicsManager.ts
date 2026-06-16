/**
 * systems/PhysicsManager.ts
 * -----------------------------------------------------------------------------
 * Reads hammer-head contacts against climbable terrain and converts blocked
 * head motion into a controlled assist impulse on the cauldron.
 *
 * This mirrors the core Getting Over It idea:
 * - the cursor asks the hammer head to move somewhere,
 * - the PD controller pushes the head toward that target,
 * - when terrain blocks that motion, the player body receives the reaction.
 *
 * For a planted contact we pick the single best support surface instead of
 * averaging every contact together. Then:
 *   n  = outward contact normal from terrain toward hammer head
 *   P  = max(0, -(F dot n))   normal push into the surface
 *   R  = P * n                lift assist on the cauldron
 *
 * A small tangent-only damping impulse is added to help the planted head stop
 * skating sideways, but we intentionally avoid inventing a big sideways assist.
 * The raw joint/contact physics handles the arc and sweep around a caught head;
 * the extra impulse mainly restores dependable lift and ledge stability.
 *
 * The important fix here is that the surface direction comes from Rapier's
 * actual contact points, not from collider centers, which avoids inverted
 * responses on larger blocks and corners.
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
  private readonly hammer: RAPIER.RigidBody;
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
  private readonly headColliderPos = new THREE.Vector3();
  private readonly otherColliderPos = new THREE.Vector3();
  private readonly headContactWorld = new THREE.Vector3();
  private readonly terrainContactWorld = new THREE.Vector3();
  private readonly bestNormal = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly R = new THREE.Vector3();
  private readonly headQuat = new THREE.Quaternion();
  private readonly otherQuat = new THREE.Quaternion();

  constructor(opts: PhysicsManagerOpts) {
    this.world = opts.world;
    this.cauldron = opts.cauldronBody;
    const hammerBody = opts.headCollider.parent();
    if (!hammerBody) {
      throw new Error('PhysicsManager requires the hammer head collider to be attached to a rigid body.');
    }
    this.hammer = hammerBody;
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

  /** Drain collision start events so HUD/audio can react to fresh impacts. */
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
    this.bestNormal.set(0, 0, 0);

    const headTranslation = this.headCollider.translation();
    this.headColliderPos.set(headTranslation.x, headTranslation.y, headTranslation.z);
    const headRotation = this.headCollider.rotation();
    this.headQuat.set(headRotation.x, headRotation.y, headRotation.z, headRotation.w);

    const F = this.controller.steerForce;
    let contactCount = 0;
    let bestScore = -Infinity;
    let bestPush = 0;
    let bestAssist = 0;

    this.world.contactPairsWith(this.headCollider, (other) => {
      if (!this.isTerrain(other.handle)) return;

      const otherTranslation = other.translation();
      this.otherColliderPos.set(otherTranslation.x, otherTranslation.y, otherTranslation.z);
      const otherRotation = other.rotation();
      this.otherQuat.set(otherRotation.x, otherRotation.y, otherRotation.z, otherRotation.w);

      this.world.contactPair(this.headCollider, other, (manifold, flipped) => {
        const num = manifold.numContacts();
        if (num === 0) return;

        this.nAccum.set(0, 0, 0);
        let manifoldContacts = 0;

        for (let i = 0; i < num; i++) {
          const p1 = manifold.localContactPoint1(i);
          const p2 = manifold.localContactPoint2(i);
          if (!p1 || !p2) continue;

          const headLocal = flipped ? p2 : p1;
          const terrainLocal = flipped ? p1 : p2;

          this.headContactWorld
            .set(headLocal.x, headLocal.y, headLocal.z)
            .applyQuaternion(this.headQuat)
            .add(this.headColliderPos);
          this.terrainContactWorld
            .set(terrainLocal.x, terrainLocal.y, terrainLocal.z)
            .applyQuaternion(this.otherQuat)
            .add(this.otherColliderPos);

          this.tmpN.copy(this.headContactWorld).sub(this.terrainContactWorld);
          this.tmpN.z = 0;

          const len = this.tmpN.length();
          if (len < 1e-6) continue;

          this.nAccum.addScaledVector(this.tmpN, 1 / len);
          manifoldContacts += 1;
        }

        if (manifoldContacts > 0) {
          this.nAccum.normalize();
        } else {
          const rawNormal = manifold.normal();
          this.nAccum.set(rawNormal.x, rawNormal.y, 0);

          const len = this.nAccum.length();
          if (len < 1e-6) return;

          this.nAccum.multiplyScalar(1 / len);
          // Rapier's raw manifold normal points outward from collider1 in the
          // raw pair ordering. We request (head, terrain), so if the pair was
          // not flipped collider1 is the head and we invert to get terrain->head.
          if (!flipped) this.nAccum.multiplyScalar(-1);
          manifoldContacts = 1;
        }

        contactCount += manifoldContacts;

        const push = Math.max(0, -(F.x * this.nAccum.x + F.y * this.nAccum.y));
        const assist = this.surfaceAssist(this.nAccum);
        const score =
          (push > 0 && assist > 0 ? 1000 : 0) +
          push * (0.35 + assist) +
          assist * 8 +
          Math.max(0, this.nAccum.y);

        if (score > bestScore) {
          bestScore = score;
          bestPush = push;
          bestAssist = assist;
          this.bestNormal.copy(this.nAccum);
        }
      });
    });

    if (contactCount === 0) {
      this.touchingTerrain = false;
      this.anchored = false;
      this.contactNormal.set(0, 0, 0);
      return;
    }
    this.touchingTerrain = true;

    const bestLen = this.bestNormal.length();
    if (bestLen < 1e-6) {
      this.anchored = false;
      this.contactNormal.set(0, 0, 0);
      return;
    }
    this.contactNormal.copy(this.bestNormal).multiplyScalar(1 / bestLen);

    const threshold =
      LEVERAGE.anchorForceThreshold *
      THREE.MathUtils.lerp(1, LEVERAGE.surfaceAnchorThresholdScale, bestAssist);
    this.anchored = bestAssist > 0 && bestPush > threshold;
  }

  /** Convert blocked head motion into a clamped assist impulse on the cauldron. */
  private applyLeverage(dt: number): void {
    const F = this.controller.steerForce;
    const n = this.contactNormal;
    const assist = this.surfaceAssist(n);
    if (assist <= 0) {
      this.lastLeverageImpulse.set(0, 0, 0);
      return;
    }

    const fDotN = F.x * n.x + F.y * n.y;
    const push = Math.max(0, -fDotN);
    if (push <= 0) {
      this.lastLeverageImpulse.set(0, 0, 0);
      return;
    }

    this.R.set(n.x * push, n.y * push, 0);
    this.R.multiplyScalar(dt * LEVERAGE.gain * assist);

    this.tangent.set(-n.y, n.x, 0);
    const headVelocity = this.hammer.velocityAtPoint({
      x: this.headColliderPos.x,
      y: this.headColliderPos.y,
      z: this.headColliderPos.z,
    });
    const slipSpeed = headVelocity.x * this.tangent.x + headVelocity.y * this.tangent.y;
    const stickScale =
      LEVERAGE.surfaceStickImpulseScale *
      THREE.MathUtils.lerp(1, LEVERAGE.surfaceGripBoost, assist);
    const stickImpulse = THREE.MathUtils.clamp(
      -slipSpeed * stickScale,
      -LEVERAGE.surfaceStickMaxImpulse,
      LEVERAGE.surfaceStickMaxImpulse,
    );
    this.R.addScaledVector(this.tangent, stickImpulse);

    const impLen = this.R.length();
    if (impLen > LEVERAGE.maxImpulse) {
      this.R.multiplyScalar(LEVERAGE.maxImpulse / impLen);
    }

    this.lastLeverageImpulse.copy(this.R);
    this.cauldron.applyImpulse({ x: this.R.x, y: this.R.y, z: 0 }, true);
  }

  private surfaceAssist(normal: THREE.Vector3): number {
    const upness = Math.max(0, normal.y);
    return THREE.MathUtils.smoothstep(
      upness,
      LEVERAGE.surfaceAssistMinUpness,
      LEVERAGE.surfaceAssistFullUpness,
    );
  }
}
