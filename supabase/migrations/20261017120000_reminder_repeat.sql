-- Reminders can repeat, the way Apple Reminders' do: a rule, and optionally a
-- last day. The row keeps a single start/end — the current occurrence — and the
-- client draws the later ones on the calendar and rolls the row forward to the
-- next one when it's ticked off.
--
-- Both nullable: null repeat is a one-off, null repeat_until repeats forever.
-- daily and weekdays only make sense for a single day, so a floater (a window)
-- can't use them.

alter table public.reminders
  add column if not exists repeat text
    check (repeat in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly')),
  add column if not exists repeat_until date;

alter table public.reminders
  add constraint ck_reminder_repeat check (
    (repeat is null and repeat_until is null)
    or (kind = 'anchor' and repeat is not null)
    or (kind = 'floater' and repeat in ('weekly', 'biweekly', 'monthly', 'yearly'))
  );
