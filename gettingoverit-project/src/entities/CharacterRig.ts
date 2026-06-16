/**
 * entities/CharacterRig.ts
 * -----------------------------------------------------------------------------
 * Loads the BristiSpirs GLB (runtime variant), exposes its root for parenting,
 * and drives:
 *   - both arms via analytic 2-bone IK so the hands track the hammer handle,
 *   - the breast bones via the ported secondary-motion controller.
 *
 * The demo "Jumping Jacks" clip is intentionally NOT played; the body stays in
 * bind pose while the arms (IK) and breasts (physics) are posed each frame.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ArmIK } from '../systems/ArmIK';
import { BreastPhysics } from '../systems/BreastPhysics';
import { MODEL, BREAST } from '../data/config';

export class CharacterRig {
  root: THREE.Object3D | null = null;
  ready = false;

  private rightArm: ArmIK | null = null;
  private leftArm: ArmIK | null = null;
  private breast: BreastPhysics | null = null;
  private readonly bones = new Map<string, THREE.Bone>();

  async load(url: string): Promise<THREE.Object3D> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds drift; never cull the hero
      }
      const bone = o as THREE.Bone;
      if (bone.isBone) this.bones.set(bone.name.toLowerCase(), bone);
    });

    // Bring the model to game scale / pose.
    root.scale.setScalar(MODEL.scale);
    root.position.y = MODEL.yOffset;
    root.rotation.y = MODEL.faceRotationY;

    // Grip target reaches out to the finger root (middle_01_*), not the wrist
    // (hand_*), so the hammer sits in the hand rather than through the palm.
    this.rightArm = this.makeArm('upperarm_r', 'lowerarm_r', 'hand_r', 'middle_01_r');
    this.leftArm = this.makeArm('upperarm_l', 'lowerarm_l', 'hand_l', 'middle_01_l');

    this.breast = new BreastPhysics(root, {
      boneNames: BREAST.boneNames as unknown as string[],
      enabled: BREAST.enabled,
      stiffness: BREAST.stiffness,
      damping: BREAST.damping,
      gravity: BREAST.gravity,
      mass: BREAST.mass,
    });

    this.root = root;
    this.ready = true;
    return root;
  }

  private makeArm(upper: string, lower: string, hand: string, grip?: string): ArmIK | null {
    const u = this.bones.get(upper);
    const l = this.bones.get(lower);
    const h = this.bones.get(hand);
    const g = grip ? this.bones.get(grip) : undefined;
    if (!u || !l || !h) {
      console.warn(`CharacterRig: missing arm bones ${upper}/${lower}/${hand}`);
      return null;
    }
    if (grip && !g) {
      console.warn(`CharacterRig: missing grip bone ${grip}, falling back to ${hand}`);
    }
    return new ArmIK(u, l, h, g);
  }

  /** Pose arms to the hammer grips and advance breast secondary motion. */
  update(
    dt: number,
    rightTarget: THREE.Vector3,
    rightPole: THREE.Vector3,
    leftTarget: THREE.Vector3,
    leftPole: THREE.Vector3,
  ): void {
    if (!this.ready) return;
    this.rightArm?.solve(rightTarget, rightPole);
    this.leftArm?.solve(leftTarget, leftPole);
    this.breast?.update(dt);
  }
}
