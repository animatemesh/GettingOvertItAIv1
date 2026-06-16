/**
 * entities/Player.ts
 * -----------------------------------------------------------------------------
 * The player: the BristiSpirs character seated in a heavy cauldron, gripping a
 * Yosemite-style hammer with both hands.
 *
 * Physics (unchanged by the model swap):
 *   - Cauldron: heavy dynamic capsule, plane-locked, mid friction base.
 *   - Hammer:   light dynamic body (thin handle + dense head) whose grip is
 *               pinned to the cauldron by a spherical joint.
 *   - Player colliders share a collision group so the hammer never collides
 *     with its own cauldron, only with terrain.
 *
 * Visuals:
 *   - The pot mesh follows the cauldron body.
 *   - The hammer mesh (handle + head) follows the (mouse-driven) hammer body.
 *   - The GLB character is parented to a group that follows the cauldron body;
 *     its arms are solved with 2-bone IK so the hands track the hammer grips,
 *     and its breast bones are driven by the ported secondary-motion controller.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CharacterRig } from './CharacterRig';
import { CAULDRON, HAMMER, MODEL, PLANE_Z } from '../data/config';
import type { Vec2 } from '../data/mapData';
import modelUrl from '../assets/BristiSpirs/exported-model-runtime.glb';

// Collision groups: players collide with terrain only, never with themselves.
const GROUP_TERRAIN = 0x0001;
const GROUP_PLAYER = 0x0002;
const PLAYER_GROUPS = (GROUP_PLAYER << 16) | GROUP_TERRAIN;

const GRIP_OFFSET_Y = CAULDRON.halfHeight + 0.35; // pivot height above pot centre

export class Player {
  readonly cauldronBody: RAPIER.RigidBody;
  readonly hammerBody: RAPIER.RigidBody;
  readonly headCollider: RAPIER.Collider;
  readonly headLocalOffset = new THREE.Vector3(0, HAMMER.handleLength, 0);

  private readonly scene: THREE.Scene;

  // Visual roots.
  private readonly potMesh: THREE.Group;
  private readonly hammerMesh: THREE.Group;
  private readonly modelGroup = new THREE.Group();
  private readonly rig = new CharacterRig();

  // Scratch.
  private readonly hq = new THREE.Quaternion();
  private readonly htv = new THREE.Vector3();
  private readonly rightGrip = new THREE.Vector3();
  private readonly leftGrip = new THREE.Vector3();
  private readonly rightPole = new THREE.Vector3();
  private readonly leftPole = new THREE.Vector3();
  private readonly rGripLocal = new THREE.Vector3(MODEL.rightGripLocal.x, MODEL.rightGripLocal.y, MODEL.rightGripLocal.z);
  private readonly lGripLocal = new THREE.Vector3(MODEL.leftGripLocal.x, MODEL.leftGripLocal.y, MODEL.leftGripLocal.z);
  private readonly poleOffset = new THREE.Vector3(MODEL.poleOffset.x, MODEL.poleOffset.y, MODEL.poleOffset.z);

  constructor(scene: THREE.Scene, world: RAPIER.World, start: Vec2) {
    this.scene = scene;

    /* --- Cauldron body ------------------------------------------------- */
    const cauldronDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, PLANE_Z)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true)
      .setLinearDamping(CAULDRON.linearDamping)
      .setAngularDamping(CAULDRON.angularDamping)
      .setCcdEnabled(true);
    this.cauldronBody = world.createRigidBody(cauldronDesc);

    const cauldronCol = RAPIER.ColliderDesc.capsule(CAULDRON.halfHeight, CAULDRON.radius)
      .setFriction(CAULDRON.friction)
      .setRestitution(CAULDRON.restitution)
      .setMass(CAULDRON.mass)
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(cauldronCol, this.cauldronBody);

    /* --- Hammer body --------------------------------------------------- */
    const hammerDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y + GRIP_OFFSET_Y, PLANE_Z)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true)
      .setLinearDamping(HAMMER.linearDamping)
      .setAngularDamping(HAMMER.angularDamping)
      .setCcdEnabled(true);
    this.hammerBody = world.createRigidBody(hammerDesc);

    const handleCol = RAPIER.ColliderDesc.capsule(HAMMER.handleLength / 2, HAMMER.handleRadius)
      .setTranslation(0, HAMMER.handleLength / 2, 0)
      .setFriction(0.4)
      .setMass(Math.max(HAMMER.mass - HAMMER.headMass, 0.1))
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(handleCol, this.hammerBody);

    const he = HAMMER.headHalfExtents;
    const headCol = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setTranslation(0, HAMMER.handleLength, 0)
      .setFriction(HAMMER.friction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(HAMMER.restitution)
      .setMass(HAMMER.headMass)
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.headCollider = world.createCollider(headCol, this.hammerBody);

    /* --- Spherical grip joint: hammer grip -> cauldron pivot ----------- */
    const jointData = RAPIER.JointData.spherical(
      { x: 0, y: GRIP_OFFSET_Y, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    world.createImpulseJoint(jointData, this.cauldronBody, this.hammerBody, true);

    /* --- Visuals ------------------------------------------------------- */
    this.potMesh = this.buildPotMesh();
    this.hammerMesh = this.buildHammerMesh();
    scene.add(this.potMesh);
    scene.add(this.hammerMesh);
    scene.add(this.modelGroup);

    this.syncBodies();
  }

  /** Load the GLB character and parent it under the body-tracking group. */
  async loadCharacter(): Promise<void> {
    const root = await this.rig.load(modelUrl);
    this.modelGroup.add(root);
    this.syncBodies();
  }

  /* ------------------------------------------------------------------ */
  /*  Public accessors used by controllers / camera                      */
  /* ------------------------------------------------------------------ */

  /** Cauldron grip pivot in world space (the handle extends from here). */
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

  /* ------------------------------------------------------------------ */
  /*  Per-frame update                                                   */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    this.syncBodies();

    if (!this.rig.ready) return;

    // Make sure the body-tracked group's world matrix is current before IK.
    this.modelGroup.updateWorldMatrix(true, true);

    // Hammer transform -> world grip targets on the handle.
    const ht = this.hammerBody.translation();
    const hr = this.hammerBody.rotation();
    this.hq.set(hr.x, hr.y, hr.z, hr.w);
    this.htv.set(ht.x, ht.y, ht.z);

    this.rightGrip.copy(this.rGripLocal).applyQuaternion(this.hq).add(this.htv);
    this.leftGrip.copy(this.lGripLocal).applyQuaternion(this.hq).add(this.htv);

    // Pole hint biases the elbows toward the camera and downward.
    this.rightPole.copy(this.rightGrip).add(this.poleOffset);
    this.leftPole.copy(this.leftGrip).add(this.poleOffset);

    this.rig.update(dt, this.rightGrip, this.rightPole, this.leftGrip, this.leftPole);
  }

  /** Copy the physics transforms onto the pot/hammer/model groups. */
  private syncBodies(): void {
    const ct = this.cauldronBody.translation();
    const cr = this.cauldronBody.rotation();
    this.potMesh.position.set(ct.x, ct.y, ct.z);
    this.potMesh.quaternion.set(cr.x, cr.y, cr.z, cr.w);
    this.modelGroup.position.set(ct.x, ct.y, ct.z);
    this.modelGroup.quaternion.set(cr.x, cr.y, cr.z, cr.w);

    const ht = this.hammerBody.translation();
    const hr = this.hammerBody.rotation();
    this.hammerMesh.position.set(ht.x, ht.y, ht.z);
    this.hammerMesh.quaternion.set(hr.x, hr.y, hr.z, hr.w);
  }

  /* ------------------------------------------------------------------ */
  /*  Mesh construction                                                  */
  /* ------------------------------------------------------------------ */

  private buildPotMesh(): THREE.Group {
    const g = new THREE.Group();
    const potMat = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.55, metalness: 0.55 });

    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(CAULDRON.radius, CAULDRON.radius * 0.8, CAULDRON.halfHeight * 2, 28, 1, true),
      potMat,
    );
    pot.material.side = THREE.DoubleSide;
    pot.castShadow = true;
    pot.receiveShadow = true;
    g.add(pot);

    // Rounded base cap so the pot rocks rather than sits flat.
    const base = new THREE.Mesh(
      new THREE.SphereGeometry(CAULDRON.radius * 0.8, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      potMat,
    );
    base.position.y = -CAULDRON.halfHeight;
    base.castShadow = true;
    g.add(base);

    return g;
  }

  private buildHammerMesh(): THREE.Group {
    const g = new THREE.Group();

    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.7, metalness: 0.1 });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(HAMMER.handleRadius, HAMMER.handleRadius, HAMMER.handleLength, 12),
      shaftMat,
    );
    shaft.position.y = HAMMER.handleLength / 2;
    shaft.castShadow = true;
    g.add(shaft);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xb04a2a, roughness: 0.5, metalness: 0.4 });
    const he = HAMMER.headHalfExtents;
    const head = new THREE.Mesh(new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2), headMat);
    head.position.y = HAMMER.handleLength;
    head.castShadow = true;
    g.add(head);

    const claw = new THREE.Mesh(new THREE.BoxGeometry(he.x * 1.4, he.y * 0.5, he.z * 0.6), headMat);
    claw.position.set(-he.x * 0.9, HAMMER.handleLength + he.y * 0.6, 0);
    claw.rotation.z = 0.5;
    claw.castShadow = true;
    g.add(claw);

    return g;
  }

  /** Whether the cauldron centre is within the win trigger area. */
  isAt(area: { xMin: number; xMax: number; yMin: number; yMax: number }): boolean {
    const t = this.cauldronBody.translation();
    return t.x >= area.xMin && t.x <= area.xMax && t.y >= area.yMin && t.y <= area.yMax;
  }

  dispose(): void {
    this.scene.remove(this.potMesh, this.hammerMesh, this.modelGroup);
  }
}
