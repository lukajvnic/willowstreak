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

Users (with avatars), habits, habit entries, leaderboards, an activity feed,
reminders, and friends. Friendship is what gates the social reads: your
leaderboards, your feed and someone's habits only ever include you and your
friends. Search and the profile card stay open to every signed-in user.

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
  with a deliberately narrow return. `username_available()` returns a bare
  boolean, because a caller genuinely cannot see whether someone else already
  holds a name. `search_people()`, `get_user_card()`, `get_user_habits()`,
  `get_user_grids()`, `get_leaderboards()` and `get_activity()` are the social
  reads: each exists to show the caller a named slice of other people's rows.
  Search and the card cover every account; the habits, grids, leaderboards
  and feed are limited to `my_circle()` (the caller plus accepted friends,
  migration `20261021130000_friends_only.sql`). `get_friendships()` returns the
  caller's own friendships with the other person's public profile, and
  `get_suggestions()` walks the friendship graph (migration
  `20261023120000_social_redesign.sql`).
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
    ├── entries/
    ├── social/
    ├── reminders/
    └── friends/
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

101 tests, no Docker and no Supabase project required:

- **`test_api.py`** (67) drives the real app through `TestClient` with
  `dependency_overrides` swapping in an in-memory fake client
  (`tests/fake_supabase.py`) that stores rows and enforces the migration's
  constraints. Covers routing, validation, error envelopes, and service logic.
- **`test_rls.py`** (34) runs against a local Postgres, applying the real
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
PATCH /api/me   {first_name?, last_name?, bio?, avatar?, avatar_path?}  -> {user}
GET   /api/me/stats                        -> {stats}
GET   /api/usernames/{username}/available  -> {"available": bool}
GET   /api/users?search=<q>&limit=6         -> {users: [...]}  (name or username, ranked)
GET   /api/users/{id}/card                  -> {card}  (public profile + streak/best/tracked)
GET   /api/users/{id}/habits                -> {habits: [{name, type, goal, unit}]}
GET   /api/users/{id}/habits?include=entries&from=YYYY-MM-DD&to=YYYY-MM-DD
                                            -> {habits: [{..., entries: [{entry_date, value}]}]}
```

Search matches the full name or the username, any case, anywhere in it; a
leading `@` is ignored and you're never in it. `search` is 1–40 characters,
`limit` 1–20 (default 6). Ranked: the name starts with it, then a word of the
name does, then the username does, then it's somewhere inside; ties go friends,
requests to you, requests from you, everyone else, then most mutual friends.
Each hit carries `relation` (`friends` | `incoming` | `outgoing` | `none`) and
`mutual_friends`.

`/users/{id}/habits` is someone's unarchived habits, definition only — no ids.
The new-habit dialog copies from it. With `include=entries` it also carries a
window of days, which is what a profile draws its grids from (your own
included). **Friends only:** for anyone else, and for an unknown id, it's an
empty list. The card has no habit names, so it stays open.

**Avatars.** `avatar` is the drawn figure, `{skin: "#RRGGBB", head, shirt}` with
`head`/`shirt` being item ids from the frontend's kit. `avatar_path` is the
uploaded head photo: a path in the public `avatars` Storage bucket. The browser
uploads the file itself (supabase-js, the caller's session — the one write that
doesn't come through this API) and then `PATCH`es the path here. Storage RLS
only allows writes under a folder named after your user id, and the API rejects
a path outside that folder with **422 `avatar_path_not_yours`**. `null` clears
it. Search hits, cards, leaderboard rows and activity items all carry both
fields, so a client can draw anyone.

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

### Social

```
GET /api/leaderboards?today=YYYY-MM-DD&week_start=YYYY-MM-DD  -> {boards: [...]}
GET /api/activity?limit=20                                     -> {activity: [...]}
```

```jsonc
{"boards": [{"habit": "gym", "type": "completion", "unit": "",
             "entries": [{"user": {"id": "uuid", "username": "sam", "first_name": "Sam",
                                   "last_name": "R", "avatar": null, "avatar_path": null},
                          "value": "4"}]}]}

{"activity": [{"id": "uuid", "user": {...}, "habit": "reading", "type": "count",
               "unit": "min", "value": "45", "entry_date": "2026-10-13",
               "logged_at": "2026-10-13T18:02:11Z", "streak": 7,
               "milestone": true, "personal_best": false}]}
