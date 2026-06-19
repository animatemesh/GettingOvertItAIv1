import { BREAST } from './config';

export interface ChestPhysicsSettings {
  enabled: boolean;
  stiffness: number;
  damping: number;
  gravity: number;
  mass: number;
}

export interface GameSettings {
  hammerSensitivity: number;
  gamepadSensitivity: number;
  playerName: string;
  chestPhysics: ChestPhysicsSettings;
}

export const GAME_SETTINGS_STORAGE_KEY = 'climb-of-patience:settings';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  hammerSensitivity: 1.35,
  gamepadSensitivity: 10,
  playerName: 'Climber',
  chestPhysics: {
    enabled: BREAST.enabled,
    stiffness: BREAST.stiffness,
    damping: BREAST.damping,
    gravity: BREAST.gravity,
    mass: BREAST.mass,
  },
};

export function cloneDefaultSettings(): GameSettings {
  return structuredClone(DEFAULT_GAME_SETTINGS);
}

export function cloneDefaultChestPhysicsSettings(): ChestPhysicsSettings {
  return structuredClone(DEFAULT_GAME_SETTINGS.chestPhysics);
}

export function loadGameSettings(): GameSettings {
  if (typeof window === 'undefined') return cloneDefaultSettings();

  try {
    const raw = window.localStorage.getItem(GAME_SETTINGS_STORAGE_KEY);
    if (!raw) return cloneDefaultSettings();

    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return sanitizeSettings(parsed);
  } catch {
    return cloneDefaultSettings();
  }
}

export function saveGameSettings(settings: GameSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
}

function sanitizeSettings(input: Partial<GameSettings>): GameSettings {
  const defaults = cloneDefaultSettings();
  const chest: Partial<ChestPhysicsSettings> = input.chestPhysics ?? {};

  return {
    hammerSensitivity: clampNumber(input.hammerSensitivity, defaults.hammerSensitivity, 0.5, 2.8),
    gamepadSensitivity: clampNumber(input.gamepadSensitivity, defaults.gamepadSensitivity, 4, 100),
    playerName: sanitizeName(input.playerName, defaults.playerName),
    chestPhysics: {
      enabled: typeof chest.enabled === 'boolean' ? chest.enabled : defaults.chestPhysics.enabled,
      stiffness: clampNumber(chest.stiffness, defaults.chestPhysics.stiffness, 0, 220),
      damping: clampNumber(chest.damping, defaults.chestPhysics.damping, 0, 24),
      gravity: clampNumber(chest.gravity, defaults.chestPhysics.gravity, -8, 8),
      mass: clampNumber(chest.mass, defaults.chestPhysics.mass, 0.05, 2.5),
    },
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function sanitizeName(value: unknown, fallback: string): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed.slice(0, 24) : fallback;
}
