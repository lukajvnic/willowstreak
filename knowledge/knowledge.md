the knowledge directory is for ai agents to store context about the project

## repo layout

- `web-app/` — vite + react 19 + ts. no router; `src/App.tsx` holds a `tab` state and the nav (`habits`, `to-do`, `leaderboard`, `social`, `avatar`).
- `backend/`, `ios-app/` — early, mostly empty.
- styling is one hand-written stylesheet, `web-app/src/index.css`. no css modules, no tailwind. class names are plain and global (`.panel`, `.heatmap`, `.cell`). colour ramps come in per-habit as css vars (`--c0`..`--c4`) set inline by `Heatmap`.
- the habits tab is live against the backend: `src/lib/auth.tsx` (supabase-js session + profile), `src/components/AuthGate.tsx` (login/signup/pick-username), `src/lib/habitsApi.ts` (one `include=entries` fetch, create, upsert-on-log). `Heatmap` takes `entries` + `onLog` props for real data and still falls back to the seeded mock series (`buildSeries`) when they're absent — friends' grids in `ProfileModal` and the leaderboard/social tabs stay mock. habit colour ramps are client-side only (localStorage by habit id, name-hash fallback).

## habits page

one `.panel` per habit, laid out top to bottom: title + type row, the grid, then a footer.
the footer is one line tall: the three stats in a row on the left (`streak` / then `average` +
`std deviation` for counted habits, or `done` + `rate` for yes/no ones) and a single-line
`HabitToday` card on the right — the only place you log a day. the whole card is the control
(no pencil icon): it renders as a `<button>` that toggles yes/no habits or opens the editor for
counted ones, and switches to a `<div>` only while editing, since an input can't live inside a
button. editing swaps the value for an inline input, so the card height never changes at 36px.
the `button.today` / `div.today` split in the css exists for that reason — keep both branches
in sync when restyling.

there is no box and no icon — it's bare text pinned to the right edge (`margin-left: auto`, so
it stays flush whatever the value's length, in every state). the entire affordance is one
underline on `.today-line`, spanning the label as well as the value: dashed at rest, solid in
the habit's ramp colour on hover and while editing. `.today-input` deliberately draws no
underline of its own, or you get two. that's the only edit cue there is, so don't soften it
without replacing it.

`.panel::before` is the diagonal shine. it used to slide across on hover — Luka asked for it
static 2026-08-19, so it is now a single rule with a fixed transform and no hover counterpart. modelled on a reference Luka gave 2026-08-19,
minus that reference's second journal line, which he asked to drop. there was briefly a
right-hand log column inside the panel before all this, and it should not come back.

sizing, all of it interlocking — change one and re-check the rest. `WEEKS = 52` (a full year),
default `cell` 14px, `--gap` 3px (the `cell > 14` ternary in `Heatmap` picks it — note 14 does
not trip it, and going to 15px jumps the gap to 5px and the panel past 1120px). that puts the
panel at 971px, so `.page[data-tab="habits"]` is widened to 1040px from the usual 910. `.stack`
is `width: fit-content`, so panels shrink-wrap the grid rather than stretching to the page;
below that the panel clamps to `max-width: 100%` and `.heatmap` scrolls horizontally. month
labels sit horizontally above the grid, one per week column with `overflow: visible` so a
label can spill into the next column.

`.heatmap` carries `padding: 3px` for a reason: the today ring is an *outset* box-shadow, and
`overflow-x: auto` clips at the padding box, so without it the ring gets shaved on whichever
edge today lands on (it lands on the last column most of the year). `.cell` radius is
`calc(var(--cell) * 0.26)` so cells don't turn into circles as they shrink.

clicking any past-or-today cell opens `DayPopover`, a small tooltip with that day's date and
its amount carrying the same dashed-underline edit affordance. `Heatmap` therefore holds edits
as `Record<dayIndex, amount>`, not a single today value — the today field and the popover both
write into it, so a day edited either way repaints its cell and moves the stats.

