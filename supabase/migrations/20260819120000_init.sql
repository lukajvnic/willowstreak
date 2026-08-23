-- willo v1 schema
--
-- auth.users is owned by Supabase Auth. public.users below is ours and hangs
-- off it 1:1. (two different schemas, so the names don't collide.)
--
-- authorization model: RLS is ENABLED on every table with ZERO policies. that
-- means PostgREST (reached with the publishable/anon key that ships in the
-- browser bundle) can read and write nothing. the FastAPI service connects with
-- a bypassrls role and is the only path to this data, so access rules live in
-- exactly one place.
--
-- kept in lockstep with backend/app/models.py — change both together.

-- ---------------------------------------------------------------- users

create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  -- lowercase-only by constraint, so a plain unique index is case-insensitive
  -- without pulling in the citext extension
  username    text not null unique check (username ~ '^[a-z0-9_]{2,20}$'),
  first_name  text not null check (length(btrim(first_name)) between 1 and 40),
  last_name   text not null check (length(btrim(last_name)) between 0 and 40),
  bio         text not null default '',
  avatar      jsonb,
  avatar_path varchar(255),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- habits

create table public.habits (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name    text not null check (length(btrim(name)) between 1 and 40),
  -- 'completion' = did you do it at all; 'count' = how much, against a goal
  type    text not null default 'completion',
  goal    integer,
  unit    text not null default '',
  -- cross-user join key: habit names are free text per user, so "Gym" and
  -- "gym" have to collapse before anyone can be compared to anyone
  name_key    text generated always as (lower(btrim(name))) stored,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint ck_habit_type check (type in ('completion', 'count')),
  -- a count habit needs a target; a completion habit must not carry one
  constraint ck_goal_matches_type check (
    (type = 'count' and goal is not null and goal > 0) or
    (type = 'completion' and goal is null)
  )
);

create index ix_habits_user on public.habits (user_id);

-- ---------------------------------------------------------------- habit_entries

-- one row per habit per day.
--
-- `entry_date` is a DATE with no timezone and is always computed on the CLIENT
-- in the user's local zone. never derive it server-side from now(), or an entry
-- lands on the wrong square for everyone outside UTC.
create table public.habit_entries (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid not null references public.habits (id) on delete cascade,
  entry_date date not null,
  value      numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,

  -- the conflict target for the upsert, and the index the heatmap reads by
  constraint uq_entry_habit_date unique (habit_id, entry_date)
);

-- ---------------------------------------------------------------- lockdown

alter table public.users         enable row level security;
alter table public.habits        enable row level security;
alter table public.habit_entries enable row level security;
-- intentionally no policies. see the header comment.

-- ---------------------------------------------------------------- policies

-- The API reaches PostgREST with a USER-SCOPED client (the caller's access
-- token), so these policies are the authorization boundary. auth.uid() is the
-- signed-in user. Services still filter by user_id as well — defence in depth,
-- not a substitute.

create policy users_own_row on public.users
for all
using (id = auth.uid())
with check (id = auth.uid());

create policy habits_own_rows on public.habits
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- entries have no user_id of their own; ownership comes from the parent habit
create policy habit_entries_own_rows on public.habit_entries
for all
using (
  exists (
    select 1 from public.habits h
    where h.id = habit_entries.habit_id and h.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.habits h
    where h.id = habit_entries.habit_id and h.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------- rpc

-- Gaps-and-islands: subtracting a dense row_number() from a date column gives a
-- constant for every run of consecutive days, so grouping on it collapses each
-- unbroken run into one row. PostgREST can't express this, so it lives here.
--
-- security invoker (the default) on purpose: the function runs as the caller,
-- so the policies above scope it to their rows automatically. an island counts
-- as "current" if it reaches yesterday — an unlogged today shouldn't zero a
-- live streak. entries with value = 0 are a recorded zero, not a done day.
create or replace function public.get_my_stats()
returns table (streak integer, best integer, tracked integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with logged as (
      select e.habit_id, e.entry_date
      from public.habit_entries e
      join public.habits h on h.id = e.habit_id
      where e.value > 0
  ),
  islands as (
      select habit_id, count(*)::int as len, max(entry_date) as last_day
      from (
          select habit_id, entry_date,
                 entry_date - (row_number() over (
                     partition by habit_id order by entry_date))::int as grp
          from logged
      ) g
      group by habit_id, grp
  )
  select
      coalesce(max(len) filter (where last_day >= current_date - 1), 0)::int,
      coalesce(max(len), 0)::int,
      (select count(*)::int from public.habits where archived_at is null)
  from islands;
$$;

grant execute on function public.get_my_stats() to authenticated;

-- ---------------------------------------------------------------- grants

-- Supabase normally grants these to the API roles by default; stating them
-- explicitly keeps the migration portable to a bare postgres.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.users to authenticated;
grant select, insert, update, delete on public.habits to authenticated;
grant select, insert, update, delete on public.habit_entries to authenticated;

-- Username availability can't be answered by selecting from public.users as the
-- caller — RLS hides everyone else's rows, so a taken name would look free.
-- security definer to see past RLS, returning only a boolean so nothing else
-- about the other account leaks.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.users u where u.username = p_username);
$$;

grant execute on function public.username_available(text) to authenticated;
