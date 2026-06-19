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
import { SlamVfx } from './systems/SlamVfx';
import { AbilityController } from './systems/AbilityController';
import { HAMMERS, HAMMER_ORDER, type HammerId } from './data/hammers';
import { loadProgression, saveProgression, type Progression } from './data/progressionStore';
import { type CommunityMap, incrementPlayCount } from './data/communityMapStore';
import { Hud } from './ui/Hud';
import { CommunityMapsScreen } from './ui/CommunityMapsScreen';

/** Head speed (m/s) at impact that counts as a ground slam. */
const SLAM_SPEED = 3.5;
/** Minimum seconds between two counted slams (debounce). */
const SLAM_COOLDOWN = 0.18;
const HAMMER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
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
  private vfx!: SlamVfx;
  private abilities!: AbilityController;
  private progression: Progression = loadProgression();
  private slams = 0;
  private slamCooldown = 0;
  private preStepHeadSpeed = 0;
  private readonly slamPos = new THREE.Vector3();
  private map!: ClimbMap;
  private settings: GameSettings = loadGameSettings();
  private scoreboard: ScoreboardState = loadLocalScoreboard();
  private running = false;
  private menuOpen = false;
  private shopOpen = false;
  private elapsedMs = 0;
  private finishedTimeMs: number | null = null;
  private scoreSubmittedForRun = false;

  private readonly container: HTMLElement;
  private readonly communityMap: CommunityMap | undefined;
  private communityScreen: CommunityMapsScreen | null = null;

  private readonly focus = new THREE.Vector2();
  private readonly pivot = new THREE.Vector2();

  constructor(container: HTMLElement, communityMap?: CommunityMap) {
    this.container = container;
    this.communityMap = communityMap;
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
      onToggleShop: () => this.setShopOpen(!this.shopOpen),
      onCloseShop: () => this.setShopOpen(false),
      onBuyHammer: (id) => this.buyHammer(id),
      onEquipHammer: (id) => this.equipHammer(id),
      onOpenCommunityMaps: () => this.openCommunityMaps(),
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
    this.map = this.communityMap ? this.communityMap.mapData : loadEditableMap();
    if (this.communityMap) {
      void incrementPlayCount(this.communityMap.id);
      this.hud.setCommunityMapBanner(this.communityMap.title, this.communityMap.authorName);
    }

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

    // Slam VFX + hammer abilities (LMB specials, switched with number keys).
    this.vfx = new SlamVfx(this.engine.scene);
    this.abilities = new AbilityController({
      engine: this.engine,
      world: this.engine.world,
      scene: this.engine.scene,
      camera: this.engine.camera,
      domElement: this.engine.renderer.domElement,
      player: this.player,
      vfx: this.vfx,
      isTerrain: (handle) => level.terrainHandles.has(handle),
      onHammerChange: (kind) => this.hud.setHammer(kind.name, kind.ability),
    });
    this.equipHammer('basic');
    this.syncProgressionHud();

    this.applySettings();
    this.refreshHud();
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    if (!this.running) return;

    if (this.menuOpen || this.shopOpen) {
      this.engine.syncClock();
      this.engine.render();
      requestAnimationFrame(this.frame);
      return;
    }

    const frameDt = this.engine.update({
      beforeStep: (dt) => {
        this.controller.update(dt);
        // Capture the head's approach speed before the step resolves contacts.
        this.preStepHeadSpeed = this.player.headSpeed();
      },
      afterStep: (dt, eventQueue) => {
        this.physics.update(dt, eventQueue);
        this.checkSlam(dt);
      },
    });

    // Visual + camera pass (once per rendered frame).
    this.player.update(frameDt);
    this.vfx.update(frameDt);
    this.abilities.update(frameDt);
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

  /** Award a run slam + permanent coin when the head slams terrain hard. */
  private checkSlam(dt: number): void {
    if (this.slamCooldown > 0) this.slamCooldown -= dt;
    if (!this.physics.impactStarted || this.slamCooldown > 0) return;
    if (this.preStepHeadSpeed < SLAM_SPEED) return;

    this.slams += 1;
    this.progression.coins += 1;
    saveProgression(this.progression);
    this.syncProgressionHud();

    this.player.headWorldPosition(this.slamPos);
    this.vfx.burst(
      this.slamPos.x,
      this.slamPos.y,
      this.slamPos.z,
      this.abilities.currentKind.headColor,
      Math.min(48, 18 + Math.round(this.preStepHeadSpeed * 3)),
      Math.min(11, 3 + this.preStepHeadSpeed * 0.6),
    );
    this.slamCooldown = SLAM_COOLDOWN;
  }

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
    if (this.communityMap) {
      // No highscores on community maps — just celebrate the finish.
      this.hud.setPendingScore(false, 'Community map completed! Highscores are only tracked on the original map.', null);
    } else {
      const prompt =
        this.scoreboard.storageMode === 'remote'
          ? 'Submit your time to the global leaderboard.'
          : 'Submit your time (saved on this device).';
      this.hud.setPendingScore(true, prompt, this.finishedTimeMs);
    }
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
    this.slams = 0;

    this.player.resetTo(this.map.playerStart);
    this.controller.reset();
    this.physics.reset();
    this.abilities.reset();
    this.equipHammer(this.abilities.currentKind.id);
    this.syncProgressionHud();
    this.engine.syncClock();

    this.hud.resetWin();
    this.hud.setPendingScore(false, '', null);
    this.setMenuOpen(false);
    this.setShopOpen(false);

    this.player.getFocus(this.focus);
    this.engine.updateCamera(this.focus.x, this.focus.y, 0);
    this.engine.followLight(this.focus.x, this.focus.y);
    this.refreshHud();
    this.engine.render();
  }

  private setMenuOpen(open: boolean): void {
    if (open) this.setShopOpen(false);
    this.menuOpen = open;
    this.hud.setMenuOpen(open);
    this.engine.syncClock();
  }

  private setShopOpen(open: boolean): void {
    if (open) this.setMenuOpen(false);
    this.shopOpen = open;
    this.hud.setShopOpen(open);
    this.engine.syncClock();
  }

  private openCommunityMaps(): void {
    if (this.communityScreen) return;
    this.setMenuOpen(false);
    this.running = false;
    this.communityScreen = new CommunityMapsScreen(this.container, () => {
      this.communityScreen = null;
      this.running = true;
      this.engine.syncClock();
      requestAnimationFrame(this.frame);
    });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.shopOpen) {
        this.setShopOpen(false);
      } else {
        this.setMenuOpen(!this.menuOpen);
      }
      return;
    }
    if (this.menuOpen || this.shopOpen || !this.abilities) return;
    // Number keys swap owned hammers in shop order.
    const idx = HAMMER_KEYS.indexOf(event.key as (typeof HAMMER_KEYS)[number]);
    if (idx >= 0 && idx < HAMMER_ORDER.length) {
      this.equipHammer(HAMMER_ORDER[idx]);
    }
  };

  private buyHammer(id: HammerId): void {
    if (this.progression.owned.includes(id)) {
      this.equipHammer(id);
      return;
    }

    const hammer = HAMMERS[id];
    if (!hammer || hammer.price > this.progression.coins) return;

    this.progression.coins -= hammer.price;
    this.progression.owned = [...new Set([...this.progression.owned, id])]
      .sort((a, b) => HAMMER_ORDER.indexOf(a) - HAMMER_ORDER.indexOf(b));
    saveProgression(this.progression);

    this.equipHammer(id);
    this.syncProgressionHud();
  }

  private equipHammer(id: HammerId): void {
    if (!this.abilities || !this.progression.owned.includes(id)) return;
    this.abilities.setHammer(id);
    this.syncProgressionHud();
  }

  private syncProgressionHud(): void {
    this.hud.setSlams(this.slams);
    this.hud.setCoins(this.progression.coins);
    this.hud.setShopState(
      this.progression.coins,
      [...this.progression.owned],
      this.abilities?.currentKind.id ?? 'basic',
    );
  }

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
    this.abilities?.dispose();
    this.vfx?.dispose();
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
