/**
 * core/Engine.ts  —  FILE 1: Central Engine Bootstrap & 2D-Locked Plane
 * -----------------------------------------------------------------------------
 * Responsibilities:
 *   - Configure the Three.js WebGLRenderer, Scene, atmosphere (fog + tone
 *     mapping / colour grading) and a Perspective camera that soft-follows the
 *     player's cauldron.
 *   - Initialise the Rapier3D physics engine with gravity y = -9.81.
 *   - Drive a deterministic fixed-timestep accumulator loop.
 *   - Provide the strict 2D-lock wrapper: every registered rigid body has its
 *     z position, z linear velocity, and x/y angular velocity zeroed every
 *     substep so the simulation stays perfectly on the gameplay plane.
 *
 * Bodies should additionally be created with Rapier axis locks
 * (enabledTranslations(true,true,false) / enabledRotations(false,false,true)),
 * but this wrapper guarantees the plane invariant even if a joint or large
 * impulse nudges a body off-plane.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  GRAVITY,
  FIXED_DT,
  MAX_SUBSTEPS,
  PLANE_Z,
  CAMERA,
  ATMOSPHERE,
} from '../data/config';

export interface StepHooks {
  /** Called immediately before each physics substep (apply control forces). */
  beforeStep: (dt: number) => void;
  /** Called immediately after each substep + plane-lock (read contacts). */
  afterStep: (dt: number, eventQueue: RAPIER.EventQueue) => void;
}

