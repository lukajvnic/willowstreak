-- reminder categories get a colour (the calendar draws reminders in it) and can
-- be edited or removed — the five built-in ones included.
--
-- the built-ins (school, work, exercise, chores, health) still live in the
-- client, and reminders point at them by slug. editing or removing one stores
-- an override row here, keyed by `builtin`: its name / icon / colour replace the
-- client's, and `hidden` drops it from the list.

alter table public.reminder_categories
  add column color   text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  add column builtin text check (builtin in ('school', 'work', 'exercise', 'chores', 'health')),
  add column hidden  boolean not null default false;

-- one override per built-in per user. a plain unique constraint (not a partial
-- index) so PostgREST can upsert on it; nulls stay distinct, so your own
-- categories are unaffected
alter table public.reminder_categories
  add constraint uq_reminder_category_builtin unique (user_id, builtin);
