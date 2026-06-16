/**
 * Game.ts
 * -----------------------------------------------------------------------------
 * Top-level orchestrator. Wires the engine, level, player, hammer controller
 * and leverage manager into a single deterministic fixed-step loop:
 *
 *   per substep:  beforeStep -> controller.update()  (apply PD steering force)
 *                 world.step + plane-lock
 *                 afterStep  -> physicsManager.update() (leverage -> cauldron)
 *   per frame:    player.update() (sync visuals + solve IK)
 *                 camera + light follow, HUD, render
 */

import * as THREE from 'three';
import { Engine } from './core/Engine';
import { LevelBuilder } from './world/LevelBuilder';
import { Player } from './entities/Player';
import { HammerController } from './systems/HammerController';
import { PhysicsManager } from './systems/PhysicsManager';
import { Hud } from './ui/Hud';
import { CLIMB_OF_PATIENCE } from './data/mapData';

export class Game {
  private readonly engine: Engine;
  private readonly hud: Hud;
  private player!: Player;
  private controller!: HammerController;
  private physics!: PhysicsManager;
  private running = false;

  private readonly focus = new THREE.Vector2();
  private readonly pivot = new THREE.Vector2();

  constructor(container: HTMLElement) {
    this.engine = new Engine(container);
    this.hud = new Hud(container);
  }

  async start(): Promise<void> {
    await this.engine.initPhysics();

    // Build the level (colliders + meshes) and collect terrain handles.
    const level = new LevelBuilder(this.engine.scene, this.engine.world).build(CLIMB_OF_PATIENCE);

    // Spawn the player at the authored start.
    this.player = new Player(this.engine.scene, this.engine.world, CLIMB_OF_PATIENCE.playerStart);
    this.engine.registerPlaneLock(this.player.cauldronBody);
    this.engine.registerPlaneLock(this.player.hammerBody);

    // Load the BristiSpirs character (async) before the loop starts.
    await this.player.loadCharacter();

    // Hammer steering (mouse -> PD force at the head).
    this.controller = new HammerController({
      camera: this.engine.camera,
      domElement: this.engine.renderer.domElement,
      hammerBody: this.player.hammerBody,
      headLocalOffset: this.player.headLocalOffset,
      getPivot: () => this.player.getGripPivot(this.pivot),
    });

    // Leverage translation (anchored head -> counter-impulse on the cauldron).
    this.physics = new PhysicsManager({
      world: this.engine.world,
      cauldronBody: this.player.cauldronBody,
      headCollider: this.player.headCollider,
      controller: this.controller,
      isTerrain: (handle) => level.terrainHandles.has(handle),
    });

    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    if (!this.running) return;

    const frameDt = this.engine.update({
      beforeStep: () => this.controller.update(),
      afterStep: (dt, eventQueue) => this.physics.update(dt, eventQueue),
    });

    // Visual + camera pass (once per rendered frame).
    this.player.update(frameDt);

    this.player.getFocus(this.focus);
    this.engine.updateCamera(this.focus.x, this.focus.y, frameDt);
    this.engine.followLight(this.focus.x, this.focus.y);

    this.hud.update(this.focus.y, CLIMB_OF_PATIENCE.zones, this.physics.anchored);
    if (this.player.isAt(CLIMB_OF_PATIENCE.winCondition.triggerArea)) {
      this.hud.showWin();
    }

    this.engine.render();
    requestAnimationFrame(this.frame);
  };

  stop(): void {
    this.running = false;
    this.controller?.dispose();
    this.player?.dispose();
    this.engine.dispose();
  }
}
