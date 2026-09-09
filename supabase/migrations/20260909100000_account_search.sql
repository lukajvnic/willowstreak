-- Account search: two security definer functions, because RLS hides every row
-- but your own. Same reasoning as username_available() — see past RLS on
-- purpose, return a deliberately narrow shape.

-- Prefix search on username. The charset guard makes LIKE-injection a
-- non-issue: a prefix containing % or _ can never pass it, it just matches
-- nothing (usernames are constrained to ^[a-z0-9_]{2,20}$ anyway).
create or replace function public.search_users(p_prefix text)
returns table (
  id          uuid,
  username    text,
  first_name  text,
  last_name   text,
  avatar      jsonb,
  avatar_path varchar
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path
  from public.users u
  where p_prefix ~ '^[a-z0-9_]{1,20}$'
    and u.username like p_prefix || '%'
  order by u.username
  limit 20;
$$;

-- The profile card for any account: public profile fields plus the same
-- streak/best/tracked numbers get_my_stats() computes, but for the target
-- user. Deliberately no habit names, entries, or amounts — the card shows
-- that someone is active, not what they do.
create or replace function public.get_user_card(p_user_id uuid)
returns table (
  id          uuid,
  username    text,
  first_name  text,
  last_name   text,
  bio         text,
  avatar      jsonb,
  avatar_path varchar,
  created_at  timestamptz,
  streak      integer,
  best        integer,
  tracked     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with logged as (
      select e.habit_id, e.entry_date
      from public.habit_entries e
      join public.habits h on h.id = e.habit_id
      where h.user_id = p_user_id and e.value > 0
  ),
  islands as (
      select count(*)::int as len, max(entry_date) as last_day
      from (
          select habit_id, entry_date,
                 entry_date - (row_number() over (
                     partition by habit_id order by entry_date))::int as grp
          from logged
      ) g
      group by habit_id, grp
  ),
  s as (
      select
          coalesce(max(len) filter (where last_day >= current_date - 1), 0)::int as streak,
          coalesce(max(len), 0)::int as best,
          (select count(*)::int from public.habits
           where user_id = p_user_id and archived_at is null) as tracked
      from islands
  )
  select u.id, u.username, u.first_name, u.last_name, u.bio,
         u.avatar, u.avatar_path, u.created_at,
         s.streak, s.best, s.tracked
  from public.users u, s
  where u.id = p_user_id;
$$;

-- Postgres grants EXECUTE to PUBLIC by default — same lockdown as
-- 20260820012638_restrict_function_execution.sql, done right from the start.
revoke execute on function public.search_users(text) from public;
revoke execute on function public.search_users(text) from anon;
revoke execute on function public.get_user_card(uuid) from public;
revoke execute on function public.get_user_card(uuid) from anon;

grant execute on function public.search_users(text) to authenticated;
grant execute on function public.get_user_card(uuid) to authenticated;
