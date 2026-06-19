import type { Zone } from '../data/mapData';
import type { HighscoreEntry } from '../data/scoreStore';
import type { GameSettings } from '../data/settingsStore';
import { HAMMERS, HAMMER_ORDER, type HammerId } from '../data/hammers';
import { canUseMapEditor } from '../utils/editorAccess';

export type HudSettingKey =
  | 'hammerSensitivity'
  | 'gamepadSensitivity'
  | 'playerName'
  | 'chestEnabled'
  | 'chestStiffness'
  | 'chestDamping'
  | 'chestGravity'
  | 'chestMass';

export interface HudCallbacks {
  onToggleDebug: () => void;
  onResetRun: () => void;
  onResetChestPhysics: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSubmitScore: () => void;
  onSettingChange: (key: HudSettingKey, value: string | boolean) => void;
  onToggleShop: () => void;
  onCloseShop: () => void;
  onBuyHammer: (id: HammerId) => void;
  onEquipHammer: (id: HammerId) => void;
  onOpenCommunityMaps: () => void;
}

interface ShopState {
  open: boolean;
  coins: number;
  owned: HammerId[];
  current: HammerId;
}

interface HudMenuState {
  open: boolean;
  settings: GameSettings;
  visitCount: number;
  highscores: HighscoreEntry[];
  storageMode: 'local' | 'remote';
  pendingScoreTimeMs: number | null;
  canSubmitScore: boolean;
  scoreSubmitting: boolean;
  scoreMessage: string;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly zoneEl: HTMLDivElement;
  private readonly heightEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly slamsEl: HTMLDivElement;
  private readonly coinsEl: HTMLDivElement;
  private readonly hammerEl: HTMLDivElement;
  private readonly anchorEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly debugButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly shopButton: HTMLButtonElement;
  private readonly creditLink: HTMLAnchorElement;
  private readonly menuOverlay: HTMLDivElement;
  private readonly shopOverlay: HTMLDivElement;
  private readonly callbacks: HudCallbacks;

  private won = false;
  private menuState: HudMenuState;
  private shopState: ShopState = { open: false, coins: 0, owned: ['basic'], current: 'basic' };

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

    this.slamsEl = document.createElement('div');
    this.slamsEl.className = 'hud-slams';
    this.slamsEl.textContent = 'Slams: 0';

    this.coinsEl = document.createElement('div');
    this.coinsEl.className = 'hud-coins';
    this.coinsEl.textContent = 'Coins: 0';

    this.hammerEl = document.createElement('div');
    this.hammerEl.className = 'hud-hammer';

    this.anchorEl = document.createElement('div');
    this.anchorEl.className = 'hud-anchor';
    this.anchorEl.textContent = 'ANCHOR';

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-banner';

    this.debugButton = this.makeButton('hud-debug', 'Debug Collisions: Off', 'toggle-debug');
    this.resetButton = this.makeButton('hud-reset', 'Reset Run', 'reset-run');
    this.menuButton = this.makeButton('hud-menu', 'Menu (Esc)', 'toggle-menu');
    this.shopButton = this.makeButton('hud-shop', 'Shop', 'toggle-shop');
    this.creditLink = document.createElement('a');
    this.creditLink.className = 'hud-credit';
    this.creditLink.href = 'https://www.youtube.com/@DevManAI';
    this.creditLink.target = '_blank';
    this.creditLink.rel = 'noreferrer';
    this.creditLink.textContent = 'Game Made By DevManAI';

    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.textContent = `Move the mouse to swing the hammer. Hard slams earn coins. Keys 1-${HAMMER_ORDER.length} equip owned hammers; LMB uses the special.`;

    this.menuOverlay = document.createElement('div');
    this.menuOverlay.className = 'hud-menu-overlay';

    this.shopOverlay = document.createElement('div');
    this.shopOverlay.className = 'hud-menu-overlay hud-shop-overlay';

    this.menuState = {
      open: false,
      settings,
      visitCount: 0,
      highscores: [],
      storageMode: 'local',
      pendingScoreTimeMs: null,
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
      this.slamsEl,
      this.coinsEl,
      this.hammerEl,
      this.anchorEl,
      this.bannerEl,
      this.debugButton,
      this.resetButton,
      this.menuButton,
      this.shopButton,
      this.creditLink,
      this.menuOverlay,
      this.shopOverlay,
      hint,
    );
    container.appendChild(this.root);

