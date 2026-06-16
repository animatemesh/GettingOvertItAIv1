/**
 * systems/BreastPhysics.ts
 * -----------------------------------------------------------------------------
 * Typed port of the AnimateMesh `breast-physics-runtime.js` shipped alongside
 * the BristiSpirs model. Same spring-damper secondary-motion algorithm: each
 * registered bone is pulled toward its bind position by a spring, damped by its
 * velocity, with optional gravity — integrated in world space and written back
 * into the bone's local frame every frame.
 *
 * Faithful to the original; only re-expressed in TypeScript so it type-checks
 * cleanly in this project (the original .js is kept in src/assets as reference).
 * Use with the RUNTIME glb (not the baked one) so the motion isn't applied twice.
 */

import { Matrix4, Vector3 } from 'three';
import type { Object3D, Bone } from 'three';

export interface BreastPhysicsConfig {
  boneNames?: string[];
  enabled?: boolean;
  stiffness?: number;
  damping?: number;
  gravity?: number;
  mass?: number;
}

interface BoneState {
  bone: Bone;
  bindLocalPosition: Vector3;
  simulatedWorldPosition: Vector3;
  velocity: Vector3;
}

const DEFAULT_BONE_NAMES = ['breast_l', 'breast_r'];

function num(value: unknown, fallback: number, min = -Infinity): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export class BreastPhysics {
  private readonly root: Object3D;
  enabled: boolean;
  private readonly stiffness: number;
  private readonly damping: number;
  private readonly gravity: number;
  private readonly mass: number;

  private states: BoneState[] = [];

  private readonly _targetWorld = new Vector3();
  private readonly _displacement = new Vector3();
  private readonly _force = new Vector3();
  private readonly _local = new Vector3();
  private readonly _invParent = new Matrix4();

  constructor(root: Object3D, config: BreastPhysicsConfig = {}) {
    this.root = root;
    this.stiffness = num(config.stiffness, 30, 0);
    this.damping = num(config.damping, 5, 0);
    this.gravity = num(config.gravity, 0);
    this.mass = num(config.mass, 1, 0.05);
    this.enabled = config.enabled !== false;
    this.register(config.boneNames ?? DEFAULT_BONE_NAMES);
  }

  /** Find the requested bones under the root and snapshot their bind pose. */
  register(boneNames: string[] = DEFAULT_BONE_NAMES): number {
    this.states = [];
    this.root.updateWorldMatrix?.(true, true);

    const requested = new Set(boneNames.map((n) => String(n).trim().toLowerCase()).filter(Boolean));

    this.root.traverse((child: Object3D) => {
      if ((child as Bone).isBone !== true) return;
      const name = String(child.name ?? '').trim().toLowerCase();
      if (!requested.has(name)) return;

      const bone = child as Bone;
      const initialWorld = new Vector3();
      bone.getWorldPosition(initialWorld);
      this.states.push({
        bone,
        bindLocalPosition: bone.position.clone(),
        simulatedWorldPosition: initialWorld.clone(),
        velocity: new Vector3(),
      });
    });

    return this.states.length;
  }

  reset(): void {
    for (const state of this.states) {
      state.bone.position.copy(state.bindLocalPosition);
      state.bone.updateMatrix();
      state.bone.updateMatrixWorld(true);
      state.bone.getWorldPosition(state.simulatedWorldPosition);
      state.velocity.set(0, 0, 0);
    }
  }

  update(deltaTime: number): void {
    if (!this.enabled || this.states.length === 0) return;

    const dt = Math.min(Math.max(Number(deltaTime) || 0, 0), 1 / 30);
    if (dt <= 0) return;

    for (const state of this.states) {
      const parent = state.bone.parent;
      if (parent === null) continue;

      // Where the bone WANTS to be (bind pose, in current world space).
      state.bone.position.copy(state.bindLocalPosition);
      state.bone.updateMatrix();
      state.bone.updateMatrixWorld(true);
      state.bone.getWorldPosition(this._targetWorld);

      // Spring toward target, damp by velocity, add gravity.
      this._displacement.subVectors(this._targetWorld, state.simulatedWorldPosition);
      this._force.copy(this._displacement).multiplyScalar(this.stiffness);
      this._force.addScaledVector(state.velocity, -this.damping);
      this._force.y += this.gravity * this.mass;

      const invMass = 1 / this.mass;
      state.velocity.addScaledVector(this._force, dt * invMass);
      state.simulatedWorldPosition.addScaledVector(state.velocity, dt);

      // Convert the simulated world position back into the bone's local frame.
      this._invParent.copy(parent.matrixWorld).invert();
      this._local.copy(state.simulatedWorldPosition).applyMatrix4(this._invParent);

      state.bone.position.copy(this._local);
      state.bone.updateMatrix();
      state.bone.updateMatrixWorld(true);
    }
  }
}
