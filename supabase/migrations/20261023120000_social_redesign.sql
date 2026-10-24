-- The social tab's redesign: search by name as well as username, mutual friend
-- counts, "people you may know" from the friendship graph, streaks on the
-- feed, and a realtime ping when a friend logs something.
--
-- search_users() is left in place so the deployed backend keeps working until
-- the new one (which calls search_people) is out.

-- ------------------------------------------------------------------ helpers

-- Every accepted friendship, once in each direction. security invoker: called
-- by a signed-in user RLS limits it to their own friendships; called from the
-- security definer functions below it runs as their owner and sees them all.
create or replace function public.friend_pairs()
returns table (user_id uuid, friend_id uuid)
language sql
stable
set search_path = ''
as $$
  select f.requester_id, f.addressee_id from public.friendships f where f.status = 'accepted'
  union all
  select f.addressee_id, f.requester_id from public.friendships f where f.status = 'accepted';
$$;

revoke execute on function public.friend_pairs() from public;
revoke execute on function public.friend_pairs() from anon;

-- ------------------------------------------------------ dismissed suggestions

-- "not interested" on a suggestion. Only hides them from "people you may
-- know"; search still finds them and either of you can still send a request.
create table public.suggestion_dismissals (
  user_id      uuid not null references public.users (id) on delete cascade,
  dismissed_id uuid not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),

  primary key (user_id, dismissed_id),
  constraint ck_dismissal_not_self check (user_id <> dismissed_id)
);

alter table public.suggestion_dismissals enable row level security;

create policy dismissals_owner on public.suggestion_dismissals
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, delete on public.suggestion_dismissals to authenticated;

-- ------------------------------------------------------------------- search

-- Name or username, any case, anywhere in the string. strpos rather than LIKE,
-- so % and _ in the query are plain characters. A leading @ is dropped.
--
-- Ranked: full name starts with it, then a word of the name does, then the
-- username does, then it's somewhere inside. Ties go friends, then requests
-- to you, then requests from you, then everyone else, then most mutual
-- friends. The ranking is here rather than in the client because the result
-- is cut short.
create or replace function public.search_people(p_query text, p_limit integer)
returns table (
  id             uuid,
  username       text,
  first_name     text,
  last_name      text,
  avatar         jsonb,
  avatar_path    varchar,
  -- friends | incoming | outgoing | none
  relation       text,
  mutual_friends integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
      select lower(btrim(ltrim(btrim(p_query), '@'))) as q
  ),
  mine as (
      select p.friend_id from public.friend_pairs() p where p.user_id = auth.uid()
  ),
  mutual as (
      select p.user_id, count(*)::int as n
      from public.friend_pairs() p
      join mine m on m.friend_id = p.friend_id
      group by p.user_id
  ),
  hits as (
      select u.*, lower(btrim(u.first_name || ' ' || u.last_name)) as name,
             (select q.q from q) as q
      from public.users u
      where u.id <> auth.uid()
  ),
  ranked as (
      select h.*,
             case
               when left(h.name, length(h.q)) = h.q then 0
               when strpos(' ' || h.name, ' ' || h.q) > 0 then 1
               when left(h.username, length(h.q)) = h.q then 2
               else 3
             end as tier
      from hits h
      where length(h.q) between 1 and 40
        and (strpos(h.name, h.q) > 0 or strpos(h.username, h.q) > 0)
  )
  select r.id, r.username, r.first_name, r.last_name, r.avatar, r.avatar_path,
         case
           when f.status = 'accepted' then 'friends'
           when f.addressee_id = auth.uid() then 'incoming'
           when f.requester_id = auth.uid() then 'outgoing'
           else 'none'
         end,
         coalesce(m.n, 0)
  from ranked r
  left join public.friendships f
    on least(f.requester_id, f.addressee_id) = least(r.id, auth.uid())
   and greatest(f.requester_id, f.addressee_id) = greatest(r.id, auth.uid())
  left join mutual m on m.user_id = r.id
  order by r.tier,
           case
             when f.status = 'accepted' then 0
             when f.addressee_id = auth.uid() then 1
             when f.requester_id = auth.uid() then 2
             else 3
           end,
           coalesce(m.n, 0) desc,
           r.username
  limit least(greatest(p_limit, 1), 20);
$$;

revoke execute on function public.search_people(text, integer) from public;
revoke execute on function public.search_people(text, integer) from anon;
grant execute on function public.search_people(text, integer) to authenticated;

-- -------------------------------------------------------------- friendships

