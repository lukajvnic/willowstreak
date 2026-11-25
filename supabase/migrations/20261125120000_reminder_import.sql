-- Reminders can be brought in from another calendar in one go. Two columns
-- make that safe to repeat and to take back:
--
-- source     where an imported reminder came from, e.g. 'gcal:<event id>'.
--            Unique per user, so running the same import again skips what's
--            already here instead of doubling it. Null for anything made by hand.
-- import_id  which run brought it in — every row of one import shares it, so
--            undoing that import is a single delete.

alter table public.reminders
  add column if not exists source text check (length(source) between 1 and 300),
  add column if not exists import_id uuid;

-- nulls are distinct, so hand-made reminders (source null) never collide
alter table public.reminders
  add constraint uq_reminder_source unique (user_id, source);

create index if not exists ix_reminders_import on public.reminders (import_id)
  where import_id is not null;
