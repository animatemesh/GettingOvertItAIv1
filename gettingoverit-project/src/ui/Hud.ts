import type { Zone } from '../data/mapData';
import type { HighscoreEntry } from '../data/scoreStore';
import type { GameSettings } from '../data/settingsStore';

export type HudSettingKey =
  | 'hammerSensitivity'
  | 'playerName'
  | 'chestEnabled'
  | 'chestStiffness'
  | 'chestDamping'
  | 'chestGravity'
  | 'chestMass';

export interface HudCallbacks {
  onToggleDebug: () => void;
  onResetRun: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSubmitScore: () => void;
  onSettingChange: (key: HudSettingKey, value: string | boolean) => void;
}

interface HudMenuState {
  open: boolean;
  settings: GameSettings;
  visitCount: number;
  highscores: HighscoreEntry[];
  storageMode: 'local';
  canSubmitScore: boolean;
  scoreSubmitting: boolean;
  scoreMessage: string;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly zoneEl: HTMLDivElement;
  private readonly heightEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly anchorEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly debugButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menuOverlay: HTMLDivElement;
  private readonly callbacks: HudCallbacks;

  private won = false;
  private menuState: HudMenuState;

  constructor(container: HTMLElement, callbacks: HudCallbacks, settings: GameSettings) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'hud';

    this.zoneEl = document.createElement('div');
    this.zoneEl.className = 'hud-zone';

    this.heightEl = document.createElement('div');
    this.heightEl.className = 'hud-height';

    this.timerEl = document.createElement('div');
    this.timerEl.className = 'hud-timer';

    this.anchorEl = document.createElement('div');
    this.anchorEl.className = 'hud-anchor';
    this.anchorEl.textContent = 'ANCHOR';

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-banner';

    this.debugButton = this.makeButton('hud-debug', 'Debug Collisions: Off', 'toggle-debug');
    this.resetButton = this.makeButton('hud-reset', 'Reset Run', 'reset-run');
    this.menuButton = this.makeButton('hud-menu', 'Menu (Esc)', 'toggle-menu');

    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.textContent = 'Move the mouse around the pot to swing and retract the hammer. Push into the ground to launch.';

    this.menuOverlay = document.createElement('div');
    this.menuOverlay.className = 'hud-menu-overlay';

