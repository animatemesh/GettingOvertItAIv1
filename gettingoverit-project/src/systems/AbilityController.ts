/**
 * systems/AbilityController.ts
 * -----------------------------------------------------------------------------
 * Handles the equipped hammer and its LMB special ability:
 *   - Thor: a god-slam that launches the body skyward.
 *   - Ice: freezes the body + hammer and drops the world into slow-motion (3s).
 *   - Spiderman: hold LMB to shoot a web at terrain and swing from it.
 *   - Phoenix: a fiery dash toward the cursor.
 *   - Magnetar: a magnetic yank from the cauldron to the hammer head.
 *   - Comet: a recoil blast away from the cursor.
 *
 * Abilities act directly on the existing physics bodies (impulses), the engine
 * time scale (slow-mo), and temporary rope joints (web). Ground-slam points/VFX
 * are handled separately in Game.ts.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import type { Player } from '../entities/Player';
import type { SlamVfx } from './SlamVfx';
import { HAMMERS, type HammerId, type HammerKind } from '../data/hammers';
import { PLANE_Z } from '../data/config';

// --- Ability tuning ---------------------------------------------------------
const THOR_LAUNCH = 150; // upward impulse on the cauldron for a much stronger launch
const THOR_SLAM_DOWN = 42; // heavier downward whack on the hammer head
const ICE_TIME_SCALE = 0.25;
const ICE_SLOWMO_SEC = 3.0; // real seconds
const WEB_MAX_RANGE = 22; // how far a web can reach
const WEB_CORE_THICKNESS = 0.11;
const WEB_GLOW_THICKNESS = 0.2;
const PHOENIX_DASH = 84;
const PHOENIX_HAMMER_KICK = 42;
const MAGNETAR_PULL = 142;
const MAGNETAR_HAMMER_DAMP = 0.18;
const COMET_RECOIL = 330;
const COMET_HAMMER_DRIVE = 180;

export interface AbilityControllerOpts {
  engine: Engine;
  world: RAPIER.World;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  player: Player;
  vfx: SlamVfx;
  isTerrain: (handle: number) => boolean;
  /** Notified when the equipped hammer changes (HUD + recolour). */
  onHammerChange: (kind: HammerKind) => void;
}

export class AbilityController {
  private readonly engine: Engine;
  private readonly world: RAPIER.World;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly player: Player;
  private readonly vfx: SlamVfx;
  private readonly isTerrain: (handle: number) => boolean;
  private readonly onHammerChange: (kind: HammerKind) => void;

  private current: HammerId = 'basic';
  private cooldownLeft = 0;
  private slowmoLeft = 0;

  // Spiderman web state.
  private webAnchorBody: RAPIER.RigidBody | null = null;
  private webJoint: RAPIER.ImpulseJoint | null = null;
  private webVisual: THREE.Group | null = null;
  private webCore: THREE.Mesh | null = null;
  private webGlow: THREE.Mesh | null = null;
  private readonly webAnchor = new THREE.Vector3();