the popover is `width: max-content` and centre-aligned, so it hugs its text. that means it
cannot be clamped before it renders — `DayPopover` measures itself in a `useLayoutEffect`
(pre-paint, so no flash; it renders `visibility: hidden` for the one measuring pass) and sets
its own `left`. `Heatmap` only hands it the cell centre and the panel width. the clamp is
needed because `.panel` is `overflow: hidden` for the shine and would otherwise crop it — the
leftmost and rightmost columns both overflow when centred. the effect's deps include `editing`
and `value` for a real reason: swapping the value for the input grows it ~19px, and against
the right edge that overflows unless it re-clamps. vertically it always sits above the cell;
the top row has ~14px to spare, so don't add height without re-checking. future cells and
every cell in a `readOnly` grid are `disabled`.

cells are `<button>`s but carry `tabIndex={-1}` on purpose: 364 of them would otherwise be 364
tab stops. the today field is the keyboard path; the popover is pointer-only.

`src/lib/habits.ts` generates amounts, not just shades: `buildSeries` draws one noise value
per day and derives both the 0..4 cell level and a plausible amount in the habit's unit from
it, with the bands lined up so `levelFor(amount)` returns the level the cell is painted with.
`statsFor` only counts days up to today — the grid runs to the end of the current week, so it
does render a few future cells as logged. that's cosmetic, but worth knowing before trusting
a cell near the right edge.

`Heatmap` is reused inside `ProfileModal` at `weeks={24} cell={14}` and with `readOnly`, which
keeps the stats but drops the today card. it stays at 24 weeks on purpose — a year would need
~7px cells to fit the modal, which is unreadable. keep those props working.

## leaderboard

`src/components/Leaderboard.tsx` is one component with two stacked layers inside a fixed 392px
`.stage`: the ionic-column podium (top 3) and the full ranked list. `.slide-inner[data-view]`
slides one layer out and the other in; stepping between boards (`BOARDS` in
`src/lib/leaderboards.ts`) slides the whole stage sideways and resets the view to podium. the
podium is deliberately untouched design work — columns, shine sweep and sparkles are drawn as
one SVG per plinth so the effects clip to the silhouette.

the list (`RankList`) shows *every* entry on the board, not a slice. rows are transparent; the
ranking is carried by a `.rank-bar` span behind each row whose width is `value / leader` as a
percent (min 4%), gold-tinted for ranks 1-3. the list scrolls inside the same 392px frame under
an "all ranks / n people" hairline header, with a 56px bottom gradient in `--black` so it
dissolves rather than cuts. the signed-in user (`ME` from `src/lib/people.ts`, matched by name)
is highlighted in place with a "you" pill and centred on entry by setting `scrollTop` directly
in an effect keyed on `[view, board]` — `scrollIntoView` is avoided on purpose, it scrolls the
whole page and fights the slide transition.

worth knowing: `BOARDS` currently holds exactly 8 entries per board (one per person in
`PEOPLE`), so the list only scrolls by ~48px today. the frame, fade and centring are built for
a longer board and were verified against a padded 28-entry board.

## backend

`backend/` is FastAPI over Supabase — **no ORM, no direct Postgres connection**.
Every read and write goes through PostgREST via `supabase-py`, mirroring the
structure of `~/dev/Syllavise/backend`. Migrations live at `supabase/migrations/`;
full endpoint reference in `backend/README.md`.

`GET /api/habits?include=entries&from&to` returns every habit with its entries
embedded (PostgREST embedded select, one round trip) — that's the habits-page
load path; the per-habit entries route stays for single-habit use.

**v1 scope is users + habits + habit entries.** Friendships and leaderboards are
not in it. Note the frontend leaderboard page still runs on the mock
`BOARDS`/`PEOPLE` arrays; there is no server behind it.

**The split:** the browser talks to Supabase Auth *directly* for signup / login /
refresh (`@supabase/supabase-js`). Everything else goes browser → FastAPI →
PostgREST with `Authorization: Bearer <supabase access_token>`.

