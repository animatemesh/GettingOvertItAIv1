export interface HighscoreEntry {
  id: string;
  name: string;
  timeMs: number;
  createdAt: string;
}

export interface ScoreboardState {
  visitCount: number;
  highscores: HighscoreEntry[];
  storageMode: 'local';
}

const VISITS_STORAGE_KEY = 'climb-of-patience:visits';
const HIGHSCORES_STORAGE_KEY = 'climb-of-patience:highscores';
const MAX_HIGHSCORES = 100;

export function incrementVisitCount(): ScoreboardState {
  const visitCount = readNumber(VISITS_STORAGE_KEY, 0) + 1;
  writeNumber(VISITS_STORAGE_KEY, visitCount);
  return {
    visitCount,
    highscores: loadHighscores(),
    storageMode: 'local',
  };
}

export function loadScoreboardState(): ScoreboardState {
  return {
    visitCount: readNumber(VISITS_STORAGE_KEY, 0),
    highscores: loadHighscores(),
    storageMode: 'local',
  };
}

export function submitHighscore(name: string, timeMs: number): ScoreboardState {
  const safeTime = Math.max(0, Math.round(timeMs));
  const nextEntry: HighscoreEntry = {
    id: createScoreId(),
    name: sanitizeName(name),
    timeMs: safeTime,
    createdAt: new Date().toISOString(),
  };

  const highscores = [...loadHighscores(), nextEntry]
    .sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAX_HIGHSCORES);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(HIGHSCORES_STORAGE_KEY, JSON.stringify(highscores));
  }

  return {
    visitCount: readNumber(VISITS_STORAGE_KEY, 0),
    highscores,
    storageMode: 'local',
  };
}

function loadHighscores(): HighscoreEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(HIGHSCORES_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as HighscoreEntry[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: String(entry.id ?? createScoreId()),
        name: sanitizeName(entry.name),
        timeMs: Math.max(0, Number(entry.timeMs) || 0),
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
      }))
      .sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt))
      .slice(0, MAX_HIGHSCORES);
  } catch {
    return [];
  }
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;

  const raw = window.localStorage.getItem(key);
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function writeNumber(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, String(value));
}

function sanitizeName(value: unknown): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed.slice(0, 24) : 'Climber';
}

function createScoreId(): string {
  return `score_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
