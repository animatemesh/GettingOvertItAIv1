import { CLIMB_OF_PATIENCE, type ClimbMap } from './mapData';

export const EDITOR_MAP_STORAGE_KEY = 'climb-of-patience:map';

export function cloneBaseMap(): ClimbMap {
  return structuredClone(CLIMB_OF_PATIENCE);
}

export function loadEditableMap(): ClimbMap {
  if (typeof window === 'undefined') return cloneBaseMap();

  try {
    const raw = window.localStorage.getItem(EDITOR_MAP_STORAGE_KEY);
    if (!raw) return cloneBaseMap();
    return JSON.parse(raw) as ClimbMap;
  } catch {
    return cloneBaseMap();
  }
}

export function saveEditableMap(map: ClimbMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EDITOR_MAP_STORAGE_KEY, JSON.stringify(map));
}

export function clearEditableMap(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(EDITOR_MAP_STORAGE_KEY);
}