export class Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly container: HTMLElement;

  /** Assigned by initPhysics(); valid for the entire lifetime afterwards. */
  world!: RAPIER.World;
  eventQueue!: RAPIER.EventQueue;

  private readonly clock = new THREE.Clock();
  private accumulator = 0;

  /** Bodies whose plane invariant is enforced every substep. */
  private readonly planeLockedBodies: RAPIER.RigidBody[] = [];

  /** Smoothed camera focus point (the cauldron position, with look-ahead). */
  private readonly camFocus = new THREE.Vector3(0, CAMERA.lookAheadY, 0);
  private readonly fogColorLow = new THREE.Color(ATMOSPHERE.skyLow);
  private readonly fogColorHigh = new THREE.Color(ATMOSPHERE.skyHigh);
  private readonly bgColor = new THREE.Color(ATMOSPHERE.skyLow);
  private debugEnabled = false;
  private debugLines: THREE.LineSegments | null = null;
  private readonly debugPositions = new Float32Array(0);
  private readonly debugColors = new Float32Array(0);

  constructor(container: HTMLElement) {
    this.container = container;

    // --- Renderer --------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Colour grading / tone mapping pass (cheap, no EffectComposer needed).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // --- Scene + atmosphere ---------------------------------------------
    this.scene = new THREE.Scene();
    // Clean, calm vertical gradient sky (no busy artwork).
    this.scene.background = this.makeSkyTexture();
    this.scene.fog = new THREE.Fog(this.bgColor.getHex(), ATMOSPHERE.fogNear, ATMOSPHERE.fogFar);

    // --- Camera ----------------------------------------------------------
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, CAMERA.lookAheadY, CAMERA.distance);
    this.camera.lookAt(0, CAMERA.lookAheadY, 0);

    this.setupLighting();

    window.addEventListener('resize', this.onResize);
  }

  /** Initialise the Rapier WASM module and create the world. Must be awaited. */
  async initPhysics(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World(GRAVITY);
    // Tighter solver for stable leverage maths under heavy mass ratios.
    this.world.numSolverIterations = 8;
    // Drain collision events so the PhysicsManager can detect anchor contacts.
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /** Register a body so the 2D-lock wrapper keeps it on the plane each substep. */
  registerPlaneLock(body: RAPIER.RigidBody): void {
    this.planeLockedBodies.push(body);
  }

  /**
   * Advance the simulation by real frame time using a fixed-step accumulator.
   * Ordering per substep: beforeStep (forces) -> world.step -> plane-lock ->
   * afterStep (contact reading). Returns the seconds of wall time consumed.
   */
  update(hooks: StepHooks): number {
    const frameDt = Math.min(this.clock.getDelta(), 0.1);
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      hooks.beforeStep(FIXED_DT);
      this.world.step(this.eventQueue);
      this.enforcePlaneLock();
      hooks.afterStep(FIXED_DT, this.eventQueue);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    // If we hit the substep ceiling the tab stalled; drop the backlog so the
    // simulation does not spiral into an ever-growing catch-up.
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0;

    return frameDt;
  }

  /**
   * Strict 2D constraint: pin z position to the plane, kill z linear velocity,
   * and kill the x/y angular velocity so bodies only spin in-plane (around z).
   */
  private enforcePlaneLock(): void {
    for (let i = 0; i < this.planeLockedBodies.length; i++) {
      const body = this.planeLockedBodies[i];

      const t = body.translation();
      if (t.z !== PLANE_Z) {
        body.setTranslation({ x: t.x, y: t.y, z: PLANE_Z }, false);
      }

      const v = body.linvel();
      if (v.z !== 0) {
        body.setLinvel({ x: v.x, y: v.y, z: 0 }, false);
      }

      const w = body.angvel();
      if (w.x !== 0 || w.y !== 0) {
        body.setAngvel({ x: 0, y: 0, z: w.z }, false);
      }
    }
  }

  /** Exponentially soft-follow the cauldron with a vertical look-ahead lead. */
  updateCamera(focusX: number, focusY: number, dt: number): void {
    const desiredX = focusX;
    const desiredY = focusY + CAMERA.lookAheadY;

    // Frame-rate independent smoothing: lerp factor = 1 - e^(-lambda*dt).
    const alpha = 1 - Math.exp(-CAMERA.followLambda * dt);
    this.camFocus.x += (desiredX - this.camFocus.x) * alpha;
    this.camFocus.y += (desiredY - this.camFocus.y) * alpha;

    this.camera.position.set(this.camFocus.x, this.camFocus.y, CAMERA.distance);
    this.camera.lookAt(this.camFocus.x, this.camFocus.y - CAMERA.lookAheadY * 0.4, PLANE_Z);

    this.updateAtmosphere(focusY);
  }

  /** Grade the fog/background from dirty-industrial (low) to cold-quiet (high). */
  private updateAtmosphere(focusY: number): void {
    const t = THREE.MathUtils.clamp(focusY / 180, 0, 1);
    this.bgColor.copy(this.fogColorLow).lerp(this.fogColorHigh, t);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.bgColor);
  }

  render(): void {
    this.updateDebugOverlay();
    this.renderer.render(this.scene, this.camera);
  }

  syncClock(): void {
    this.clock.getDelta();
    this.accumulator = 0;
  }

  toggleDebugRender(): boolean {
    this.debugEnabled = !this.debugEnabled;
    if (!this.debugEnabled) this.hideDebugOverlay();
    return this.debugEnabled;
  }

  private updateDebugOverlay(): void {
    if (!this.debugEnabled || !this.world) return;

    const buffers = this.world.debugRender();
    const lines = this.ensureDebugLines();
    const geometry = lines.geometry as THREE.BufferGeometry;

    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
    geometry.computeBoundingSphere();
  }

  private ensureDebugLines(): THREE.LineSegments {
    if (this.debugLines) return this.debugLines;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.debugPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.debugColors, 4));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    this.debugLines = new THREE.LineSegments(geometry, material);
    this.debugLines.frustumCulled = false;
    this.debugLines.renderOrder = 999;
    this.scene.add(this.debugLines);
    return this.debugLines;
  }

  private hideDebugOverlay(): void {
    if (!this.debugLines) return;
    this.scene.remove(this.debugLines);
    this.debugLines.geometry.dispose();
    (this.debugLines.material as THREE.Material).dispose();
    this.debugLines = null;
  }

  /** A soft static vertical gradient used as the sky background. */
  private makeSkyTexture(): THREE.Texture {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 256;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, '#aacbe0'); // top: soft blue
    g.addColorStop(0.55, '#cfe2e8');
    g.addColorStop(1.0, '#e8ecd6'); // bottom: pale warm haze
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private setupLighting(): void {
    // Sky-blue from above, warm green earth bounce from below (forest light).
    const hemi = new THREE.HemisphereLight(0xcfe8f5, 0x4a5a32, 0.95);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1dd, 1.25);
    key.position.set(6, 14, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    const s = 24;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    this.scene.add(key.target); // required for key.target.position to take effect
    // Keep the key light following the action so high zones stay lit.
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x88aacc, 0.4);
    rim.position.set(-8, 6, -6);
    this.scene.add(rim);
  }

  private keyLight?: THREE.DirectionalLight;

  /** Re-aim the shadow-casting key light at the player as they climb. */
  followLight(focusX: number, focusY: number): void {
    if (!this.keyLight) return;
    this.keyLight.position.set(focusX + 6, focusY + 14, 10);
    this.keyLight.target.position.set(focusX, focusY, 0);
    this.keyLight.target.updateMatrixWorld();
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.hideDebugOverlay();
    this.renderer.dispose();
  }
}
