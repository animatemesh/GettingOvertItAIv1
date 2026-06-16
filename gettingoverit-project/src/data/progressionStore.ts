/**
 * data/progressionStore.ts
 * -----------------------------------------------------------------------------
 * Persistent player progression: coins earned from ground-slams and the set of
 * hammers owned. Stored in localStorage so unlocks survive across runs.
 * (Per-origin like the rest of the local state — see [[map-persistence]].)
 */

import { HAMMER_ORDER, type HammerId } from './hammers';

const STORAGE_KEY = 'climb-of-patience:progression';

export interface Progression {
  coins: number;
  owned: HammerId[];
}

function defaults(): Progression {
  return { coins: 0, owned: ['basic'] };
}

export function loadProgression(): Progression {
  if (typeof window === 'undefined') return defaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<Progression>;
    const owned = Array.isArray(parsed.owned)
      ? parsed.owned.filter((id): id is HammerId => HAMMER_ORDER.includes(id as HammerId))
      : [];
    if (!owned.includes('basic')) owned.push('basic');
    return { coins: Math.max(0, Math.floor(Number(parsed.coins) || 0)), owned };
  } catch {
    return defaults();
  }
}

export function saveProgression(progression: Progression): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progression));
}
