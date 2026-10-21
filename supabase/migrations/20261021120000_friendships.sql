-- Friends, LinkedIn-style: anyone can send anyone a request, the other person
-- accepts it, and from then on the two are friends both ways. One row per
-- pair holds the whole relationship — pending while it's a request, accepted
-- once it isn't. Declining, cancelling and unfriending all delete the row, so
-- either person can ask again later.
--
-- This only adds the relationship. Leaderboards, the feed and profiles are
-- still open to every signed-in user; narrowing them to friends is a join
-- inside those functions (see 20261013140000_social_reads.sql).

create table public.friendships (
  requester_id uuid not null references public.users (id) on delete cascade,
  addressee_id uuid not null references public.users (id) on delete cascade,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,

  primary key (requester_id, addressee_id),
  constraint ck_friendship_status check (status in ('pending', 'accepted')),
  constraint ck_friendship_not_self check (requester_id <> addressee_id),
  constraint ck_friendship_accepted_at check ((status = 'accepted') = (accepted_at is not null))
);

-- one row per pair, whichever way the request went: A asking B while B's
-- request to A is still pending is a conflict, not a second row
create unique index uq_friendship_pair on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- the primary key covers "requests I sent"; this covers "requests I got"
create index ix_friendships_addressee on public.friendships (addressee_id);

alter table public.friendships enable row level security;

-- both people can see the row, and either can remove it (cancel, decline,
-- unfriend)
create policy friendships_parties_read on public.friendships
for select
using (auth.uid() in (requester_id, addressee_id));

create policy friendships_parties_delete on public.friendships
for delete
using (auth.uid() in (requester_id, addressee_id));

-- you can only send a request as yourself, and only as a request: an
-- accepted row can't be inserted, only reached by the other person accepting
create policy friendships_send on public.friendships
for insert
with check (requester_id = auth.uid() and status = 'pending');

-- only the person who was asked can accept, and accepting is the only change
-- there is. the column grant below keeps the pair itself fixed.
create policy friendships_accept on public.friendships
for update
using (addressee_id = auth.uid() and status = 'pending')
with check (addressee_id = auth.uid() and status = 'accepted');

grant select, insert, delete on public.friendships to authenticated;
grant update (status, accepted_at) on public.friendships to authenticated;

-- Everything involving the caller, with the other person's public profile.
-- security definer because RLS on users hides everyone's row but your own;
-- the where clause keeps it to the caller's own friendships.
create or replace function public.get_friendships()
returns table (
  user_id     uuid,
  username    text,
  first_name  text,
  last_name   text,
  avatar      jsonb,
  avatar_path varchar,
  status      text,
  -- true when the other person sent it
  incoming    boolean,
  created_at  timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.username, u.first_name, u.last_name, u.avatar, u.avatar_path,
         f.status, f.addressee_id = auth.uid(), f.created_at, f.accepted_at
  from public.friendships f
  join public.users u
    on u.id = case when f.requester_id = auth.uid() then f.addressee_id
                   else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by coalesce(f.accepted_at, f.created_at) desc;
$$;

revoke execute on function public.get_friendships() from public;
revoke execute on function public.get_friendships() from anon;

grant execute on function public.get_friendships() to authenticated;
