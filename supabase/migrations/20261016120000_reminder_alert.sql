-- An anchor can ask for a desktop alert some minutes before it starts. Set per
-- reminder in the filing/editing dialog; the web app fires it while it's open.
--
-- Nullable rather than defaulted: null means "no alert", so existing rows stay
-- quiet. 0 is "at start"; the cap is a day ahead.

alter table public.reminders
  add column if not exists alert_minutes integer
    check (alert_minutes between 0 and 1440);
