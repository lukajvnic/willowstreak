-- The social surfaces — someone's profile grids, the leaderboards, the
-- activity feed — ran on mock arrays in the frontend. These three functions
-- are their real source.
--
-- All three are security definer: RLS hides every habit and entry but your
-- own, and each of these exists to show you someone else's. There are no
-- friendships in v1, so "someone else" is any account: every signed-in user
-- can see what everyone tracks and logs. When friendships land, the place to
-- narrow that is a join inside these functions, not a new policy.
--
-- Dates are parameters, never current_date. A day is the client's local day
-- everywhere else in the schema, and "this week" / "a streak that reaches
-- yesterday" would be off by one for anyone far from UTC otherwise.

-- Someone's unarchived habits with a window of entries: the grids on their
-- profile. Same narrow definition as get_user_habits(), plus date and value.
create or replace function public.get_user_grids(p_user_id uuid, p_from date, p_to date)
returns table (
  name    text,
  type    text,
  goal    integer,
  unit    text,
  entries jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.name, h.type, h.goal, h.unit,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object('entry_date', e.entry_date, 'value', e.value)
                    order by e.entry_date)
           from public.habit_entries e
           where e.habit_id = h.id and e.entry_date between p_from and p_to
         ), '[]'::jsonb)
  from public.habits h
  where h.user_id = p_user_id and h.archived_at is null
  order by h.created_at;
$$;

-- One board per habit the caller tracks, ranking everyone who tracks a habit
-- of the same name (habits.name_key is the cross-user join key). Yes/no habits
-- rank by current streak; counted habits by this week's total, and only
-- against people counting in the same unit — minutes and pages of "reading"
-- don't share a board.
--
-- Capped at 100 rows a board so the result stays bounded as accounts grow.
create or replace function public.get_leaderboards(p_today date, p_week_start date)
returns table (
  habit       text,
  type        text,
  unit        text,
  user_id     uuid,
  username    text,
  first_name  text,
  last_name   text,
  avatar      jsonb,
  avatar_path varchar,
  value       numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
      select distinct on (k.name_key, k.type, k.unit_key)
             k.name_key, k.type, k.unit_key, k.name, k.unit, k.created_at
      from (
          select h.name_key, h.type, h.name, h.unit, h.created_at,
                 case when h.type = 'count' then lower(btrim(h.unit)) else '' end as unit_key
          from public.habits h
          where h.user_id = auth.uid() and h.archived_at is null
      ) k
      order by k.name_key, k.type, k.unit_key, k.created_at
  ),
  peers as (
      select m.name_key, m.type, m.unit_key, h.id as habit_id, h.user_id
      from mine m
      join public.habits h
        on h.name_key = m.name_key
       and h.type = m.type
       and (m.type = 'completion' or lower(btrim(h.unit)) = m.unit_key)
       and h.archived_at is null
  ),
  islands as (
      select g.habit_id, count(*)::int as len, max(g.entry_date) as last_day
      from (
          select p.habit_id, e.entry_date,
                 e.entry_date - (row_number() over (
                     partition by p.habit_id order by e.entry_date))::int as grp
          from peers p
          join public.habit_entries e on e.habit_id = p.habit_id
          where p.type = 'completion' and e.value > 0 and e.entry_date <= p_today
      ) g
      group by g.habit_id, g.grp
  ),
  streak as (
      -- live if it reaches yesterday: an unlogged today doesn't zero it
      select i.habit_id, max(i.len) as value
      from islands i
      where i.last_day >= p_today - 1
      group by i.habit_id
  ),
  week as (
      select p.habit_id, sum(e.value) as value
      from peers p
      join public.habit_entries e on e.habit_id = p.habit_id
      where p.type = 'count'
        and e.entry_date between p_week_start and p_week_start + 6
      group by p.habit_id
  ),
  scored as (
      -- two habits of the same name on one account count once, at their best
      select p.name_key, p.type, p.unit_key, p.user_id,
             max(coalesce(s.value, w.value, 0)) as value
      from peers p
      left join streak s on s.habit_id = p.habit_id
      left join week w on w.habit_id = p.habit_id
      group by p.name_key, p.type, p.unit_key, p.user_id
  ),
  ranked as (
      select sc.*,
             row_number() over (
                 partition by sc.name_key, sc.type, sc.unit_key
                 order by sc.value desc, sc.user_id) as pos
      from scored sc
  )
  select m.name, m.type, m.unit,
         u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path,
         r.value
  from ranked r
  join mine m
    on m.name_key = r.name_key and m.type = r.type and m.unit_key = r.unit_key
  join public.users u on u.id = r.user_id
  where r.pos <= 100
  order by m.created_at, m.name_key, m.type, m.unit_key, r.pos;
$$;

-- The most recent logs from everyone but the caller. A recorded zero isn't
-- news, so only value > 0 shows up.
create or replace function public.get_activity(p_limit integer)
returns table (
  id          uuid,
  user_id     uuid,
  username    text,
  first_name  text,
  last_name   text,
  avatar      jsonb,
  avatar_path varchar,
  habit       text,
  type        text,
  unit        text,
  value       numeric,
  entry_date  date,
  logged_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path,
         h.name, h.type, h.unit, e.value, e.entry_date,
         coalesce(e.updated_at, e.created_at)
  from public.habit_entries e
  join public.habits h on h.id = e.habit_id
  join public.users u on u.id = h.user_id
  where h.user_id <> auth.uid() and h.archived_at is null and e.value > 0
  order by coalesce(e.updated_at, e.created_at) desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- the feed's sort key
create index ix_entries_logged_at
  on public.habit_entries ((coalesce(updated_at, created_at)) desc);

revoke execute on function public.get_user_grids(uuid, date, date) from public;
revoke execute on function public.get_user_grids(uuid, date, date) from anon;
revoke execute on function public.get_leaderboards(date, date) from public;
revoke execute on function public.get_leaderboards(date, date) from anon;
revoke execute on function public.get_activity(integer) from public;
revoke execute on function public.get_activity(integer) from anon;

grant execute on function public.get_user_grids(uuid, date, date) to authenticated;
grant execute on function public.get_leaderboards(date, date) to authenticated;
grant execute on function public.get_activity(integer) to authenticated;
