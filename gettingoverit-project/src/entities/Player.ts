/**
 * entities/Player.ts
 * -----------------------------------------------------------------------------
 * The player: the BristiSpirs character seated in a heavy cauldron, gripping a
 * Yosemite-style hammer with both hands.
 *
 * Physics:
 *   - Cauldron: heavy dynamic capsule, plane-locked, mid-friction base.
 *   - Hammer:   light dynamic body whose handle can retract/extend so the head
 *               can be pushed into the ground or tucked into tighter spaces.
 *   - Player colliders share a collision group so the hammer never collides
 *     with its own cauldron, only with terrain.
 *
 * Visuals:
 *   - The GLB character follows the cauldron body.
 *   - The hammer mesh follows the hammer body and resizes with the live reach.
 *   - The character hands track grip points on the hammer with 2-bone IK.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CharacterRig } from './CharacterRig';
import { CAULDRON, HAMMER, MODEL, PLANE_Z } from '../data/config';
import type { Vec2 } from '../data/mapData';
import type { ChestPhysicsSettings } from '../data/settingsStore';
import modelUrl from '../assets/BristiSpirs/exported-model-runtime.glb';

const GROUP_TERRAIN = 0x0001;
const GROUP_PLAYER = 0x0002;
const PLAYER_GROUPS = (GROUP_PLAYER << 16) | GROUP_TERRAIN;

const GRIP_OFFSET_Y = CAULDRON.gripOffsetY;
const HAMMER_VISUAL_Z = 0.6;

export class Player {
  readonly cauldronBody: RAPIER.RigidBody;
  readonly hammerBody: RAPIER.RigidBody;
  readonly headCollider: RAPIER.Collider;
  readonly headLocalOffset = new THREE.Vector3(0, HAMMER.handleLength, 0);

  private readonly scene: THREE.Scene;
  private readonly handleCollider: RAPIER.Collider;

  private readonly hammerMesh: THREE.Group;
  private readonly modelGroup = new THREE.Group();
  private readonly rig = new CharacterRig();

  private currentReach: number = HAMMER.handleLength;
  private shaftMesh!: THREE.Mesh;
  private headMesh!: THREE.Mesh;
  private clawMesh!: THREE.Mesh;
  private buttMesh!: THREE.Mesh;

  // Scratch.
  private readonly hq = new THREE.Quaternion();
  private readonly htv = new THREE.Vector3();
  private readonly rightGrip = new THREE.Vector3();
  private readonly leftGrip = new THREE.Vector3();
  private readonly rightPole = new THREE.Vector3();
  private readonly leftPole = new THREE.Vector3();
  private readonly rGripLocal = new THREE.Vector3(MODEL.rightGripLocal.x, MODEL.rightGripLocal.y, MODEL.rightGripLocal.z);
  private readonly lGripLocal = new THREE.Vector3(MODEL.leftGripLocal.x, MODEL.leftGripLocal.y, MODEL.leftGripLocal.z);
  private readonly rightPoleOffset = new THREE.Vector3(MODEL.rightPoleOffset.x, MODEL.rightPoleOffset.y, MODEL.rightPoleOffset.z);
  private readonly leftPoleOffset = new THREE.Vector3(MODEL.leftPoleOffset.x, MODEL.leftPoleOffset.y, MODEL.leftPoleOffset.z);

  constructor(scene: THREE.Scene, world: RAPIER.World, start: Vec2) {
    this.scene = scene;

    const cauldronDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, PLANE_Z)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, false)
      .setLinearDamping(CAULDRON.linearDamping)
      .setAngularDamping(CAULDRON.angularDamping)
      .setCcdEnabled(true);
    this.cauldronBody = world.createRigidBody(cauldronDesc);
    this.cauldronBody.setAdditionalSolverIterations(4);

    const cauldronCol = RAPIER.ColliderDesc.capsule(CAULDRON.halfHeight, CAULDRON.radius)
      .setTranslation(0, CAULDRON.colliderOffsetY, 0)
      .setFriction(CAULDRON.friction)
      .setRestitution(CAULDRON.restitution)
      .setMass(CAULDRON.mass)
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(cauldronCol, this.cauldronBody);

    const hammerDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y + GRIP_OFFSET_Y, PLANE_Z)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true)
      .setLinearDamping(HAMMER.linearDamping)
      .setAngularDamping(HAMMER.angularDamping)
      .setCcdEnabled(true);
    this.hammerBody = world.createRigidBody(hammerDesc);
    this.hammerBody.setAdditionalSolverIterations(4);

    const handleCol = RAPIER.ColliderDesc.capsule(this.getHandleHalfHeight(this.currentReach), HAMMER.handleRadius)
      .setTranslation(0, this.currentReach * 0.5, 0)
      // Let the shaft glance off geometry so the head remains the primary tool.
      .setFriction(0.08)
      .setMass(Math.max(HAMMER.mass - HAMMER.headMass, 0.1))
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.handleCollider = world.createCollider(handleCol, this.hammerBody);

    const he = HAMMER.headHalfExtents;
    const headCol = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setTranslation(0, this.currentReach, 0)
      .setFriction(HAMMER.friction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(HAMMER.restitution)
      .setMass(HAMMER.headMass)
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.headCollider = world.createCollider(headCol, this.hammerBody);

    const jointData = RAPIER.JointData.spherical(
      { x: 0, y: GRIP_OFFSET_Y, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    world.createImpulseJoint(jointData, this.cauldronBody, this.hammerBody, true);

    this.hammerMesh = this.buildHammerMesh();
    scene.add(this.hammerMesh);
    scene.add(this.modelGroup);

    this.syncBodies();
  }

  async loadCharacter(): Promise<void> {
    const root = await this.rig.load(modelUrl);
    this.modelGroup.add(root);
    this.syncBodies();
  }

  /** Cauldron grip pivot in world space. */
  getGripPivot(out: THREE.Vector2): THREE.Vector2 {
    const t = this.cauldronBody.translation();
    const a = 2 * Math.atan2(this.cauldronBody.rotation().z, this.cauldronBody.rotation().w);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return out.set(t.x - s * GRIP_OFFSET_Y, t.y + c * GRIP_OFFSET_Y);
  }

  /** Cauldron centre, used as the camera focus. */
  getFocus(out: THREE.Vector2): THREE.Vector2 {
    const t = this.cauldronBody.translation();
    return out.set(t.x, t.y);
  }

  get hammerReach(): number {
    return this.currentReach;
  }

  /** Apply a new hammer reach to both physics colliders and visuals. */
  setHammerReach(reach: number): void {
    const clamped = THREE.MathUtils.clamp(reach, 0.1, HAMMER.handleLength);
    if (Math.abs(clamped - this.currentReach) < 1e-5) return;

    this.currentReach = clamped;
    this.headLocalOffset.y = clamped;

    this.handleCollider.setShape(new RAPIER.Capsule(this.getHandleHalfHeight(clamped), HAMMER.handleRadius));
    this.handleCollider.setTranslationWrtParent({ x: 0, y: clamped * 0.5, z: 0 });
    this.headCollider.setTranslationWrtParent({ x: 0, y: clamped, z: 0 });

    this.hammerBody.recomputeMassPropertiesFromColliders();
    this.hammerBody.wakeUp();
    this.layoutHammerMesh();
  }

  update(dt: number): void {
    this.syncBodies();

    if (!this.rig.ready) return;

    this.modelGroup.updateWorldMatrix(true, true);

    const ht = this.hammerBody.translation();
    const hr = this.hammerBody.rotation();
    this.hq.set(hr.x, hr.y, hr.z, hr.w);
    this.htv.set(ht.x, ht.y, ht.z);

    this.rightGrip.copy(this.rGripLocal).applyQuaternion(this.hq).add(this.htv);
    this.leftGrip.copy(this.lGripLocal).applyQuaternion(this.hq).add(this.htv);
    this.rightGrip.z += HAMMER_VISUAL_Z;
    this.leftGrip.z += HAMMER_VISUAL_Z;

    this.rightPole.copy(this.rightGrip).add(this.rightPoleOffset);
    this.leftPole.copy(this.leftGrip).add(this.leftPoleOffset);

    this.rig.update(dt, this.rightGrip, this.rightPole, this.leftGrip, this.leftPole);
  }

  applyChestSettings(settings: ChestPhysicsSettings): void {
    this.rig.applyBreastSettings(settings);
  }

  resetTo(start: Vec2): void {
    this.setHammerReach(HAMMER.handleLength);

    this.cauldronBody.setTranslation({ x: start.x, y: start.y, z: PLANE_Z }, false);
    this.cauldronBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
    this.cauldronBody.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.cauldronBody.setAngvel({ x: 0, y: 0, z: 0 }, false);

    this.hammerBody.setTranslation({ x: start.x, y: start.y + GRIP_OFFSET_Y, z: PLANE_Z }, false);
    this.hammerBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
    this.hammerBody.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.hammerBody.setAngvel({ x: 0, y: 0, z: 0 }, false);

    this.cauldronBody.wakeUp();
    this.hammerBody.wakeUp();
    this.rig.resetSecondaryMotion();
    this.syncBodies();
  }

  private syncBodies(): void {
    const ct = this.cauldronBody.translation();
    const cr = this.cauldronBody.rotation();
    this.modelGroup.position.set(ct.x, ct.y, ct.z);
    this.modelGroup.quaternion.set(cr.x, cr.y, cr.z, cr.w);

    const ht = this.hammerBody.translation();
    const hr = this.hammerBody.rotation();
    this.hammerMesh.position.set(ht.x, ht.y, ht.z + HAMMER_VISUAL_Z);
    this.hammerMesh.quaternion.set(hr.x, hr.y, hr.z, hr.w);
  }

  private buildHammerMesh(): THREE.Group {
    const g = new THREE.Group();

    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.7, metalness: 0.1 });
    this.shaftMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(HAMMER.handleRadius, HAMMER.handleRadius, 1, 12),
      shaftMat,
    );
    this.shaftMesh.castShadow = true;
    g.add(this.shaftMesh);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xb04a2a, roughness: 0.5, metalness: 0.4 });
    const he = HAMMER.headHalfExtents;
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2), headMat);
    this.headMesh.castShadow = true;
    g.add(this.headMesh);

    this.clawMesh = new THREE.Mesh(new THREE.BoxGeometry(he.x * 1.4, he.y * 0.5, he.z * 0.6), headMat);
    this.clawMesh.rotation.z = 0.5;
    this.clawMesh.castShadow = true;
    g.add(this.clawMesh);

    this.buttMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(HAMMER.handleRadius * 1.1, HAMMER.handleRadius * 1.25, 0.18, 10),
      shaftMat,
    );
    this.buttMesh.castShadow = true;
    g.add(this.buttMesh);

    this.layoutHammerMesh();
    return g;
  }

  private layoutHammerMesh(): void {
    if (!this.shaftMesh || !this.headMesh || !this.clawMesh || !this.buttMesh) return;

    const he = HAMMER.headHalfExtents;
    const rearReach = HAMMER.rearVisualLength + (HAMMER.handleLength - this.currentReach);
    const totalVisualLength = rearReach + this.currentReach;
    this.shaftMesh.position.y = (this.currentReach - rearReach) * 0.5;
    this.shaftMesh.scale.set(1, totalVisualLength, 1);

    this.headMesh.position.y = this.currentReach;
    this.clawMesh.position.set(-he.x * 0.9, this.currentReach + he.y * 0.6, 0);
    this.buttMesh.position.y = -rearReach;
  }

  private getHandleHalfHeight(reach: number): number {
    return Math.max(reach * 0.5 - HAMMER.handleRadius, 0.001);
  }

  /** Whether the cauldron centre is within the win trigger area. */
  isAt(area: { xMin: number; xMax: number; yMin: number; yMax: number }): boolean {
    const t = this.cauldronBody.translation();
    return t.x >= area.xMin && t.x <= area.xMax && t.y >= area.yMin && t.y <= area.yMax;
  }

  dispose(): void {
    this.scene.remove(this.hammerMesh, this.modelGroup);
  }
}
