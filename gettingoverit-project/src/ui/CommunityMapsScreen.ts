/**
 * ui/CommunityMapsScreen.ts
 * Full-screen overlay for browsing, rating, and playing community maps.
 * Mount with new CommunityMapsScreen(container, onClose).
 * Dispose with .dispose() when the user closes it.
 */

import {
  COMMUNITY_MAPS_ENABLED,
  type CommunityMapMeta,
  type CommunityMap,
  fetchCommunityMaps,
  fetchCommunityMap,
  fetchMyVotes,
  rateMap,
  getOrCreateVoterId,
  setActiveCommunityMap,
} from '../data/communityMapStore';

export class CommunityMapsScreen {
  private readonly root: HTMLDivElement;
  private readonly onClose: () => void;

  private maps: CommunityMapMeta[] = [];
  private myVotes = new Set<string>();
  private voterId = '';
  private loading = true;
  private error = '';
  private playingId: string | null = null;

  constructor(container: HTMLElement, onClose: () => void) {
    this.onClose = onClose;
    this.voterId = getOrCreateVoterId();

    this.root = document.createElement('div');
    this.root.className = 'cm-screen';
    container.appendChild(this.root);

    this.root.addEventListener('click', this.onClick);
    this.render();
    void this.load();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.remove();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.render();

    if (!COMMUNITY_MAPS_ENABLED) {
      this.loading = false;
      this.error = 'Supabase not configured — community maps require an online backend.';
      this.render();
      return;
    }

    try {
      [this.maps, this.myVotes] = await Promise.all([
        fetchCommunityMaps(),
        fetchMyVotes(this.voterId),
      ]);
    } catch (err) {
      this.error = `Failed to load maps: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private onClick = async (event: MouseEvent): Promise<void> => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    const mapId = target.closest<HTMLElement>('[data-map-id]')?.dataset.mapId;
    if (!action) return;

    switch (action) {
      case 'close':
        this.dispose();
        this.onClose();
        return;

      case 'refresh':
        await this.load();
        return;

      case 'play': {
        if (!mapId || this.playingId === mapId) return;
        await this.playMap(mapId);
        return;
      }

      case 'rate': {
        if (!mapId || this.myVotes.has(mapId)) return;
        const ok = await rateMap(mapId, this.voterId);
        if (ok) {
          this.myVotes.add(mapId);
          const entry = this.maps.find((m) => m.id === mapId);
          if (entry) entry.ratingCount += 1;
          this.render();
        }
        return;
      }
    }
  };

  private async playMap(id: string): Promise<void> {
    this.playingId = id;
    this.render();

    try {
      const full: CommunityMap | null = await fetchCommunityMap(id);
      if (!full) {
        this.error = 'Could not load that map from the server.';
        this.playingId = null;
        this.render();
        return;
      }
      setActiveCommunityMap(full);
      window.location.reload();
    } catch {
      this.error = 'Failed to load map data.';
      this.playingId = null;
      this.render();
    }
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="cm-backdrop"></div>
      <div class="cm-panel">
        <div class="cm-header">
          <div>
            <h2>Community Maps</h2>
            <p class="cm-subtitle">Maps created and shared by players, sorted by most starred</p>
          </div>
          <div class="cm-header-actions">
            <button type="button" class="cm-btn cm-btn-ghost" data-action="refresh">Refresh</button>
            <button type="button" class="cm-btn cm-btn-ghost" data-action="close">Close</button>
          </div>
        </div>

        <div class="cm-body">
          ${this.renderBody()}
        </div>
      </div>
    `;
  }

  private renderBody(): string {
    if (this.loading) {
      return `<div class="cm-state"><p>Loading maps...</p></div>`;
    }

    if (this.error) {
      return `
        <div class="cm-state">
          <p class="cm-error">${escHtml(this.error)}</p>
          <button type="button" class="cm-btn" data-action="refresh">Try Again</button>
        </div>
      `;
    }

    if (!this.maps.length) {
      return `
        <div class="cm-state">
          <p>No community maps yet — be the first to publish one from the editor!</p>
        </div>
      `;
    }

    return `
      <div class="cm-grid">
        ${this.maps.map((m) => this.renderCard(m)).join('')}
      </div>
    `;
  }

  private renderCard(m: CommunityMapMeta): string {
    const voted = this.myVotes.has(m.id);
    const playing = this.playingId === m.id;
    const age = formatAge(m.createdAt);

    return `
      <article class="cm-card" data-map-id="${escHtml(m.id)}">
        <div class="cm-card-title">${escHtml(m.title)}</div>
        <div class="cm-card-meta">
          <span>by ${escHtml(m.authorName)}</span>
          <span>${age}</span>
        </div>
        <div class="cm-card-stats">
          <span class="cm-stat">▶ ${m.playCount} plays</span>
          <span class="cm-stat">⭐ ${m.ratingCount} stars</span>
        </div>
        <div class="cm-card-actions">
          <button
            type="button"
            class="cm-btn cm-btn-primary"
            data-action="play"
            data-map-id="${escHtml(m.id)}"
            ${playing ? 'disabled' : ''}
          >${playing ? 'Loading...' : 'Play'}</button>
          <button
            type="button"
            class="cm-btn ${voted ? 'cm-btn-voted' : 'cm-btn-vote'}"
            data-action="rate"
            data-map-id="${escHtml(m.id)}"
            ${voted ? 'disabled' : ''}
            title="${voted ? 'Already rated' : 'Give this map a star'}"
          >⭐${voted ? ' Rated' : ' Rate'}</button>
        </div>
      </article>
    `;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
