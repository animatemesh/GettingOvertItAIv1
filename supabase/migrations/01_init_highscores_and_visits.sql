-- 01_init_highscores_and_visits.sql
-- Creates the highscores leaderboard and visit counter tables
-- with Row-Level Security so the anon key is safe in the browser.

-- ─── Highscores ────────────────────────────────────────────────────────────────
create table if not exists public.highscores (
  id         bigserial primary key,
  name       text        not null,
  time_ms    integer     not null,
  created_at timestamptz not null default now(),

  constraint highscores_name_length  check (char_length(name)  between 1 and 24),
  constraint highscores_time_range   check (time_ms between 0 and 86400000)
);

alter table public.highscores enable row level security;

-- Anyone can read the leaderboard.
create policy "highscores_select"
  on public.highscores for select
  using (true);

-- Anyone can submit a score (validated by check constraints above).
create policy "highscores_insert"
  on public.highscores for insert
  with check (true);

-- ─── Visit counter ─────────────────────────────────────────────────────────────
create table if not exists public.counters (
  key        text    primary key,
  value      bigint  not null default 0
);

alter table public.counters enable row level security;

-- Seed the visit counter row.
insert into public.counters (key, value)
values ('visits', 0)
on conflict (key) do nothing;

-- Anon can read the counter (for display).
create policy "counters_select"
  on public.counters for select
  using (true);

-- No direct writes via anon key — only through the RPC below.

-- ─── Increment-visits RPC ──────────────────────────────────────────────────────
-- SECURITY DEFINER lets the anon role call this without direct write access
-- to the counters table (the function runs as the owning role).
create or replace function public.increment_visits()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_val bigint;
begin
  update counters
  set    value = value + 1
  where  key   = 'visits'
  returning value into new_val;

  return coalesce(new_val, 0);
end;
$$;

-- Grant execute to the anon role so the browser can call it.
grant execute on function public.increment_visits() to anon;
