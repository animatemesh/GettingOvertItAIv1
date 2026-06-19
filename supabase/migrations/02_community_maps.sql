-- 02_community_maps.sql
-- Community-created maps: publish, browse, thumbs-up ratings, play counter.
-- Ratings are one-per-voter (browser UUID) per map, enforced by primary key.
-- All writes from the anon key go through RPC so the table is append-only
-- without exposing direct UPDATE access.

-- ─── Community maps ────────────────────────────────────────────────────────────
create table if not exists public.community_maps (
  id           uuid        primary key default gen_random_uuid(),
  title        text        not null,
  author_name  text        not null,
  map_data     jsonb       not null,
  created_at   timestamptz not null default now(),
  play_count   bigint      not null default 0,
  rating_count bigint      not null default 0,

  constraint community_maps_title_length  check (char_length(title)       between 1 and 60),
  constraint community_maps_author_length check (char_length(author_name) between 1 and 24)
);

alter table public.community_maps enable row level security;

create policy "community_maps_select"
  on public.community_maps for select using (true);

create policy "community_maps_insert"
  on public.community_maps for insert with check (true);

-- ─── Map ratings (one star per voter per map) ──────────────────────────────────
create table if not exists public.map_ratings (
  map_id     uuid        not null references public.community_maps(id) on delete cascade,
  voter_id   text        not null,
  created_at timestamptz not null default now(),

  primary key (map_id, voter_id),
  constraint map_ratings_voter_id_length check (char_length(voter_id) between 1 and 64)
);

alter table public.map_ratings enable row level security;

create policy "map_ratings_select"
  on public.map_ratings for select using (true);

-- No direct inserts — go through rate_map() RPC below.

-- ─── RPC: increment play count ─────────────────────────────────────────────────
create or replace function public.increment_play_count(p_map_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update community_maps set play_count = play_count + 1 where id = p_map_id;
end;
$$;

grant execute on function public.increment_play_count(uuid) to anon;

-- ─── RPC: rate a map (insert rating + bump counter atomically) ─────────────────
-- Returns true if the vote was accepted, false if the voter already voted.
create or replace function public.rate_map(p_map_id uuid, p_voter_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into map_ratings(map_id, voter_id) values (p_map_id, p_voter_id);
  update community_maps set rating_count = rating_count + 1 where id = p_map_id;
  return true;
exception when unique_violation then
  return false;
end;
$$;

grant execute on function public.rate_map(uuid, text) to anon;
