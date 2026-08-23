# willo api

FastAPI over Supabase. No ORM and no direct Postgres connection — every read and
write goes through PostgREST via `supabase-py`, the same shape as
`Syllavise/backend`.

Auth is **not** here: the browser talks to Supabase Auth directly and this
service verifies the token it gets back.

```
browser ──signup/login/refresh──> Supabase Auth        (@supabase/supabase-js)
   │
   └──everything else, Bearer <access_token>──> this API ──> PostgREST ──> Postgres
```

## v1 scope

Users, habits, and habit entries. Friendships and leaderboards are not in v1.

## Authorization lives in SQL

Each request builds a **user-scoped** client: the caller's access token is
attached to PostgREST, so Postgres evaluates `auth.uid()` as that user and the
**RLS policies in the migration are the authorization boundary.**

```python
client = get_supabase_client()
client.postgrest.auth(access_token)   # -> policies now apply as this user
```

This is the opposite of enforcing access in Python. Consequences worth knowing:

- **A missing policy means a silently empty result, not an error.** If a new
  table has RLS on and no policy, every query returns `[]` and the API looks
  broken rather than failing loudly. Add the table *and* its policy together.
- Services still call `.eq("user_id", user_id)` even though RLS already scopes
  the query. That's defence in depth, and it's what turns "invisible row" into a
  clean 404.
- Anything needing to see past RLS is an explicit `security definer` function
  with a deliberately narrow return. `username_available()` is the only one: it
  returns a bare boolean, because a caller genuinely cannot see whether someone
  else already holds a name.
- `get_my_stats()` is `security invoker` on purpose — it inherits the caller's
  policies, so it needs no user argument and can't be pointed at someone else.

Non-owners get **404, never 403** — a 403 would confirm the row exists.

## Layout

```
app/
├── main.py                 create_app()
├── api/
│   ├── router.py           aggregates module routers under /api
│   └── health.py
├── core/
│   ├── config.py           pydantic-settings
│   ├── supabase.py         anon / user-scoped / service-role client factories
│   ├── auth.py             CurrentUser, token verification + 60s cache
│   ├── dependencies.py     get_current_user_client
│   └── errors.py           ApiError + handlers
└── modules/
    ├── users/              routes -> controller -> service -> schemas
    ├── habits/
    └── entries/
```

`routes` declares HTTP and dependencies, `controller` unpacks `CurrentUser` into
primitives, `service` holds every PostgREST call and maps `postgrest.APIError`
onto `ApiError`, `schemas` holds the pydantic models.

## Setup

```bash
cp .env.example .env      # fill in SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
uv sync
uv run uvicorn app.main:app --reload --port 8001
```

Port 8001 because 8000 is taken by the Syllavise backend. Docs at `/docs`.

Apply the schema:

```bash
supabase db push
```

### Tests

```bash
uv run pytest
```

41 tests, no Docker and no Supabase project required:

- **`test_api.py`** (30) drives the real app through `TestClient` with
  `dependency_overrides` swapping in an in-memory fake client
  (`tests/fake_supabase.py`) that stores rows and enforces the migration's
  constraints. Covers routing, validation, error envelopes, and service logic.
- **`test_rls.py`** (11) runs against a local Postgres, applying the real
  migration and executing as the `authenticated` role with the JWT claims
  Supabase would set. **This is the only place the authorization boundary is
  actually tested**, since the fake has no concept of policies. Skipped
  automatically when psql isn't available.

One caveat: nothing here exercises real PostgREST. Query-builder mistakes that
the fake happens to tolerate would only surface against a live Supabase, so
smoke-test a real project before shipping.

## Dates — the one thing to get right

`habit_entries.entry_date` is a bare `DATE`, **always computed on the client in
the user's local zone** and sent as `YYYY-MM-DD`. The server never derives a date
from its own clock. Get this wrong and an entry lands on the wrong square for
everyone outside the host's timezone.

The frontend already has the right helper — `keyOf()` in
`web-app/src/lib/todos.ts` produces exactly this format and deliberately avoids
UTC round-trips.

## Endpoints