    this.renderMenu();
    this.renderShop();
  }

  update(focusY: number, zones: Zone[], anchored: boolean, timerMs: number): void {
    const zone = zones.find((z) => focusY >= z.yRange[0] && focusY < z.yRange[1]);
    this.zoneEl.textContent = zone ? zone.name : '-';
    this.heightEl.textContent = `${focusY.toFixed(1)} m`;
    this.timerEl.textContent = formatTime(timerMs);
    this.anchorEl.classList.toggle('on', anchored);
  }

  setSlams(slams: number): void {
    this.slamsEl.textContent = `Slams: ${slams}`;
  }

  setCoins(coins: number): void {
    this.coinsEl.textContent = `Coins: ${coins}`;
    this.shopState.coins = coins;
    if (this.shopState.open) this.renderShop();
  }

  setHammer(name: string, ability: string): void {
    this.hammerEl.innerHTML =
      `<span class="hud-hammer-name">${escapeHtml(name)}</span>` +
      `<span class="hud-hammer-ability">${escapeHtml(ability)}</span>`;
  }

  setShopState(coins: number, owned: HammerId[], current: HammerId): void {
    this.shopState.coins = coins;
    this.shopState.owned = owned;
    this.shopState.current = current;
    this.coinsEl.textContent = `Coins: ${coins}`;
    this.renderShop();
  }

  setShopOpen(open: boolean): void {
    if (this.shopState.open === open) return;
    this.shopState.open = open;
    this.root.classList.toggle('shop-open', open);
    this.renderShop();
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
    storageMode: 'local' | 'remote',
  ): void {
    this.menuState.visitCount = visitCount;
    this.menuState.highscores = highscores;
    this.menuState.storageMode = storageMode;
    this.renderMenu();
  }

  setPendingScore(canSubmitScore: boolean, message = '', timeMs: number | null = null): void {
    this.menuState.canSubmitScore = canSubmitScore;
    this.menuState.scoreMessage = message;
    this.menuState.pendingScoreTimeMs = timeMs;
    this.renderMenu();
  }

  setScoreSubmitting(submitting: boolean): void {
    this.menuState.scoreSubmitting = submitting;
    this.renderMenu();
  }

  setCommunityMapBanner(title: string, author: string): void {
    const bar = document.createElement('div');
    bar.className = 'hud-community-bar';
    bar.innerHTML = `
      <span>Playing: <strong>${escapeHtml(title)}</strong> by ${escapeHtml(author)}</span>
      <button type="button" class="hud-community-back" data-action="return-original">Return to Original Map</button>
    `;
    bar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-action="return-original"]')) {
        window.location.reload();
      }
    });
    this.root.appendChild(bar);
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
    const hammerId = target?.closest<HTMLElement>('[data-hammer-id]')?.dataset.hammerId as HammerId | undefined;
    if (!action) return;

    switch (action) {
      case 'toggle-debug':
        this.callbacks.onToggleDebug();
        return;
      case 'reset-run':
        this.callbacks.onResetRun();
        return;
      case 'reset-chest-physics':
        this.callbacks.onResetChestPhysics();
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
      case 'open-community-maps':
        this.callbacks.onOpenCommunityMaps();
        return;
      case 'toggle-shop':
        this.callbacks.onToggleShop();
        return;
      case 'close-shop':
        this.callbacks.onCloseShop();
        return;
      case 'buy-hammer':
        if (hammerId) this.callbacks.onBuyHammer(hammerId);
        return;
      case 'equip-hammer':
        if (hammerId) this.callbacks.onEquipHammer(hammerId);
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
    const editorEnabled = canUseMapEditor();
    const storageHint = this.menuState.storageMode === 'local'
      ? 'This build stores scores locally. GitHub Pages can serve static files, but it cannot accept score writes by itself.'
      : 'Shared online leaderboard is connected.';

    this.menuOverlay.innerHTML = `
      <div
        class="hud-menu-backdrop ${this.menuState.open ? 'is-open' : ''}"
        data-action="close-menu"
      ></div>
      <section class="hud-menu-panel ${this.menuState.open ? 'is-open' : ''}">
        ${this.menuState.canSubmitScore ? `
          <section class="hud-finish-card">
            <p class="hud-finish-eyebrow">Congrats</p>
            <h2>You reached the flag.</h2>
            <p class="hud-finish-time">${formatTime(this.menuState.pendingScoreTimeMs ?? 0)}</p>
            <p class="hud-menu-note">Enter your name to add this run to the highscores on this device.</p>
            <label class="hud-menu-field">
              <span>Name</span>
              <input data-setting="playerName" type="text" maxlength="24" value="${escapeHtml(settings.playerName)}" />
            </label>
            <div class="hud-menu-actions">
              <button
                type="button"
                class="hud-menu-button hud-menu-button-accent"
                data-action="submit-score"
                ${this.menuState.scoreSubmitting ? 'disabled' : ''}
              >
                ${this.menuState.scoreSubmitting ? 'Saving...' : 'Save To Highscores'}
              </button>
              <button type="button" class="hud-menu-button" data-action="reset-run">Start New Run</button>
            </div>
            ${this.menuState.scoreMessage ? `<p class="hud-menu-note">${escapeHtml(this.menuState.scoreMessage)}</p>` : ''}
          </section>
        ` : ''}
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
              <button type="button" class="hud-menu-button" data-action="open-community-maps">Community Maps</button>
              ${editorEnabled ? '<a href="./editor" class="hud-menu-link">Open Editor</a>' : ''}
            </div>
            <label class="hud-menu-field">
              <span>Name</span>
              <input data-setting="playerName" type="text" maxlength="24" value="${escapeHtml(settings.playerName)}" />
            </label>
            ${this.menuState.scoreMessage && !this.menuState.canSubmitScore ? `<p class="hud-menu-note">${escapeHtml(this.menuState.scoreMessage)}</p>` : ''}
          </section>

          <section class="hud-menu-card">
            <h3>Hammer</h3>
            <label class="hud-menu-field">
              <span>Mouse Sensitivity <strong>${settings.hammerSensitivity.toFixed(2)}</strong></span>
              <input
                data-setting="hammerSensitivity"
                type="range"
                min="0.5"
                max="2.8"
                step="0.05"
                value="${settings.hammerSensitivity}"
              />
            </label>
            <label class="hud-menu-field">
              <span>Gamepad Sensitivity <strong>${settings.gamepadSensitivity.toFixed(0)}</strong></span>
              <input
                data-setting="gamepadSensitivity"
                type="range"
                min="100"
                max="200"
                step="1"
                value="${settings.gamepadSensitivity}"
              />
            </label>
            <p class="hud-menu-note">Gamepad sensitivity controls how fast the aim cursor moves with the left stick.</p>
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
            <button type="button" class="hud-menu-button" data-action="reset-chest-physics">Reset Chest Physics</button>
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

  private renderShop(): void {
    const cards = HAMMER_ORDER.map((id, index) => {
      const hammer = HAMMERS[id];
      const owned = this.shopState.owned.includes(id);
      const equipped = this.shopState.current === id;
      const affordable = this.shopState.coins >= hammer.price;
      const action = owned ? 'equip-hammer' : 'buy-hammer';
      const actionText = equipped ? 'Equipped' : owned ? 'Equip' : `Buy (${hammer.price})`;
      const disabled = equipped || (!owned && !affordable);

      return `
        <article class="hud-shop-card ${owned ? 'is-owned' : 'is-locked'} ${equipped ? 'is-equipped' : ''}">
          <div class="hud-shop-card-head">
            <div>
              <p class="hud-shop-slot">Slot ${index + 1}</p>
              <h3>${escapeHtml(hammer.name)}</h3>
            </div>
            <span class="hud-shop-price">${hammer.price === 0 ? 'Free' : `${hammer.price} coins`}</span>
          </div>
          <p class="hud-shop-ability">${escapeHtml(hammer.ability)}</p>
          <div class="hud-shop-meta">
            <span>${hammer.cooldownSec > 0 ? `${hammer.cooldownSec.toFixed(1)}s cooldown` : 'No cooldown'}</span>
            <span>${owned ? 'Owned' : affordable ? 'Affordable' : 'Locked'}</span>
          </div>
          <button
            type="button"
            class="hud-menu-button ${owned ? 'hud-shop-equip' : 'hud-shop-buy'}"
            data-action="${action}"
            data-hammer-id="${hammer.id}"
            ${disabled ? 'disabled' : ''}
          >
            ${actionText}
          </button>
        </article>
      `;
    }).join('');

    this.shopOverlay.innerHTML = `
      <div
        class="hud-menu-backdrop ${this.shopState.open ? 'is-open' : ''}"
        data-action="close-shop"
      ></div>
      <section class="hud-shop-panel ${this.shopState.open ? 'is-open' : ''}">
        <div class="hud-shop-header">
          <div>
            <p class="hud-shop-eyebrow">Progression</p>
            <h2>Hammer Shop</h2>
            <p>Every hard slam earns 1 coin. Buy hammers here, then switch between owned ones with keys 1-${HAMMER_ORDER.length}.</p>
          </div>
          <button type="button" class="hud-menu-close" data-action="close-shop">Close</button>
        </div>
        <div class="hud-shop-wallet">
          <strong>${this.shopState.coins}</strong>
          <span>coins available</span>
        </div>
        <div class="hud-shop-grid">${cards}</div>
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
