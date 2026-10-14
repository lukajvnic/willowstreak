-- Anchors were a point in time, drawn on the week grid as a fixed one-hour
-- block. They can now say how long they last: set when filing or editing,
-- or by dragging the block's bottom edge on the calendar.
--
-- Nullable rather than defaulted: null means "never given a length", which the
-- client draws as the old one-hour block, so existing rows don't change.

alter table public.reminders
  add column if not exists duration_minutes integer
    check (duration_minutes between 5 and 1440);
