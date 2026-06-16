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
import type { ClimbMap } from './data/mapData';
import { loadEditableMap } from './data/mapStore';
import {
  loadLocalScoreboard,
  registerVisit,
  submitHighscore,
  type ScoreboardState,
} from './data/scoreStore';
import {
  cloneDefaultChestPhysicsSettings,
  loadGameSettings,
  saveGameSettings,
  type ChestPhysicsSettings,
  type GameSettings,
} from './data/settingsStore';
import type { HudSettingKey } from './ui/Hud';

export class Game {
  private readonly engine: Engine;
  private readonly hud: Hud;
  private player!: Player;
  private controller!: HammerController;
  private physics!: PhysicsManager;
  private map!: ClimbMap;
  private settings: GameSettings = loadGameSettings();
  private scoreboard: ScoreboardState = loadLocalScoreboard();
  private running = false;
  private menuOpen = false;
  private elapsedMs = 0;
  private finishedTimeMs: number | null = null;
  private scoreSubmittedForRun = false;

  private readonly focus = new THREE.Vector2();
  private readonly pivot = new THREE.Vector2();

  constructor(container: HTMLElement) {
    this.engine = new Engine(container);
    this.hud = new Hud(container, {
      onToggleDebug: () => {
        const enabled = this.engine.toggleDebugRender();
        this.hud.setDebugEnabled(enabled);
      },
      onResetRun: () => this.resetRun(),
      onResetChestPhysics: () => this.resetChestPhysics(),
      onToggleMenu: () => this.setMenuOpen(!this.menuOpen),
      onCloseMenu: () => this.setMenuOpen(false),
      onSubmitScore: () => this.submitCurrentScore(),
      onSettingChange: (key, value) => this.updateSetting(key, value),
    }, this.settings);
    this.hud.setScoreboard(
      this.scoreboard.visitCount,
      this.scoreboard.highscores,
      this.scoreboard.storageMode,
    );
    window.addEventListener('keydown', this.onKeyDown);
    void this.initScoreboard();
  }

  /** Count this visit and pull the live scoreboard (async; updates the HUD). */
  private async initScoreboard(): Promise<void> {
    this.scoreboard = await registerVisit();
    this.hud.setScoreboard(
      this.scoreboard.visitCount,
      this.scoreboard.highscores,
      this.scoreboard.storageMode,
    );
  }

  async start(): Promise<void> {
    await this.engine.initPhysics();
    this.map = loadEditableMap();

    // Build the level (colliders + meshes) and collect terrain handles.
    const level = new LevelBuilder(this.engine.scene, this.engine.world).build(this.map);

    // Spawn the player at the authored start.
    this.player = new Player(this.engine.scene, this.engine.world, this.map.playerStart);
    this.engine.registerPlaneLock(this.player.cauldronBody);
    this.engine.registerPlaneLock(this.player.hammerBody);

    // Load the BristiSpirs character (async) before the loop starts.
    await this.player.loadCharacter();

    // Hammer steering (mouse -> PD force at the head).
    this.controller = new HammerController({
      camera: this.engine.camera,
      domElement: this.engine.renderer.domElement,
      hammerBody: this.player.hammerBody,
      cauldronBody: this.player.cauldronBody,
      headLocalOffset: this.player.headLocalOffset,
      getPivot: () => this.player.getGripPivot(this.pivot),
      getReach: () => this.player.hammerReach,
      setReach: (reach) => this.player.setHammerReach(reach),
      canOverdrive: () => this.physics?.touchingTerrain ?? false,
    });

    // Leverage translation (anchored head -> counter-impulse on the cauldron).
    this.physics = new PhysicsManager({
      world: this.engine.world,
      cauldronBody: this.player.cauldronBody,
      headCollider: this.player.headCollider,
      controller: this.controller,
      isTerrain: (handle) => level.terrainHandles.has(handle),
    });

    this.applySettings();
    this.refreshHud();
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    if (!this.running) return;

    if (this.menuOpen) {
      this.engine.syncClock();
      this.engine.render();
      requestAnimationFrame(this.frame);
      return;
    }

    const frameDt = this.engine.update({
      beforeStep: (dt) => this.controller.update(dt),
      afterStep: (dt, eventQueue) => this.physics.update(dt, eventQueue),
    });

    // Visual + camera pass (once per rendered frame).
    this.player.update(frameDt);
    if (this.finishedTimeMs == null) {
      this.elapsedMs += frameDt * 1000;
    }

    this.player.getFocus(this.focus);
    this.engine.updateCamera(this.focus.x, this.focus.y, frameDt);
    this.engine.followLight(this.focus.x, this.focus.y);

    this.refreshHud();
    if (this.finishedTimeMs == null && this.player.isAt(this.map.winCondition.triggerArea)) {
      this.finishRun();
    }

    this.engine.render();
    requestAnimationFrame(this.frame);
  };

