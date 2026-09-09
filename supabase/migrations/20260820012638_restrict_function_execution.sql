-- Lock down EXECUTE on the two helper functions.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, so the
-- `grant execute ... to authenticated` in the initial migration restricted
-- nothing. Anyone holding the publishable key — which ships in the browser
-- bundle and is meant to be public — could call username_available() directly
-- against PostgREST and get a true/false answer for any name. That is a
-- username enumeration oracle open to the internet, and it bypasses the API,
-- where the same check requires a signed-in caller.
--
-- get_my_stats() is security invoker, so an anonymous caller only ever got
-- zeroes back, but there is no reason for it to be callable either.
--
-- Note the ordering: revoking from PUBLIC also removes the implicit grant that
-- anon and authenticated inherit, so authenticated has to be granted back
-- explicitly afterwards.
--
-- If a pre-signup username check is ever wanted — checking availability before
-- the user has a session — that needs a deliberate `grant execute ... to anon`
-- and should be rate limited.

revoke execute on function public.username_available(text) from public;
revoke execute on function public.username_available(text) from anon;
revoke execute on function public.get_my_stats() from public;
revoke execute on function public.get_my_stats() from anon;

grant execute on function public.username_available(text) to authenticated;
grant execute on function public.get_my_stats() to authenticated;