    this.menuState = {
      open: false,
      settings,
      visitCount: 0,
      highscores: [],
      storageMode: 'local',
      canSubmitScore: false,
      scoreSubmitting: false,
      scoreMessage: '',
    };

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);

    this.root.append(
      this.zoneEl,
      this.heightEl,
      this.timerEl,
      this.anchorEl,
      this.bannerEl,
      this.debugButton,
      this.resetButton,
      this.menuButton,
      this.menuOverlay,
      hint,
    );
    container.appendChild(this.root);

    this.renderMenu();
  }

  update(focusY: number, zones: Zone[], anchored: boolean, timerMs: number): void {
    const zone = zones.find((z) => focusY >= z.yRange[0] && focusY < z.yRange[1]);
    this.zoneEl.textContent = zone ? zone.name : '-';
    this.heightEl.textContent = `${focusY.toFixed(1)} m`;
    this.timerEl.textContent = formatTime(timerMs);
    this.anchorEl.classList.toggle('on', anchored);
  }

  showWin(): void {
    if (this.won) return;
    this.won = true;
    this.bannerEl.textContent = 'The Quiet Beyond - you made it.';
    this.bannerEl.classList.add('show');
  }

  resetWin(): void {
    this.won = false;
    this.bannerEl.classList.remove('show');
    this.bannerEl.textContent = '';
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugButton.textContent = `Debug Collisions: ${enabled ? 'On' : 'Off'}`;
    this.debugButton.classList.toggle('on', enabled);
  }

  setMenuOpen(open: boolean): void {
    if (this.menuState.open === open) return;
    this.menuState.open = open;
    this.root.classList.toggle('menu-open', open);
    this.renderMenu();
  }

  setSettings(settings: GameSettings): void {
    this.menuState.settings = settings;
    this.renderMenu();
  }

  setScoreboard(
    visitCount: number,
    highscores: HighscoreEntry[],
    storageMode: 'local',
  ): void {
    this.menuState.visitCount = visitCount;
    this.menuState.highscores = highscores;
    this.menuState.storageMode = storageMode;
    this.renderMenu();
  }

  setPendingScore(canSubmitScore: boolean, message = ''): void {
    this.menuState.canSubmitScore = canSubmitScore;
    this.menuState.scoreMessage = message;
    this.renderMenu();
  }

  setScoreSubmitting(submitting: boolean): void {
    this.menuState.scoreSubmitting = submitting;
    this.renderMenu();
  }

  private makeButton(className: string, text: string, action: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = text;
    return button;
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const action = target?.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;

    switch (action) {
      case 'toggle-debug':
        this.callbacks.onToggleDebug();
        return;
      case 'reset-run':
        this.callbacks.onResetRun();
        return;
      case 'toggle-menu':
        this.callbacks.onToggleMenu();
        return;
      case 'close-menu':
        this.callbacks.onCloseMenu();
        return;
      case 'submit-score':
        this.callbacks.onSubmitScore();
        return;
      default:
        return;
    }
  };

  private onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement | null;
    if (!target?.dataset.setting) return;

    if (target.type === 'range') {
      const valueEl = target.closest('label')?.querySelector('strong');
      if (valueEl) valueEl.textContent = formatSliderValue(target.value, target.step);
    }

    const key = target.dataset.setting as HudSettingKey;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    this.callbacks.onSettingChange(key, value);
  };

  private renderMenu(): void {
    const settings = this.menuState.settings;
    const scores = this.menuState.highscores;
    const storageHint = this.menuState.storageMode === 'local'
      ? 'Scores and visits are currently stored on this device.'
      : 'Shared online leaderboard is connected.';

    this.menuOverlay.innerHTML = `
      <div class="hud-menu-backdrop ${this.menuState.open ? 'is-open' : ''}"></div>
      <section class="hud-menu-panel ${this.menuState.open ? 'is-open' : ''}">
        <div class="hud-menu-header">
          <div>
            <h2>Menu</h2>
            <p>${escapeHtml(storageHint)}</p>
          </div>
          <button type="button" class="hud-menu-close" data-action="close-menu">Close</button>
        </div>

        <div class="hud-menu-grid">
          <section class="hud-menu-card">
            <h3>Run</h3>
            <div class="hud-menu-stat-row">
              <span>Page visits</span>
              <strong>${this.menuState.visitCount}</strong>
            </div>
            <div class="hud-menu-stat-row">
              <span>Leaderboard</span>
              <strong>${scores.length} runs</strong>
            </div>
            <div class="hud-menu-actions">
              <button type="button" class="hud-menu-button hud-menu-button-primary" data-action="reset-run">Reset Run</button>
              <a href="./editor" class="hud-menu-link">Open Editor</a>
            </div>
            ${this.menuState.canSubmitScore ? `
              <div class="hud-score-submit">
                <h4>Submit Winning Time</h4>
                <label class="hud-menu-field">
                  <span>Name</span>
                  <input data-setting="playerName" type="text" maxlength="24" value="${escapeHtml(settings.playerName)}" />
                </label>
                <button
                  type="button"
                  class="hud-menu-button hud-menu-button-accent"
                  data-action="submit-score"
                  ${this.menuState.scoreSubmitting ? 'disabled' : ''}
                >
                  ${this.menuState.scoreSubmitting ? 'Saving...' : 'Save Highscore'}
                </button>
                ${this.menuState.scoreMessage ? `<p class="hud-menu-note">${escapeHtml(this.menuState.scoreMessage)}</p>` : ''}
              </div>
            ` : `
              <label class="hud-menu-field">
                <span>Name</span>
                <input data-setting="playerName" type="text" maxlength="24" value="${escapeHtml(settings.playerName)}" />
              </label>
              ${this.menuState.scoreMessage ? `<p class="hud-menu-note">${escapeHtml(this.menuState.scoreMessage)}</p>` : ''}
            `}
          </section>

          <section class="hud-menu-card">
            <h3>Hammer</h3>
            <label class="hud-menu-field">
              <span>Sensitivity <strong>${settings.hammerSensitivity.toFixed(2)}</strong></span>
              <input
                data-setting="hammerSensitivity"
                type="range"
                min="0.5"
                max="2.8"
                step="0.05"
                value="${settings.hammerSensitivity}"
              />
            </label>
            <p class="hud-menu-note">Higher sensitivity makes the hammer react faster and reach farther with smaller mouse movement.</p>
            <button type="button" class="hud-menu-button" data-action="toggle-debug">Toggle Collision Debug</button>
          </section>

          <section class="hud-menu-card">
            <h3>Chest Physics</h3>
            <label class="hud-menu-check">
              <input data-setting="chestEnabled" type="checkbox" ${settings.chestPhysics.enabled ? 'checked' : ''} />
              <span>Enable chest physics</span>
            </label>
            <label class="hud-menu-field">
              <span>Stiffness <strong>${settings.chestPhysics.stiffness.toFixed(1)}</strong></span>
              <input data-setting="chestStiffness" type="range" min="0" max="220" step="1" value="${settings.chestPhysics.stiffness}" />
            </label>
            <label class="hud-menu-field">
              <span>Damping <strong>${settings.chestPhysics.damping.toFixed(1)}</strong></span>
              <input data-setting="chestDamping" type="range" min="0" max="24" step="0.5" value="${settings.chestPhysics.damping}" />
            </label>
            <label class="hud-menu-field">
              <span>Gravity <strong>${settings.chestPhysics.gravity.toFixed(1)}</strong></span>
              <input data-setting="chestGravity" type="range" min="-8" max="8" step="0.25" value="${settings.chestPhysics.gravity}" />
            </label>
            <label class="hud-menu-field">
              <span>Mass <strong>${settings.chestPhysics.mass.toFixed(2)}</strong></span>
              <input data-setting="chestMass" type="range" min="0.05" max="2.5" step="0.05" value="${settings.chestPhysics.mass}" />
            </label>
          </section>

          <section class="hud-menu-card hud-menu-card-scores">
            <h3>Highscores</h3>
            <div class="hud-score-list">
              ${scores.length ? scores.map((entry, index) => `
                <div class="hud-score-row">
                  <span>${index + 1}. ${escapeHtml(entry.name)}</span>
                  <strong>${formatTime(entry.timeMs)}</strong>
                </div>
              `).join('') : '<p class="hud-menu-note">No winning runs yet.</p>'}
            </div>
          </section>
        </div>
      </section>
    `;
  }
}

function formatTime(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((timeMs % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatSliderValue(value: string, step: string): string {
  const numeric = Number(value);
  const stepValue = Number(step);
  if (!Number.isFinite(numeric)) return value;
  if (!Number.isFinite(stepValue) || stepValue >= 1) return numeric.toFixed(0);
  if (stepValue >= 0.1) return numeric.toFixed(1);
  return numeric.toFixed(2);
}
