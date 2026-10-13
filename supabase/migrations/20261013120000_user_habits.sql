-- Copying a habit from another account: the new-habit dialog lists what
-- someone tracks so the caller can start the same habit themselves. RLS hides
-- every habit but your own, so this is a security definer function like
-- search_users() — and just as narrow. It returns the definition only (name,
-- type, goal, unit): no ids, no entries, no amounts.
--
-- This is the first place habit names leave their owner. get_user_card()
-- still deliberately carries none, so the card alone says nothing about what
-- someone does.
create or replace function public.get_user_habits(p_user_id uuid)
returns table (
  name text,
  type text,
  goal integer,
  unit text
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.name, h.type, h.goal, h.unit
  from public.habits h
  where h.user_id = p_user_id and h.archived_at is null
  order by h.created_at;
$$;

revoke execute on function public.get_user_habits(uuid) from public;
revoke execute on function public.get_user_habits(uuid) from anon;

grant execute on function public.get_user_habits(uuid) to authenticated;
