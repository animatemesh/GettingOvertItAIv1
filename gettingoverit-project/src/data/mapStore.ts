import { CLIMB_OF_PATIENCE, type ClimbMap } from './mapData';
import { canUseMapEditor } from '../utils/editorAccess';

export const EDITOR_MAP_STORAGE_KEY = 'climb-of-patience:map';

export function cloneBaseMap(): ClimbMap {
  return structuredClone(CLIMB_OF_PATIENCE);
}

export function loadEditableMap(): ClimbMap {
  if (typeof window === 'undefined' || !canUseMapEditor()) return cloneBaseMap();

  try {
    const raw = window.localStorage.getItem(EDITOR_MAP_STORAGE_KEY);
    if (!raw) return cloneBaseMap();
    return JSON.parse(raw) as ClimbMap;
  } catch {
    return cloneBaseMap();
  }
}

export function saveEditableMap(map: ClimbMap): void {
  if (typeof window === 'undefined' || !canUseMapEditor()) return;
  window.localStorage.setItem(EDITOR_MAP_STORAGE_KEY, JSON.stringify(map));
}

export function clearEditableMap(): void {
  if (typeof window === 'undefined' || !canUseMapEditor()) return;
  window.localStorage.removeItem(EDITOR_MAP_STORAGE_KEY);
}
