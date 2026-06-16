/**
 * scoreStore.ts
 * -----------------------------------------------------------------------------
 * Scoreboard (visit counter + highscores) with a shared online backend
 * (Supabase) and a graceful per-device localStorage fallback.
 *
 * Remote mode activates automatically when VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are configured (see .env.example and supabase/schema.sql).
 * Without them, or if a request fails, everything falls back to localStorage so
 * local dev and offline play keep working.
 *
 * The anon key is intentionally shipped to the client — writes are constrained
 * by Row-Level Security policies + check constraints on the server, and the
 * visit counter can only be bumped through the increment_visits() RPC. Note that
 * client-submitted times are inherently forgeable; the server guards only enforce
 * plausibility, not true anti-cheat.
 */

export interface HighscoreEntry {
  id: string;
  name: string;
  timeMs: number;
  createdAt: string;
}

export type StorageMode = 'local' | 'remote';

export interface ScoreboardState {
  visitCount: number;
  highscores: HighscoreEntry[];
  storageMode: StorageMode;
}

const VISITS_STORAGE_KEY = 'climb-of-patience:visits';
const HIGHSCORES_STORAGE_KEY = 'climb-of-patience:highscores';
const VISIT_SESSION_KEY = 'climb-of-patience:visit-counted';
const MAX_HIGHSCORES = 100;
/** Largest plausible run time accepted (24h), mirrors the DB check constraint. */
const MAX_TIME_MS = 24 * 60 * 60 * 1000;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const REMOTE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);

/* -------------------------------------------------------------------------- */
/*  Public API (async; always resolves — never throws)                         */
/* -------------------------------------------------------------------------- */

/** Count this visit (once per browser session) and return the live scoreboard. */
export async function registerVisit(): Promise<ScoreboardState> {
  if (!REMOTE_ENABLED) return incrementLocalVisit();
  try {
    const firstThisSession =
      typeof window !== 'undefined' && !window.sessionStorage.getItem(VISIT_SESSION_KEY);

    let visitCount: number;
    if (firstThisSession) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_visits`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      if (!res.ok) throw new Error(`increment_visits ${res.status}`);
      visitCount = Number(await res.json()) || 0;
      window.sessionStorage.setItem(VISIT_SESSION_KEY, '1');
    } else {
      visitCount = await fetchVisitCount();
    }

    const highscores = await fetchRemoteHighscores();
    return { visitCount, highscores, storageMode: 'remote' };
  } catch (err) {
    console.warn('Scoreboard: remote visit failed, using local fallback.', err);
    return incrementLocalVisit();
  }
}

/** Read the current scoreboard without counting a visit. */
export async function fetchScoreboard(): Promise<ScoreboardState> {
  if (!REMOTE_ENABLED) return loadLocalScoreboard();
  try {
    const [visitCount, highscores] = await Promise.all([fetchVisitCount(), fetchRemoteHighscores()]);
    return { visitCount, highscores, storageMode: 'remote' };
  } catch (err) {
    console.warn('Scoreboard: remote read failed, using local fallback.', err);
    return loadLocalScoreboard();
  }
}

/** Submit a finished run, then return the refreshed scoreboard. */
export async function submitHighscore(name: string, timeMs: number): Promise<ScoreboardState> {
  const safeName = sanitizeName(name);
  const safeTime = Math.min(Math.max(0, Math.round(timeMs)), MAX_TIME_MS);

  if (!REMOTE_ENABLED) return submitLocalHighscore(safeName, safeTime);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/highscores`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ name: safeName, time_ms: safeTime }),
    });
    if (!res.ok) throw new Error(`insert highscore ${res.status}`);

    const [visitCount, highscores] = await Promise.all([fetchVisitCount(), fetchRemoteHighscores()]);
    return { visitCount, highscores, storageMode: 'remote' };
  } catch (err) {
    console.warn('Scoreboard: remote submit failed, saving locally.', err);
    return submitLocalHighscore(safeName, safeTime);
  }
}

/** Instant synchronous snapshot for first paint before the async fetch lands. */
export function loadLocalScoreboard(): ScoreboardState {
  return {
    visitCount: readNumber(VISITS_STORAGE_KEY, 0),
    highscores: loadLocalHighscores(),
    storageMode: 'local',
  };
}

/* -------------------------------------------------------------------------- */
/*  Supabase REST helpers                                                       */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function fetchVisitCount(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/counters?select=value&name=eq.visits`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`counters ${res.status}`);
  const rows = (await res.json()) as Array<{ value: number }>;
  return rows.length ? Number(rows[0].value) || 0 : 0;
}

async function fetchRemoteHighscores(): Promise<HighscoreEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/highscores?select=id,name,time_ms,created_at&order=time_ms.asc,created_at.asc&limit=${MAX_HIGHSCORES}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`highscores ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string; name: string; time_ms: number; created_at: string }>;
  return rows.map((r) => ({
    id: String(r.id),
    name: sanitizeName(r.name),
    timeMs: Math.max(0, Number(r.time_ms) || 0),
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(0).toISOString(),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Local fallback                                                              */
/* -------------------------------------------------------------------------- */

function incrementLocalVisit(): ScoreboardState {
  const visitCount = readNumber(VISITS_STORAGE_KEY, 0) + 1;
  writeNumber(VISITS_STORAGE_KEY, visitCount);
  return { visitCount, highscores: loadLocalHighscores(), storageMode: 'local' };
}

function submitLocalHighscore(name: string, timeMs: number): ScoreboardState {
  const nextEntry: HighscoreEntry = {
    id: createScoreId(),
    name,
    timeMs,
    createdAt: new Date().toISOString(),
  };

  const highscores = [...loadLocalHighscores(), nextEntry]
    .sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAX_HIGHSCORES);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(HIGHSCORES_STORAGE_KEY, JSON.stringify(highscores));
  }

  return { visitCount: readNumber(VISITS_STORAGE_KEY, 0), highscores, storageMode: 'local' };
}

function loadLocalHighscores(): HighscoreEntry[] {
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
