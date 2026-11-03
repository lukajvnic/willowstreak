-- A repeating reminder is ticked off one occurrence at a time. The row keeps its
-- first start/end (it no longer rolls forward), and done_dates lists the start
-- day of each occurrence that's been ticked off. `done` stays for one-offs; a
-- repeating reminder leaves it false.

alter table public.reminders
  add column if not exists done_dates date[] not null default '{}';

-- a repeating reminder ticked off before this went in finished the whole series;
-- open it back up so every occurrence starts unticked
update public.reminders set done = false where repeat is not null and done;