  private refreshHud(): void {
    this.hud.update(
      this.focus.y,
      this.map.zones,
      this.physics?.anchored ?? false,
      this.finishedTimeMs ?? this.elapsedMs,
    );
  }

  private finishRun(): void {
    this.finishedTimeMs = this.elapsedMs;
    this.hud.showWin();
    const prompt =
      this.scoreboard.storageMode === 'remote'
        ? 'Submit your time to the global leaderboard.'
        : 'Submit your time (saved on this device).';
    this.hud.setPendingScore(true, prompt, this.finishedTimeMs);
    this.setMenuOpen(true);
  }

  private async submitCurrentScore(): Promise<void> {
    if (this.finishedTimeMs == null || this.scoreSubmittedForRun) return;

    this.hud.setScoreSubmitting(true);
    try {
      this.scoreboard = await submitHighscore(this.settings.playerName, this.finishedTimeMs);
      this.scoreSubmittedForRun = true;
      this.hud.setScoreboard(
        this.scoreboard.visitCount,
        this.scoreboard.highscores,
        this.scoreboard.storageMode,
      );
      const msg =
        this.scoreboard.storageMode === 'remote'
          ? 'Run saved to the online leaderboard.'
          : 'Saved on this device (online leaderboard not reachable).';
      this.hud.setPendingScore(false, msg, null);
    } finally {
      this.hud.setScoreSubmitting(false);
    }
  }

  private resetRun(): void {
    if (!this.player || !this.controller || !this.physics) return;

    this.elapsedMs = 0;
    this.finishedTimeMs = null;
    this.scoreSubmittedForRun = false;

    this.player.resetTo(this.map.playerStart);
    this.controller.reset();
    this.physics.reset();
    this.engine.syncClock();

    this.hud.resetWin();
    this.hud.setPendingScore(false, '', null);
    this.setMenuOpen(false);

    this.player.getFocus(this.focus);
    this.engine.updateCamera(this.focus.x, this.focus.y, 0);
    this.engine.followLight(this.focus.x, this.focus.y);
    this.refreshHud();
    this.engine.render();
  }

  private setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.hud.setMenuOpen(open);
    this.engine.syncClock();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.setMenuOpen(!this.menuOpen);
  };

  private updateSetting(key: HudSettingKey, value: string | boolean): void {
    switch (key) {
      case 'hammerSensitivity':
        this.settings.hammerSensitivity = clampNumber(value, this.settings.hammerSensitivity, 0.5, 2.8);
        break;
      case 'playerName':
        this.settings.playerName = String(value).slice(0, 24);
        saveGameSettings(this.settings);
        return;
      case 'chestEnabled':
        this.settings.chestPhysics.enabled = Boolean(value);
        break;
      case 'chestStiffness':
        this.settings.chestPhysics.stiffness = clampNumber(value, this.settings.chestPhysics.stiffness, 0, 220);
        break;
      case 'chestDamping':
        this.settings.chestPhysics.damping = clampNumber(value, this.settings.chestPhysics.damping, 0, 24);
        break;
      case 'chestGravity':
        this.settings.chestPhysics.gravity = clampNumber(value, this.settings.chestPhysics.gravity, -8, 8);
        break;
      case 'chestMass':
        this.settings.chestPhysics.mass = clampNumber(value, this.settings.chestPhysics.mass, 0.05, 2.5);
        break;
      default:
        return;
    }

    this.applySettings();
  }

  private resetChestPhysics(): void {
    this.settings.chestPhysics = cloneDefaultChestPhysicsSettings();
    this.applySettings();
    this.hud.setSettings(this.settings);
  }

  private applySettings(): void {
    saveGameSettings(this.settings);
    this.controller?.setSensitivity(this.settings.hammerSensitivity);
    this.player?.applyChestSettings(this.settings.chestPhysics as ChestPhysicsSettings);
  }

  stop(): void {
    this.running = false;
    window.removeEventListener('keydown', this.onKeyDown);
    this.controller?.dispose();
    this.player?.dispose();
    this.engine.dispose();
  }
}

function clampNumber(value: string | boolean, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}