  // Pointer aim tracking (world point on the gameplay plane).
  private readonly ndc = new THREE.Vector2(0, 0);
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLANE_Z);
  private readonly aim = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(opts: AbilityControllerOpts) {
    this.engine = opts.engine;
    this.world = opts.world;
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.player = opts.player;
    this.vfx = opts.vfx;
    this.isTerrain = opts.isTerrain;
    this.onHammerChange = opts.onHammerChange;

    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    // Suppress the context menu so RMB/other inputs feel clean if added later.
    this.domElement.addEventListener('contextmenu', this.onContextMenu);

    this.setHammer('basic');
  }

  get currentKind(): HammerKind {
    return HAMMERS[this.current];
  }

  /** 0..1 fraction of the ability cooldown remaining (for HUD). */
  get cooldownRatio(): number {
    const total = this.currentKind.cooldownSec;
    return total > 0 ? Math.min(1, Math.max(0, this.cooldownLeft / total)) : 0;
  }

  setHammer(id: HammerId): void {
    this.releaseWeb();
    this.current = id;
    const kind = HAMMERS[id];
    this.player.setHammerColors(kind.headColor, kind.shaftColor);
    this.onHammerChange(kind);
  }

  /** Per-frame, real (unscaled) dt. */
  update(realDt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - realDt);

    if (this.slowmoLeft > 0) {
      this.slowmoLeft -= realDt;
      if (this.slowmoLeft <= 0) this.engine.timeScale = 1;
    }

    if (this.webJoint) this.updateWebVisual();
  }

  reset(): void {
    this.releaseWeb();
    this.cooldownLeft = 0;
    this.slowmoLeft = 0;
    this.engine.timeScale = 1;
  }

  dispose(): void {
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.reset();
  }

  /* ------------------------------------------------------------------ */
  /*  Input                                                              */
  /* ------------------------------------------------------------------ */

  private onContextMenu = (e: Event): void => e.preventDefault();

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.activate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.current === 'spiderman') this.releaseWeb();
  };

  private activate(): void {
    switch (this.current) {
      case 'thor':
        if (this.cooldownLeft <= 0) this.thorLaunch();
        break;
      case 'ice':
        if (this.cooldownLeft <= 0) this.iceFreeze();
        break;
      case 'spiderman':
        this.shootWeb();
        break;
      case 'phoenix':
        if (this.cooldownLeft <= 0) this.phoenixDash();
        break;
      case 'magnetar':
        if (this.cooldownLeft <= 0) this.magnetarPull();
        break;
      case 'comet':
        if (this.cooldownLeft <= 0) this.cometBlast();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Abilities                                                          */
  /* ------------------------------------------------------------------ */

  private thorLaunch(): void {
    this.player.headWorldPosition(this.head);
    // Whack the head down for the slam look, and launch the body upward.
    this.player.hammerBody.applyImpulseAtPoint(
      { x: 0, y: -THOR_SLAM_DOWN, z: 0 },
      { x: this.head.x, y: this.head.y, z: this.head.z },
      true,
    );
    this.player.cauldronBody.applyImpulse({ x: 0, y: THOR_LAUNCH, z: 0 }, true);
    this.vfx.burst(this.head.x, this.head.y, this.head.z, 0xcfe6ff, 70, 10);
    this.vfx.burst(this.head.x, this.head.y, this.head.z, 0xffffff, 24, 6);
    this.cooldownLeft = this.currentKind.cooldownSec;
  }

  private iceFreeze(): void {
    // Freeze: kill all motion, then drop into slow-motion for a few real seconds.
    this.player.cauldronBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.player.hammerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.player.hammerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.engine.timeScale = ICE_TIME_SCALE;
    this.slowmoLeft = ICE_SLOWMO_SEC;

    this.player.headWorldPosition(this.head);
    this.vfx.burst(this.head.x, this.head.y, this.head.z, 0xbff0ff, 55, 4);
    this.cooldownLeft = this.currentKind.cooldownSec;
  }

  private shootWeb(): void {
    this.releaseWeb();

    // Origin = cauldron centre; direction = toward the cursor.
    const ct = this.player.cauldronBody.translation();
    this.origin.set(ct.x, ct.y, PLANE_Z);
    this.computeAim();
    const dx = this.aim.x - this.origin.x;
    const dy = this.aim.y - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const dirx = dx / len;
    const diry = dy / len;

    const ray = new RAPIER.Ray(
      { x: this.origin.x, y: this.origin.y, z: PLANE_Z },
      { x: dirx, y: diry, z: 0 },
    );
    const hit = this.world.castRay(
      ray,
      WEB_MAX_RANGE,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.isTerrain(collider.handle),
    );
    if (!hit) return; // no surface in range to grab

    const toi = Math.max(0.6, hit.timeOfImpact); // keep the web from being zero-length
    this.webAnchor.set(this.origin.x + dirx * toi, this.origin.y + diry * toi, PLANE_Z);

    this.webAnchorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(this.webAnchor.x, this.webAnchor.y, PLANE_Z),
    );
    // Rope = a taut leash you swing on; length is the current distance.
    const jd = RAPIER.JointData.rope(toi, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    this.webJoint = this.world.createImpulseJoint(jd, this.player.cauldronBody, this.webAnchorBody, true);

    this.spawnWebVisual();
    this.vfx.burst(this.webAnchor.x, this.webAnchor.y, PLANE_Z, 0xffffff, 16, 3);
  }

  private phoenixDash(): void {
    if (!this.computeAimDirection()) return;

    this.player.headWorldPosition(this.head);
    this.player.cauldronBody.applyImpulse(
      { x: this.dir.x * PHOENIX_DASH, y: this.dir.y * PHOENIX_DASH, z: 0 },
      true,
    );
    this.player.hammerBody.applyImpulseAtPoint(
      { x: -this.dir.x * PHOENIX_HAMMER_KICK, y: -this.dir.y * PHOENIX_HAMMER_KICK, z: 0 },
      { x: this.head.x, y: this.head.y, z: this.head.z },
      true,
    );

    const body = this.player.cauldronBody.translation();
    this.vfx.burst(body.x, body.y + 0.35, PLANE_Z, 0xff7a1a, 46, 7.5);
    this.vfx.burst(this.head.x, this.head.y, this.head.z, 0xffd06a, 24, 5.5);
    this.cooldownLeft = this.currentKind.cooldownSec;
  }

  private magnetarPull(): void {
    const body = this.player.cauldronBody.translation();
    this.player.headWorldPosition(this.head);
    this.dir.set(this.head.x - body.x, this.head.y - body.y, 0);
    const len = this.dir.length();
    if (len < 1e-3) return;
    this.dir.multiplyScalar(1 / len);

    this.player.cauldronBody.applyImpulse(
      { x: this.dir.x * MAGNETAR_PULL, y: this.dir.y * MAGNETAR_PULL, z: 0 },
      true,
    );

    const hammerVel = this.player.hammerBody.linvel();
    this.player.hammerBody.setLinvel(
      {
        x: hammerVel.x * MAGNETAR_HAMMER_DAMP,
        y: hammerVel.y * MAGNETAR_HAMMER_DAMP,
        z: 0,
      },
      true,
    );
    this.player.hammerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    this.vfx.burst(this.head.x, this.head.y, this.head.z, 0x6ff3df, 58, 6);
    this.vfx.burst(body.x, body.y + 0.25, PLANE_Z, 0x9ffff4, 28, 4.5);
    this.cooldownLeft = this.currentKind.cooldownSec;
  }

  private cometBlast(): void {
    if (!this.computeAimDirection()) return;

    this.player.headWorldPosition(this.head);
    this.player.cauldronBody.applyImpulse(
      { x: -this.dir.x * COMET_RECOIL, y: -this.dir.y * COMET_RECOIL, z: 0 },
      true,
    );
    this.player.hammerBody.applyImpulseAtPoint(
      { x: this.dir.x * COMET_HAMMER_DRIVE, y: this.dir.y * COMET_HAMMER_DRIVE, z: 0 },
      { x: this.head.x, y: this.head.y, z: this.head.z },
      true,
    );

    const body = this.player.cauldronBody.translation();
    this.vfx.burst(body.x, body.y + 0.25, PLANE_Z, 0xf8d66d, 54, 8);
    this.vfx.burst(this.head.x, this.head.y, this.head.z, 0xffffff, 18, 5);
    this.cooldownLeft = this.currentKind.cooldownSec;
  }

  private releaseWeb(): void {
    if (this.webJoint) {
      this.world.removeImpulseJoint(this.webJoint, true);
      this.webJoint = null;
    }
    if (this.webAnchorBody) {
      this.world.removeRigidBody(this.webAnchorBody);
      this.webAnchorBody = null;
    }
    if (this.webVisual) {
      this.webVisual.removeFromParent();
      this.disposeWebMesh(this.webCore);
      this.disposeWebMesh(this.webGlow);
      this.webVisual = null;
      this.webCore = null;
      this.webGlow = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private computeAim(): void {
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.aim)) {
      // Fallback: straight up from the body.
      const ct = this.player.cauldronBody.translation();
      this.aim.set(ct.x, ct.y + 5, PLANE_Z);
    }
    this.aim.z = PLANE_Z;
  }

  private computeAimDirection(): boolean {
    const body = this.player.cauldronBody.translation();
    this.origin.set(body.x, body.y, PLANE_Z);
    this.computeAim();
    this.dir.set(this.aim.x - this.origin.x, this.aim.y - this.origin.y, 0);
    const len = this.dir.length();
    if (len < 1e-3) return false;
    this.dir.multiplyScalar(1 / len);
    return true;
  }

  private spawnWebVisual(): void {
    this.webVisual = new THREE.Group();
    this.webVisual.frustumCulled = false;
    this.webVisual.renderOrder = 9;

    this.webGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x84a8ff,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.webCore = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xf7fbff,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    this.webGlow.renderOrder = 9;
    this.webCore.renderOrder = 10;
    this.webVisual.add(this.webGlow, this.webCore);
    this.scene.add(this.webVisual);
    this.updateWebVisual();
  }

  private updateWebVisual(): void {
    if (!this.webVisual || !this.webCore || !this.webGlow) return;
    const ct = this.player.cauldronBody.translation();
    const startX = ct.x;
    const startY = ct.y + 0.3;
    const dx = this.webAnchor.x - startX;
    const dy = this.webAnchor.y - startY;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);

    this.webVisual.position.set(startX + dx * 0.5, startY + dy * 0.5, PLANE_Z + 0.22);
    this.webVisual.rotation.set(0, 0, angle);
    this.webGlow.scale.set(length, WEB_GLOW_THICKNESS, 1);
    this.webCore.scale.set(length, WEB_CORE_THICKNESS, 1);
  }

  private disposeWebMesh(mesh: THREE.Mesh | null): void {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}
