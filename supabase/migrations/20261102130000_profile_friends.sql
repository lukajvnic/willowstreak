-- The profile popup shows how many friends someone has, and opens a list of
-- them. The count rides on the card, which stays open like before (it never
-- carries habits). The list is a friend's business: you can read your own and
-- your friends', nobody else's — same circle as their grids.

-- Same body as 20261022120000_private_habits.sql plus `friends`. The return
-- type changes, so it's dropped and recreated.
drop function public.get_user_card(uuid);

create function public.get_user_card(p_user_id uuid)
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
  tracked     integer,
  friends     integer
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
        and (not h.private or h.user_id = auth.uid())
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
          (select count(*)::int from public.habits h
           where h.user_id = p_user_id and h.archived_at is null
             and (not h.private or h.user_id = auth.uid())) as tracked,
          (select count(*)::int from public.friend_pairs() p
           where p.user_id = p_user_id) as friends
      from islands
  )
  select u.id, u.username, u.first_name, u.last_name, u.bio,
         u.avatar, u.avatar_path, u.created_at,
         s.streak, s.best, s.tracked, s.friends
  from public.users u, s
  where u.id = p_user_id;
$$;

revoke execute on function public.get_user_card(uuid) from public;
revoke execute on function public.get_user_card(uuid) from anon;
grant execute on function public.get_user_card(uuid) to authenticated;

-- Someone's friends, each with where the caller stands with them ('self' for
-- the caller, who shows up in a friend's list) and how many friends the two
-- share. Empty unless the someone is you or a friend of yours.
create or replace function public.get_user_friends(p_user_id uuid)
returns table (
  id             uuid,
  username       text,
  first_name     text,
  last_name      text,
  avatar         jsonb,
  avatar_path    varchar,
  -- self | friends | incoming | outgoing | none
  relation       text,
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
         case
           when u.id = auth.uid() then 'self'
           when f.status = 'accepted' then 'friends'
           when f.addressee_id = auth.uid() then 'incoming'
           when f.requester_id = auth.uid() then 'outgoing'
           else 'none'
         end,
         case when u.id = auth.uid() then 0 else coalesce(m.n, 0) end
  from public.friend_pairs() p
  join public.users u on u.id = p.friend_id
  left join public.friendships f
    on least(f.requester_id, f.addressee_id) = least(u.id, auth.uid())
   and greatest(f.requester_id, f.addressee_id) = greatest(u.id, auth.uid())
  left join mutual m on m.user_id = u.id
  where p.user_id = p_user_id
    and p_user_id in (select c.user_id from public.my_circle() c)
  order by lower(btrim(u.first_name || ' ' || u.last_name)), u.username;
$$;

revoke execute on function public.get_user_friends(uuid) from public;
revoke execute on function public.get_user_friends(uuid) from anon;
grant execute on function public.get_user_friends(uuid) to authenticated;