-- Same as 20261021120000_friendships.sql plus how many friends you share, for
-- the "@sam · 2 mutual friends" line on a request. The return type changes,
-- so it's dropped and recreated.
drop function public.get_friendships();

create function public.get_friendships()
returns table (
  user_id        uuid,
  username       text,
  first_name     text,
  last_name      text,
  avatar         jsonb,
  avatar_path    varchar,
  status         text,
  -- true when the other person sent it
  incoming       boolean,
  created_at     timestamptz,
  accepted_at    timestamptz,
  mutual_friends integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
      select p.friend_id from public.friend_pairs() p where p.user_id = auth.uid()
  ),
  mutual as (
      select p.user_id, count(*)::int as n
      from public.friend_pairs() p
      join mine m on m.friend_id = p.friend_id
      group by p.user_id
  )
  select u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path,
         f.status, f.addressee_id = auth.uid(), f.created_at, f.accepted_at,
         coalesce(m.n, 0)
  from public.friendships f
  join public.users u
    on u.id = case when f.requester_id = auth.uid() then f.addressee_id
                   else f.requester_id end
  left join mutual m on m.user_id = u.id
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by coalesce(f.accepted_at, f.created_at) desc;
$$;

revoke execute on function public.get_friendships() from public;
revoke execute on function public.get_friendships() from anon;
grant execute on function public.get_friendships() to authenticated;

-- ------------------------------------------------------ people you may know

-- Closest on the friendship graph first. Friends of your friends (hop 2),
-- most mutual friends first; then their friends (hop 3), most paths to you
-- first. Shared habits only break ties and aren't returned: what a stranger
-- tracks stays hidden. Nobody outside three hops is suggested, nor anyone
-- you're already friends with, have a pending request with either way, or
-- dismissed.
--
-- `via` is a friend of yours on the path, for the reason line: the mutual
-- friend at hop 2, the friend whose friend it is at hop 3.
create or replace function public.get_suggestions(p_limit integer)
returns table (
  id             uuid,
  username       text,
  first_name     text,
  last_name      text,
  avatar         jsonb,
  avatar_path    varchar,
  hop            integer,
  mutual_friends integer,
  via_username   text,
  via_first_name text,
  via_last_name  text
)
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
      select p.user_id, p.friend_id from public.friend_pairs() p
  ),
  mine as (
      select p.friend_id as id from pairs p where p.user_id = auth.uid()
  ),
  taken as (
      select auth.uid() as id
      union
      select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
      from public.friendships f
      where auth.uid() in (f.requester_id, f.addressee_id)
      union
      select d.dismissed_id from public.suggestion_dismissals d where d.user_id = auth.uid()
  ),
  -- everyone two steps out, with the friend of yours they hang off
  reach2 as (
      select p.friend_id as id, p.user_id as via
      from pairs p
      join mine m on m.id = p.user_id
      where p.friend_id <> auth.uid()
  ),
  hop2 as (
      select r.id, count(*)::int as paths, (array_agg(r.via order by r.via))[1] as via
      from reach2 r
      where r.id not in (select t.id from taken t)
      group by r.id
  ),
  hop3 as (
      select p.friend_id as id, count(*)::int as paths,
             (array_agg(r.via order by r.via))[1] as via
      from pairs p
      join reach2 r on r.id = p.user_id
      where p.friend_id not in (select t.id from taken t)
        and p.friend_id not in (select h.id from hop2 h)
      group by p.friend_id
  ),
  candidates as (
      select h.id, 2 as hop, h.paths, h.via from hop2 h
      union all
      select h.id, 3, h.paths, h.via from hop3 h
  ),
  my_habits as (
      select distinct h.name_key
      from public.habits h
      where h.user_id = auth.uid() and h.archived_at is null and not h.private
  ),
  shared as (
      select c.id, count(distinct h.name_key)::int as n
      from candidates c
      join public.habits h on h.user_id = c.id and h.archived_at is null and not h.private
      join my_habits mh on mh.name_key = h.name_key
      group by c.id
  )
  select u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path,
         c.hop, case when c.hop = 2 then c.paths else 0 end,
         v.username, v.first_name, v.last_name
  from candidates c
  join public.users u on u.id = c.id
  join public.users v on v.id = c.via
  left join shared s on s.id = c.id
  order by c.hop, c.paths desc, coalesce(s.n, 0) desc, u.username
  limit least(greatest(p_limit, 1), 20);
$$;