```

**Leaderboards:** one board per habit *the caller* tracks, ranking the caller and
their friends with an unarchived habit of the same name (`habits.name_key` —
lowercased, trimmed). Two people with the same habit see different boards unless
they have the same friends; with no friends on it, a board is just you.
A `completion` board ranks by current streak in days; a `count` board by the
total for the week starting `week_start`, and only among people counting in the
same unit. Entries arrive ranked, at most 100 a board, and people at zero are
included. Both dates are the client's local dates: `week_start` must be within
the six days before `today` or it's **422 `week_start_out_of_range`**.

**Activity:** the most recent logged days from the caller's friends,
newest first, `limit` 1–50. A recorded zero isn't included. `id` is the entry's
id, so a polling client can tell what it has already shown. `streak` is the run
of logged days of that habit ending on `entry_date`; `milestone` is a streak of
7, 14, 30 or 50, or a multiple of 100; `personal_best` marks the day a streak
passed the habit's previous longest.

**Realtime ping.** Logging a day (insert, or a changed `value`) broadcasts
`{entry_id}` as event `activity` on the private Realtime topic `feed:<friend id>`
for each of the logger's friends, from the trigger `trg_entries_ping_feed`.
Private and archived habits and zero values don't ping. A policy on
`realtime.messages` lets each user listen on their own topic only. The browser
subscribes with supabase-js and re-reads `/api/activity` when one arrives; the
ping carries no habit data.

### Reminders — the to-do tab

```
GET    /api/reminders                 -> {reminders: [...], categories: [...]}
POST   /api/reminders                 -> 201 {reminder} | 409 reminder_exists
PATCH  /api/reminders/{id}  {done}    -> {reminder}
DELETE /api/reminders/{id}            -> 204
POST   /api/reminder-categories  {id?, name, icon?}  -> 201 {category}
```

```jsonc
{"reminder": {"id": "uuid", "title": "dentist", "kind": "anchor", "done": false,
              "start_date": "2026-11-02", "end_date": null, "at_time": "09:30:00",
              "place": "king st", "category_id": "health"}}
```

`kind` decides the shape, enforced by `ck_reminder_dates` and mirrored in
pydantic (**422**): `refile`/`backlog` carry no dates; a `floater` needs
`start_date` and `end_date`; an `anchor` needs `start_date` and may have
`at_time`. **`id` is optional and normally sent by the client** — the tab draws
the row before the request returns, and a client-made id means that row is
already the saved one; replaying a create is a 409, not a duplicate.
`category_id` is plain text: either a built-in slug the client owns (`work`,
`health`...) or the id of one of the caller's `categories`.

### Friends

```
GET    /api/friends                            -> {friends, incoming, outgoing}
POST   /api/friends/requests/{user_id}         -> 201 {friendship} | 200 if it accepted theirs
POST   /api/friends/requests/{user_id}/accept  -> {friendship} | 404 request_not_found
DELETE /api/friends/requests/{user_id}         -> 204 | 404 request_not_found
DELETE /api/friends/{user_id}                  -> 204 | 404 friend_not_found
GET    /api/friends/suggestions?limit=3        -> {suggestions: [...]}
POST   /api/friends/suggestions/{user_id}/dismiss  -> 204 | 404 user_not_found
```

```jsonc
{"friends":  [{"user": {"id": "uuid", "username": "sam", ...}, "since": "2026-10-21T...",
               "mutual_friends": 2}],
 "incoming": [...], "outgoing": [...]}

{"suggestions": [{"user": {...}, "hop": 2, "mutual_friends": 3,
                  "via": {"username": "phoenix", "first_name": "Phoenix", "last_name": "H"}}]}

{"friendship": {"requester_id": "uuid", "addressee_id": "uuid", "status": "pending",
                "created_at": "2026-10-21T...", "accepted_at": null}}
```

LinkedIn-style: one `friendships` row per pair, `pending` until the person
asked accepts it, then `accepted` both ways. Everything is keyed by the other
person's user id. `since` is when it was accepted, or when the request was sent
while it's pending.

- Sending to someone who already asked you accepts theirs (**200**, not 201).
- Sending again, or to a friend, is **409 `friendship_exists`**; to yourself
  **422 `cannot_friend_yourself`**; to an unknown id **404 `user_not_found`**.
- `DELETE /friends/requests/{id}` declines theirs or cancels yours. Declining,
  cancelling and unfriending all delete the row, so either person can ask again.
- RLS: only the two people see the row and either can delete it; only the person
  asked can accept; the pair columns can't be updated at all.

**Suggestions** ("people you may know") are nearest on the friendship graph
first: friends of your friends (`hop` 2), most mutual friends first, then their
friends (`hop` 3), most connecting paths first. Shared habits only break ties
and are never returned. Nobody further than three hops, nobody you're friends
with or have a pending request with either way, and nobody you've dismissed.
`via` is a friend of yours on the path, for a reason line. Dismissing is
permanent and idempotent; yourself is **422 `cannot_dismiss_yourself`**.

### Habits

```
GET    /api/habits           -> {habits: [...]}   (yours, unarchived)
GET    /api/habits?include=entries&from=YYYY-MM-DD&to=YYYY-MM-DD
                             -> {habits: [{..., entries: [...]}]}  (one round trip)
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

`private` (default `false`, set on `POST` only) keeps a habit to its owner: the
social reads skip it for everyone else, and it's on no leaderboard, its owner's
included.

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
`api.willo.app`. Set `BACKEND_CORS_ORIGINS=https://willo.app,https://willowstreak.com,https://www.willowstreak.com`.

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
