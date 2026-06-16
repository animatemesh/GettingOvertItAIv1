/**
 * ui/Hud.ts
 * -----------------------------------------------------------------------------
 * Minimal DOM overlay: current zone name, height-climbed meter, an anchor
 * indicator (lit while the hammer is biting a ledge) and the win banner.
 */

import type { Zone } from '../data/mapData';

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly zoneEl: HTMLDivElement;
  private readonly heightEl: HTMLDivElement;
  private readonly anchorEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private won = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    this.zoneEl = document.createElement('div');
    this.zoneEl.className = 'hud-zone';

    this.heightEl = document.createElement('div');
    this.heightEl.className = 'hud-height';

    this.anchorEl = document.createElement('div');
    this.anchorEl.className = 'hud-anchor';
    this.anchorEl.textContent = 'ANCHOR';

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-banner';

    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.textContent = 'Move the mouse to steer the hammer. Hook ledges and push to climb.';

    this.root.append(this.zoneEl, this.heightEl, this.anchorEl, this.bannerEl, hint);
    container.appendChild(this.root);
  }

  update(focusY: number, zones: Zone[], anchored: boolean): void {
    const zone = zones.find((z) => focusY >= z.yRange[0] && focusY < z.yRange[1]);
    this.zoneEl.textContent = zone ? zone.name : '—';
    this.heightEl.textContent = `${focusY.toFixed(1)} m`;
    this.anchorEl.classList.toggle('on', anchored);
  }

  showWin(): void {
    if (this.won) return;
    this.won = true;
    this.bannerEl.textContent = 'The Quiet Beyond — you made it.';
    this.bannerEl.classList.add('show');
  }
}
