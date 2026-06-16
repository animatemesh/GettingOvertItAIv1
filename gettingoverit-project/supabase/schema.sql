-- Climb of Patience — Supabase schema for the shared leaderboard + visit counter.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- Security model: the client ships the anon/public key. Reads are open; writes
-- are constrained by Row-Level Security + check constraints, and the visit
-- counter can ONLY be bumped via the increment_visits() function. This enforces
-- plausibility, not true anti-cheat (client times are still forgeable).

-- ---------------------------------------------------------------------------
-- Highscores
-- ---------------------------------------------------------------------------
create table if not exists public.highscores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 24),
  time_ms     integer not null check (time_ms between 0 and 86400000), -- 0..24h
  created_at  timestamptz not null default now()
);

create index if not exists highscores_time_idx on public.highscores (time_ms asc);

alter table public.highscores enable row level security;

-- Anyone may read the leaderboard.
drop policy if exists "highscores read" on public.highscores;
create policy "highscores read" on public.highscores
  for select using (true);

-- Anyone may add a score, but only one that passes the plausibility checks.
drop policy if exists "highscores insert" on public.highscores;
create policy "highscores insert" on public.highscores
  for insert with check (
    char_length(name) between 1 and 24
    and time_ms between 0 and 86400000
  );

grant select, insert on public.highscores to anon;

-- ---------------------------------------------------------------------------
-- Visit counter
-- ---------------------------------------------------------------------------
create table if not exists public.counters (
  name   text primary key,
  value  bigint not null default 0
);

insert into public.counters (name, value) values ('visits', 0)
  on conflict (name) do nothing;

alter table public.counters enable row level security;

-- Readable, but NOT directly writable (no insert/update policy). The counter can
-- only change through increment_visits() below, which runs with elevated rights.
drop policy if exists "counters read" on public.counters;
create policy "counters read" on public.counters
  for select using (true);

grant select on public.counters to anon;

-- Atomic, tamper-resistant increment. SECURITY DEFINER bypasses RLS so the anon
-- role can bump the counter by exactly one without being able to set it freely.
create or replace function public.increment_visits()
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.counters
     set value = value + 1
   where name = 'visits'
  returning value;
$$;

grant execute on function public.increment_visits() to anon;
