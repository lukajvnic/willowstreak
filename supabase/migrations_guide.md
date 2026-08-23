# Supabase Migrations Guide

How willo's database schema is versioned. Mirrors the workflow in
`Syllavise/supabase/migrations_guide.md`.

## What Migrations Are

Versioned SQL files describing changes to the database schema, in
`supabase/migrations/`. Each starts with a timestamp so they apply in order:

```text
20260819120000_init.sql
```

| Part | Meaning |
| --- | --- |
| `20260819120000` | Timestamp used for ordering |
| `init` | Human-readable name |
| `.sql` | Raw SQL that Postgres runs |

**Migrations are append-only once applied.** Never edit a file that has been
pushed — add a new one. There is no ORM and no model layer: these files are the
only description of the schema.

Commit `supabase/migrations/*.sql` and `supabase/config.toml`. Never commit
`supabase/.temp/` or `.env` files.

## The CLI

Installed as a devDependency in the repo root, so it's version-pinned per repo
rather than global:

```bash
npm install          # once, from the repo root
npx supabase --help
```

## Creating a Migration

```bash
npx supabase migration new add_habit_reminders
```

That creates `supabase/migrations/<timestamp>_add_habit_reminders.sql`. Write the
change into it:

```sql
alter table public.habits
  add column if not exists reminder_time time;
```

House style, following Syllavise: lead with a comment explaining *why* the change
exists — the constraint or bug it addresses — not what the SQL says.

### If the table is new, add its RLS policy in the same migration

This matters more here than in most projects. The API talks to Postgres through
PostgREST with a **user-scoped** client, so RLS is the authorization boundary. A
new table with RLS enabled and no policy returns an empty result to every query —
it looks like a bug in the API, not a permissions error.

```sql
create table public.example (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade
);

alter table public.example enable row level security;

create policy example_own_rows on public.example
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.example to authenticated;
```

## Applying Migrations

### To the linked remote project

```bash
npx supabase db push
```

Applies any local migrations the remote hasn't seen. This is the main path while
there's no local Docker stack.

### Verifying before you push

The backend test suite applies the full migration to a throwaway Postgres
database and then exercises the RLS policies as a real `authenticated` user:

```bash
cd backend && uv run pytest tests/test_rls.py
```

That covers "does this migration apply from scratch" and "do the policies
actually isolate users" without needing Docker. Run it after every schema change.

## Local Stack (needs Docker — not installed yet)

```bash
npx supabase start      # full local stack: API 54321, db 54322, Studio 54323
npx supabase db reset   # wipe local and replay every migration in order
npx supabase db diff --file <name>   # generate a migration from Studio edits
npx supabase stop
```

`db reset` is the canonical "does the whole history still work from scratch"
check. Until Docker is installed, `tests/test_rls.py` is the stand-in.

## Linking to the Remote Project

One-time, both interactive:

```bash
npx supabase login                          # opens a browser
npx supabase link --project-ref <ref>       # ref is in the dashboard URL
```

## Common Commands

| Command | What It Does | Docker? |
| --- | --- | --- |
| `npx supabase migration new <name>` | Creates a blank timestamped migration | no |
| `npx supabase db push` | Applies local migrations to the linked remote | no |
| `npx supabase migration list` | Shows local vs remote migration state | no |
| `npx supabase link --project-ref <ref>` | Links the repo to a hosted project | no |
| `npx supabase db pull` | Captures remote schema changes as a migration | no |
| `npx supabase start` / `stop` | Local stack up / down | yes |
| `npx supabase db reset` | Rebuilds local and replays all migrations | yes |
| `npx supabase db diff --file <name>` | Generates a migration from local changes | yes |

## Recommended Workflow

1. Pull the latest code.
2. `npx supabase migration new <name>`.
3. Write the SQL, plus RLS policies and grants if the table is new.
4. `cd backend && uv run pytest` — proves it applies from scratch and the
   policies hold.
5. Update `backend/README.md` if the API surface changed.
6. Commit the migration with the backend code that depends on it.
7. `npx supabase db push` when you're ready to apply it remotely.

## Current State

One migration: `20260819120000_init.sql`, defining `users`, `habits`, and
`habit_entries` with their RLS policies, plus the `get_my_stats()` and
`username_available()` functions.

It has **not** been pushed to a remote project yet, so it can still be edited in
place. The moment it is pushed, that stops — everything after is a new file.
