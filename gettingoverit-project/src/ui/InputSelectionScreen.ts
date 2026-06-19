export type InputMode = 'mouse' | 'gamepad';

export class InputSelectionScreen {
  private readonly root: HTMLDivElement;
  private resolved = false;

  constructor(container: HTMLElement, onSelect: (mode: InputMode) => void) {
    this.root = document.createElement('div');
    this.root.className = 'isel-screen';
    this.root.innerHTML = this.html();
    container.appendChild(this.root);

    // Animate in after paint.
    requestAnimationFrame(() => this.root.classList.add('isel-visible'));

    const pick = (mode: InputMode) => {
      if (this.resolved) return;
      this.resolved = true;
      this.root.classList.remove('isel-visible');
      this.root.classList.add('isel-hiding');
      setTimeout(() => {
        this.root.remove();
        onSelect(mode);
      }, 280);
    };

    this.root.querySelector('[data-mode="mouse"]')?.addEventListener('click', () => pick('mouse'));
    this.root.querySelector('[data-mode="gamepad"]')?.addEventListener('click', () => pick('gamepad'));

    // If a gamepad connects while the screen is open, highlight the card.
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    // Check already-connected pads.
    for (const gp of navigator.getGamepads()) {
      if (gp) { this.markGamepadReady(); break; }
    }
  }

  private onGamepadConnected = (): void => {
    this.markGamepadReady();
  };

  private markGamepadReady(): void {
    const card = this.root.querySelector<HTMLElement>('[data-mode="gamepad"]');
    if (card) {
      card.classList.add('isel-card-ready');
      card.querySelector('.isel-badge')?.classList.remove('isel-hidden');
    }
  }

  private html(): string {
    return `
      <div class="isel-bg"></div>
      <div class="isel-content">
        <div class="isel-logo">
          <h1>Climb of Patience</h1>
          <p class="isel-subtitle">Choose your input method</p>
        </div>

        <div class="isel-cards">
          <button type="button" class="isel-card" data-mode="mouse">
            <div class="isel-icon">
              <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="4" width="32" height="48" rx="16" stroke="currentColor" stroke-width="3"/>
                <line x1="20" y1="4" x2="20" y2="26" stroke="currentColor" stroke-width="3"/>
                <circle cx="20" cy="34" r="3" fill="currentColor"/>
              </svg>
            </div>
            <div class="isel-card-body">
              <h2>Mouse &amp; Keyboard</h2>
              <ul class="isel-hints">
                <li>Move mouse to aim hammer</li>
                <li>LMB — use ability</li>
                <li>Keys 1–4 — switch hammers</li>
                <li>Esc — menu</li>
              </ul>
            </div>
          </button>

          <button type="button" class="isel-card" data-mode="gamepad">
            <span class="isel-badge isel-hidden">Detected</span>
            <div class="isel-icon">
              <svg viewBox="0 0 64 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8 C4 8 2 20 2 26 C2 34 8 38 14 38 C18 38 22 36 24 32 L40 32 C42 36 46 38 50 38 C56 38 62 34 62 26 C62 20 60 8 52 8 Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
                <line x1="16" y1="20" x2="16" y2="28" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <line x1="12" y1="24" x2="20" y2="24" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <circle cx="46" cy="20" r="2.5" fill="currentColor"/>
                <circle cx="52" cy="24" r="2.5" fill="currentColor"/>
                <circle cx="40" cy="24" r="2.5" fill="currentColor"/>
                <circle cx="46" cy="28" r="2.5" fill="currentColor"/>
                <rect x="26" y="14" width="5" height="4" rx="1" stroke="currentColor" stroke-width="2"/>
                <rect x="33" y="14" width="5" height="4" rx="1" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
            <div class="isel-card-body">
              <h2>Gamepad</h2>
              <ul class="isel-hints">
                <li>Left stick — aim hammer</li>
                <li>R2 / L2 — extend / shorten</li>
                <li>Cross (✕) — use ability</li>
                <li>L1 / R1 — switch hammers</li>
                <li>Options — menu</li>
              </ul>
            </div>
          </button>
        </div>
      </div>
    `;
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    this.root.remove();
  }
}
