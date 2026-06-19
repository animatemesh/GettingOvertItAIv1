import type { ClimbMap } from './mapData';

export interface CommunityMapMeta {
  id: string;
  title: string;
  authorName: string;
  createdAt: string;
  playCount: number;
  ratingCount: number;
}

export interface CommunityMap extends CommunityMapMeta {
  mapData: ClimbMap;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const COMMUNITY_MAPS_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);

const VOTER_ID_KEY = 'climb-of-patience:voter-id';
const ACTIVE_MAP_KEY = 'climb-of-patience:active-community-map';

function headers(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export function getOrCreateVoterId(): string {
  let id = localStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}

/** Fetch list of maps sorted by rating DESC, plays DESC. */
export async function fetchCommunityMaps(): Promise<CommunityMapMeta[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/community_maps?select=id,title,author_name,created_at,play_count,rating_count` +
      `&order=rating_count.desc,play_count.desc,created_at.desc&limit=50`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`fetchCommunityMaps ${res.status}`);
  const rows = (await res.json()) as Array<{
    id: string; title: string; author_name: string;
    created_at: string; play_count: number; rating_count: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    authorName: r.author_name,
    createdAt: r.created_at,
    playCount: Number(r.play_count) || 0,
    ratingCount: Number(r.rating_count) || 0,
  }));
}

/** Fetch a single map including its map_data JSON. */
export async function fetchCommunityMap(id: string): Promise<CommunityMap | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/community_maps?select=id,title,author_name,created_at,play_count,rating_count,map_data` +
      `&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r['id']),
    title: String(r['title']),
    authorName: String(r['author_name']),
    createdAt: String(r['created_at']),
    playCount: Number(r['play_count']) || 0,
    ratingCount: Number(r['rating_count']) || 0,
    mapData: r['map_data'] as ClimbMap,
  };
}

/** Publish a map. Returns the new map ID. */
export async function publishMap(title: string, authorName: string, mapData: ClimbMap): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/community_maps`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify({
      title: title.trim().slice(0, 60),
      author_name: authorName.trim().slice(0, 24),
      map_data: mapData,
    }),
  });
  if (!res.ok) throw new Error(`publishMap ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0].id;
}

/** Returns all map IDs this voter has already rated. */
export async function fetchMyVotes(voterId: string): Promise<Set<string>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/map_ratings?select=map_id&voter_id=eq.${encodeURIComponent(voterId)}&limit=500`,
    { headers: headers() },
  );
  if (!res.ok) return new Set();
  const rows = (await res.json()) as Array<{ map_id: string }>;
  return new Set(rows.map((r) => r.map_id));
}

/** Rate a map. Returns true if the vote was new, false if already voted. */
export async function rateMap(mapId: string, voterId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_map`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_map_id: mapId, p_voter_id: voterId }),
  });
  if (!res.ok) return false;
  return Boolean(await res.json());
}

/** Fire-and-forget play count increment. */
export async function incrementPlayCount(mapId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_play_count`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_map_id: mapId }),
  }).catch(() => {});
}

// ── Session persistence for "currently playing a community map" ──────────────

export function setActiveCommunityMap(map: CommunityMap): void {
  sessionStorage.setItem(ACTIVE_MAP_KEY, JSON.stringify(map));
}

export function getActiveCommunityMap(): CommunityMap | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_MAP_KEY);
    return raw ? (JSON.parse(raw) as CommunityMap) : null;
  } catch {
    return null;
  }
}

export function clearActiveCommunityMap(): void {
  sessionStorage.removeItem(ACTIVE_MAP_KEY);
}