**Authorization lives in SQL, not Python.** Each request builds a *user-scoped*
client (`client.postgrest.auth(access_token)`), so Postgres evaluates `auth.uid()`
as the caller and the RLS policies in the migration are the boundary. Two things
follow: a table with RLS on and *no policy* returns `[]` silently rather than
erroring — so add a table and its policy together — and anything that must see
past RLS is an explicit `security definer` function with a narrow return.
`username_available()` is the only one (a caller genuinely can't see whether
someone else holds a name); `get_my_stats()` is `security invoker` so it inherits
the caller's policies and needs no user argument.

Services still call `.eq("user_id", ...)` on top of RLS — defence in depth, and it
turns an invisible row into a clean 404. Non-owners get 404, never 403.

**Layout:** `app/core/{config,supabase,auth,dependencies,errors}.py`,
`app/api/router.py`, and `app/modules/{users,habits,entries}/` each with
`routes → controller → service → schemas`. Services own every PostgREST call and
map `postgrest.APIError` onto the shared `ApiError`, which renders as
`{"error": {"code", "message", "details"}}`.

**Tables:** `public.users` (1:1 with `auth.users`; `username` `^[a-z0-9_]{2,20}$`,
`first_name`/`last_name`, `avatar_path`), `habits`, `habit_entries`.

**`habit_entries` is the entity the frontend never had.** `buildSeries()` in
`src/lib/habits.ts` still fabricates heatmap data from `Math.sin` noise. The table
has a surrogate `id` plus a unique `(habit_id, entry_date)` used as the upsert's
conflict target, so logging is one statement with no read-modify-write.

**Habit type/goal are strictly paired.** `type` is `completion` or `count`. A
`count` habit needs a positive goal; a `completion` habit must not have one.
Enforced by `ck_goal_matches_type` *and* mirrored in pydantic so violations are
422s. `PATCH` validates the merged row, since the constraint spans two columns.

**Dates:** `entry_date` is a bare `DATE` computed on the *client* in local time and
sent as `YYYY-MM-DD`; the server never derives it from its own clock. `keyOf()` in
`src/lib/todos.ts` already does this — reuse it rather than writing a second one.

**Tests: 41, no Docker and no Supabase project needed.** `test_api.py` drives the
real app with `dependency_overrides` swapping in an in-memory fake client
(`tests/fake_supabase.py`) that stores rows and enforces the migration's
constraints. `test_rls.py` runs the real migration against local Postgres as the
`authenticated` role with Supabase's JWT claims — the only place the authorization
boundary is genuinely tested. Its `test_harness_actually_applies_rls` guards the
guard: `SET LOCAL` outside a transaction is a silent no-op that would run
everything as the table owner and make every other assertion vacuous. Nothing
exercises real PostgREST, so smoke-test a live project before shipping.

**Local dev:** run on **port 8001** — 8000 is taken by the Syllavise backend.

## site/ — auth test harness (2026-08-19)

A third frontend, deliberately unstyled, for exercising the auth handshake end to
end before wiring it into `web-app/`. Vite + React 19 + `@supabase/supabase-js`,
pinned to **port 5173** because that origin is already in the backend's
`BACKEND_CORS_ORIGINS` — moving it means editing `backend/.env` too. Its `.env` is
generated from `backend/.env` (project URL + publishable key; the service role key
is never copied).

**It renders the two-owner split concretely:** Supabase Auth owns the credential,
the API owns the profile row. Signup is `auth.signUp()` then `POST /api/me` with
the returned token — *and the second half is conditional*, because with email
confirmation on, `signUp` returns a user but **no session**, so there is no token
to write the profile with. That path resumes at the next login, where a 404 from
`GET /api/me` triggers a username picker. Any client that treats that 404 as an
error will hard-fail every confirmed-email signup.

**Login takes an email, not a username.** Supabase Auth authenticates on email;
usernames live in `public.users`. Resolving username → email needs a public
endpoint that doesn't exist, and would leak which emails are registered. If
username-login is wanted, that's a backend decision (a `security definer` function
returning only the email for a given username, rate-limited) — not a frontend fix.

Every auth event and API call is logged on-page with the raw response body, which
is the whole reason the app exists.