All under `/api`. Everything except `/api/health` needs
`Authorization: Bearer <supabase access_token>`; missing or invalid → **401**.

Errors share one envelope:

```jsonc
{"error": {"code": "habit_not_found", "message": "Habit not found", "details": null}}
```

### Me

```
GET   /api/me                              -> {user} | 404 profile_not_created
POST  /api/me   {username, first_name, last_name?, bio?}
                                           -> 201 {user} | 409 username_taken
PATCH /api/me   {first_name?, last_name?, bio?, avatar_path?}  -> {user}
GET   /api/me/stats                        -> {stats}
GET   /api/usernames/{username}/available  -> {"available": bool}
```

`404` on `GET /api/me` is **not an error** — it's how you know to show a username
picker after a first signup. Usernames are `^[a-z0-9_]{2,20}$`, stored lowercase;
render the `@` yourself.

```jsonc
{"user": {"id": "uuid", "username": "luka", "first_name": "Luka",
          "last_name": "J", "bio": "", "avatar": null, "avatar_path": null,
          "created_at": "2026-08-19T..."}}

{"stats": {"streak": 3, "best": 5, "tracked": 2}}
```

`streak` counts today **or** yesterday as live, so an unlogged today doesn't zero
a running streak. Entries with `value = 0` don't count toward one.

### Habits

```
GET    /api/habits           -> {habits: [...]}   (yours, unarchived)
POST   /api/habits           -> 201 {habit}
PATCH  /api/habits/{id}      -> {habit}
DELETE /api/habits/{id}      -> 204               (soft — entries survive)
```

```jsonc
// completion habit — did you do it at all
{"habit": {"id": "uuid", "user_id": "uuid", "name": "gym",
           "type": "completion", "goal": null, "unit": ""}}
// count habit — how much, against a target
{"habit": {"id": "uuid", "user_id": "uuid", "name": "push-ups",
           "type": "count", "goal": 100, "unit": "reps"}}
```

`type` ∈ `completion | count`, strictly paired with `goal`: a `count` habit
**must** have a positive goal, a `completion` habit **must not**. Violations are
**422 `habit_goal_type_mismatch`**, and `PATCH` validates the *merged* row —
flipping `type` to `completion` while a goal is still set is rejected. Send both
fields together to change it.

### Entries — the heatmap's data

```
GET    /api/habits/{id}/entries?from=YYYY-MM-DD&to=YYYY-MM-DD  -> {entries: [...]}
PUT    /api/habits/{id}/entries/{YYYY-MM-DD}   {value}         -> {entry}
DELETE /api/habits/{id}/entries/{YYYY-MM-DD}                   -> 204
```

```jsonc
// `value` is a STRING (postgres numeric over json) — Number() it.
{"entry": {"id": "uuid", "habit_id": "uuid", "entry_date": "2026-08-19",
           "value": "80", "created_at": "...", "updated_at": "..."}}
```

`PUT` upserts on `(habit_id, entry_date)` — one statement, no read-modify-write,
so two tabs can't lose each other's writes. Re-writing a day keeps the row's `id`
and bumps `updated_at`.

`DELETE` clears a day, which is different from `PUT {"value": 0}` — that records
a real zero.

To render a grid: request `from` = first cell's date, `to` = last cell's date,
build a `Map<dateKey, value>`, then decide each cell's level from
`map.get(key) ?? 0` against the habit's `goal`.

## Deploying

Fly.io or Railway both take the container and do custom domains for
`api.willo.app`. Set `BACKEND_CORS_ORIGINS=https://willo.app`.

There is no database connection string any more — the API reaches Postgres only
through PostgREST, so `SUPABASE_URL` plus the publishable key is the whole
config. Keep `SUPABASE_SERVICE_ROLE_KEY` out of anything client-facing; it
bypasses RLS and nothing in v1 needs it.

Sessions ride as `Authorization` headers, not cookies, so CORS runs with
`allow_credentials=False`.

## Changing the schema

The migration is the single source of truth now — there are no ORM models to
keep in sync. When you add a table, add its RLS policy in the same migration, or
every query against it will quietly return nothing.