revoke execute on function public.get_suggestions(integer) from public;
revoke execute on function public.get_suggestions(integer) from anon;
grant execute on function public.get_suggestions(integer) to authenticated;

-- --------------------------------------------------------------------- feed

-- Same rows as 20261022120000_private_habits.sql, plus each log's streak:
-- consecutive logged days (value > 0) of that habit ending on its date, the
-- same rule as the profile card. `milestone` marks 7, 14, 30 and 50 days, then
-- every 100. `personal_best` marks the day a streak passed the habit's
-- previous longest. The return type changes, so it's dropped and recreated.
drop function public.get_activity(integer);

create function public.get_activity(p_limit integer)
returns table (
  id            uuid,
  user_id       uuid,
  username      text,
  first_name    text,
  last_name     text,
  avatar        jsonb,
  avatar_path   varchar,
  habit         text,
  type          text,
  unit          text,
  value         numeric,
  entry_date    date,
  logged_at     timestamptz,
  streak        integer,
  milestone     boolean,
  personal_best boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with feed as (
      select e.id, e.habit_id, h.user_id, h.name, h.type, h.unit, e.value, e.entry_date,
             coalesce(e.updated_at, e.created_at) as logged_at
      from public.habit_entries e
      join public.habits h on h.id = e.habit_id
      where h.user_id <> auth.uid() and h.archived_at is null and not h.private
        and e.value > 0
        and h.user_id in (select c.user_id from public.my_circle() c)
      order by coalesce(e.updated_at, e.created_at) desc
      limit least(greatest(p_limit, 1), 50)
  ),
  -- every logged day of the habits in the feed; grp is constant along a run
  -- and grows from one run to the next
  days as (
      select e.habit_id, e.entry_date,
             e.entry_date - (row_number() over (
                 partition by e.habit_id order by e.entry_date))::int as grp
      from public.habit_entries e
      where e.value > 0 and e.habit_id in (select f.habit_id from feed f)
  ),
  runs as (
      select d.habit_id, d.entry_date, d.grp,
             (row_number() over (
                 partition by d.habit_id, d.grp order by d.entry_date))::int as streak
      from days d
  ),
  islands as (
      select d.habit_id, d.grp, count(*)::int as len
      from days d
      group by d.habit_id, d.grp
  )
  select f.id, u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path,
         f.name, f.type, f.unit, f.value, f.entry_date, f.logged_at,
         r.streak,
         r.streak in (7, 14, 30, 50) or (r.streak >= 100 and r.streak % 100 = 0),
         coalesce(r.streak = b.len + 1, false)
  from feed f
  join public.users u on u.id = f.user_id
  join runs r on r.habit_id = f.habit_id and r.entry_date = f.entry_date
  left join lateral (
      select max(i.len) as len
      from islands i
      where i.habit_id = f.habit_id and i.grp < r.grp
  ) b on true
  order by f.logged_at desc;
$$;

revoke execute on function public.get_activity(integer) from public;
revoke execute on function public.get_activity(integer) from anon;
grant execute on function public.get_activity(integer) to authenticated;

-- ------------------------------------------------------------ realtime ping

-- When someone logs a day, each of their friends gets a broadcast on their own
-- private topic, feed:<their id>. It's only a nudge to re-read the feed: the
-- payload is the entry id, never the habit. postgres_changes on habit_entries
-- can't do this, because RLS hides friends' entries from whoever subscribes.
--
-- Same visibility as get_activity: nothing for private or archived habits, or
-- a value of zero. A broadcast that fails must never fail the log itself.
create or replace function public.ping_friends_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  if new.value <= 0 or (tg_op = 'UPDATE' and new.value = old.value) then
    return null;
  end if;

  select h.user_id into owner
  from public.habits h
  where h.id = new.habit_id and h.archived_at is null and not h.private;

  if owner is null then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('entry_id', new.id), 'activity', 'feed:' || p.friend_id::text, true
    )
    from public.friend_pairs() p
    where p.user_id = owner;
  exception when others then
    raise warning 'feed ping failed: %', sqlerrm;
  end;

  return null;
end;
$$;

revoke execute on function public.ping_friends_feed() from public;
revoke execute on function public.ping_friends_feed() from anon;
revoke execute on function public.ping_friends_feed() from authenticated;

create trigger trg_entries_ping_feed
after insert or update of value on public.habit_entries
for each row execute function public.ping_friends_feed();

-- a signed-in user can listen on their own feed topic and nobody else's
create policy feed_pings_own_topic on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() = 'feed:' || auth.uid()::text
);
