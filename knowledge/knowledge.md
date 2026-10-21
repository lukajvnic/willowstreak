the knowledge directory is for ai agents to store context about the project

## repo layout

- `web-app/` — vite + react 19 + ts. no router; `src/App.tsx` holds a `tab` state and the nav (`habits`, `to-do`, `leaderboard`, `social`, `avatar`).
- masthead (2026-10-13): absolutely positioned top row — `.brand` top-left (serif "willowstreak" with the tabs always visible in a row beside it, vertically centred on the wordmark via `align-items: center` — not baseline, which left them sitting low), account avatar `.me` top-right. the active tab is marked with an underline, not a filled background — a `::after` bar that scales in from the left (`transform-origin: left`) and out to the right when deactivated. `.brand` wraps, so on phones the tabs drop to a second line; `.page` top padding reserves room for it. the login screen (`AuthGate`) still uses the old centred `.wordmark` "willo".
- to-do tab (2026-10-13): the calendar is the main focus — the page is full-width (`max-width: none`) and `.todo` fills the viewport height (reminders list 340px on the left, calendar takes the rest; both scroll internally). (2026-10-16) the only grey card on the tab is `.cal-body`, which wraps the calendar's days (the month grid, or the week's heads, all-day band and hours). the calendar heading (arrows, title, day/week/month) and the reminders list sit straight on the page. the sticky `.col-heads` / `.band` are filled with `--dune` to match the card. the list can be folded away with the chevron (`.fold-btn`) next to +. `.todo[data-collapsed]` then gives the calendar the width, and a full-height `.reminders-rail` (chevron, vertical "reminders", open count) takes the list's place; the whole rail is the button that opens it again. under 1080px the rail lies flat under the calendar. whether it's folded is kept in localStorage `willo:reminders-collapsed`. `.reminders[hidden]` needs its own `display: none`, because `display: flex` beats the hidden attribute. the week view is a plain 24h hour grid: one shared `.day-axis` plus seven equal fixed-width `.col`s, each always showing its `.day-timeline` of timed anchors; it opens scrolled to ~2h before now. untimed anchors go in the all-day band with the floaters. the old hover pop-out (`.day-preview` / `.day-detail`) and the week stats strip were removed.
- editing reminders: clicking a reminder's text (or its pencil, shown on hover) reopens `AddReminder` with `initial` set — same dialog, prefilled, "save changes" instead of filing straight away on refile/backlog. it saves through `PUT /api/reminders/{id}` (`ReminderEditRequest`), a full rewrite of the shape fields that shares create's per-kind validation via `ReminderShape`; `done` is untouched (it keeps its own `PATCH`). switching kind clears the dates/time the new kind doesn't use.
- anchor length (2026-10-13): `reminders.duration_minutes` (migration `20261013160000_reminder_duration.sql`, nullable, 5–1440; null = drawn as the default 1h). set in the dialog's "lasts" h/m field, or by dragging the bottom strip (`.event-stretch`) of a block on the week grid — snaps to 15 min, can't pass midnight, saves on release via the same `PUT` edit. the backend leaves `duration_minutes` out of the write when it's null, and the client only sends a length for a reminder that has/had a custom one, so everything else keeps working on a database without the migration; only setting a length needs it.
- reminder alerts (2026-10-16): each anchor has its own alert, stored as `reminders.alert_minutes` (migration `20261016120000_reminder_alert.sql`). it's nullable: null means no alert, 0 means "at start", and the most it can be is 1440 (a day before). you set it from the "alert" dropdown in `AddReminder`, which sits next to "lasts"; picking an alert asks the browser for notification permission, since that only works from a click. reminders with an alert show a small bell after their title (`.reminder-alert`), and hovering it says when. in the tools row, an "enable alerts" / "alerts blocked" chip shows only when some open anchor has an alert but this browser can't show it yet. on the client, `alert` is `undefined` for "never had one" and `null` for "turned off": an edit sends `alert_minutes` (null included) only for a reminder that has or had an alert, and the backend writes it only when it's in `model_fields_set`. that way turning an alert off really clears it, and everything else still saves on a database without the column. a create without an alert leaves the field out. the alerts themselves come from `src/lib/notify.ts`, using the browser Notification API with no push server, so they only fire while willo is open in some tab. `useReminderAlerts` runs in App, so alerts fire whichever tab you're on. every 15s it reads reminders from the preload cache (`KEYS.todos`), and it re-fetches them every 5 min. an alert more than 5 min late is skipped. alerts already sent are remembered in localStorage `willo:notified`, under the reminder's id plus its date, time and alert, so moving an anchor or changing its alert sets it up again. clicking an alert switches to the to-do tab.
- repeating reminders (2026-10-17): stored as `reminders.repeat` (daily | weekdays | weekly | biweekly | monthly | yearly) plus `repeat_until` (a date, or null to repeat forever), from migration `20261017120000_reminder_repeat.sql`. both anchors and floaters can repeat, but a floater only on a weekly-or-longer rule (`ck_reminder_repeat`, mirrored in `ReminderShape`). the row always holds the current occurrence. `occurrenceOn(r, key)` in `lib/todos.ts` works out every later one, and `covers()` goes through it, so the calendar, the day filter and the band all show repeats without any extra handling. monthly dates clamp to the month's last day (jan 31 → feb 28), and day counts go through UTC noon so a daylight-saving change can't knock them off. ticking off a repeating reminder works like Apple's: the row moves to `nextOccurrence` through the normal `PUT` edit and stays not done, and once the next date would pass `repeat_until`, ticking marks it done. the band draws one chip per occurrence on screen (`bandChips`). alerts check occurrences from yesterday to 2 days out, and remember sent ones per occurrence day. on the client, `repeat` is undefined / null in the same way as `alert`, and the backend writes `repeat` / `repeat_until` only when they're in `model_fields_set`.
- drag to create + new when-pickers (2026-10-20): on the week grid, pressing an empty stretch of a day and pulling draws a dashed `.event-sketch` block (15-min snap, can't pass midnight, pulling upward works too); a plain click drops the default hour on the clicked slot. letting go opens `AddReminder` with a `Preset` (day, time, length) and kind already set to anchor, so typing a title and pressing enter files it. mouse/pen only — a touch on the grid still scrolls. the dialog's date/time/length fields live in `components/WhenFields.tsx`: `DateField` shows "thu, oct 22 · in 2 days" and opens a notion-calendar-style popover: a box you type into (`parseDate` in `lib/todos.ts` reads "fri", "next fri", "in 3 days", "oct 22", "22 oct", "10/22", "22"; a date with no year is the next one coming), a month grid with ‹ › and "today", today's number in red, the picked day filled white, and a floater's window shaded across both its fields' months (`range`). arrows move a day/week, enter picks, escape closes just the popover, a click outside closes it. `min` greys out earlier days; `onClear` adds a "clear" row (used by "end repeat", empty = forever); `align="end"` pins it to the right edge for right-column fields. `TimeSelect` is a typeable combobox (`parseTime` in `lib/todos.ts` reads "10a", "930pm", "21:15", "noon") with a 15-min list. anchors pick start – end (the end list labels each option with its length; moving the start keeps the length) plus length chips 15m–3h; quick chips for days (today / tomorrow / next mon) and floater windows (this week / next week / next 2 weeks / this month). the old h/m number inputs are gone. alert and repeat are `MenuSelect`s (same file) instead of native selects: a face like the date's with a chevron, opening a grouped menu with a ✓ on the current choice, keyboard ↑ ↓ enter / escape. each option carries a hint worked out from the dialog's day and start time — an alert shows when it goes off ("9:45am", "10:00am the day before"), a repeat where it lands ("on thu", "on the 22nd", "on oct 22"; "from …" for a floater, "mon – fri" for weekdays).
- migrations on the live database: `duration_minutes` (10-13), `alert_minutes` (10-16) and `repeat` (10-17) were missing from 2026-10-17 until 2026-10-20, so custom lengths, alerts and repeats failed to save. a write naming a missing column fails with PostgREST `PGRST204`, which the reminders service reports as a 503 with code `database_migration_missing`. applied 2026-10-20 with `npx supabase db push`; `npx supabase migration list` showed every local migration on the remote afterwards. the CLI is now logged in and linked to project `tkdnnntsskckgbdqenzv`. nothing applies migrations automatically: run `db push` whenever a new one lands, or the tests (fake Supabase / fresh local Postgres) will pass while the live database lags. on Windows PowerShell, `npx` is blocked by the execution policy, so use `npx.cmd` or cmd; `supabase login` needs a real terminal, not the `!` prompt. `backend/.env` has a placeholder `SUPABASE_SERVICE_ROLE_KEY` (`local-ser…`), so admin scripts can't reach the database. the Notion assessment import (yoyophopho, 30 anchors) went through the app API using the browser session instead.
- tab preloading (2026-10-14): `src/lib/preload.ts` is a small shared cache (`preload` joins in-flight loads and reuses data <15s old; `peek`, `remember`, `invalidate`, `forget`, `forgetAll`; `usePreloaded` hook = cached copy first, fresh copy behind it). `src/lib/pageData.ts` holds the cache keys and each tab's loader. once the habits load, App warms leaderboard / to-do / social data on `requestIdleCallback`, again on nav hover/focus, and warms leaderboard + feed avatar photos via `new Image()`. Todo writes its local edits back with `remember` so returning to it doesn't flash old data; logging a habit `invalidate`s the leaderboards; sign-out calls `forgetAll`. `useActivity` polls through the same cache (key `activity:<limit>`).
- `backend/`, `ios-app/` — early, mostly empty.
- styling is one hand-written stylesheet, `web-app/src/index.css`. no css modules, no tailwind. class names are plain and global (`.panel`, `.heatmap`, `.cell`). colour ramps come in per-habit as css vars (`--c0`..`--c4`) set inline by `Heatmap`.
- the habits tab is live against the backend: `src/lib/auth.tsx` (supabase-js session + profile), `src/components/AuthGate.tsx` (login/signup/pick-username), `src/lib/habitsApi.ts` (one `include=entries` fetch, create, upsert-on-log). `Heatmap` takes `entries` + `onLog` props for real data and still falls back to the seeded mock series (`buildSeries`) when they're absent — friends' grids in `ProfileModal` and the leaderboard/social tabs stay mock. habit colour ramps are client-side only (localStorage by habit id, name-hash fallback).

## habits page

one `.panel` per habit, laid out top to bottom: title + type row, the grid, then a footer.
the footer is one line tall: two stats in a row on the left (`streak` then `average` for
counted habits, or `done` for yes/no ones — Luka dropped `rate` and `std deviation` 2026-10-16) and a single-line
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

sizing (2026-10-14): the habits page is up to 1600px wide and its `.stack` is full width; each
`Heatmap` there gets `fit`, which measures `.heatmap` with a ResizeObserver (layout effect, so
no jump) and picks the biggest cell that fits 52 weeks plus the label column (`fitCell`,
14–28px). the gap is `floor(cell * 0.22)` — floored so 51 gaps can't overshoot the fitted
width. labels and text scale through `--label` / `--text` css vars (slower than the cells:
0.6× and 0.5× of the growth); both default to 1, so profile grids (no `fit`) are unchanged.
the activity bubbles now only show above 2180px, the width that leaves ~290px of margin a
side next to a 1600px page.

years (2026-10-14, curved 2026-10-16): a 52-week grid always straddles two years.
`newYearIndex(dates)` finds jan 1's cell and `yearSeamPath` turns it into one svg path
(`.year-seam`, absolutely positioned over `.grid`): down the gap after dec 31's column, across
the gap above jan 1, down the gap before jan 1's column. Luka asked for the two bends to be
curved — they're arcs of radius `cell * 0.26 + gap / 2`, concentric with the cells' own
rounded corners. jan 1 on a sunday is a single straight line; jan 1 in the last column skips
the upper run. stroke is white at 0.14 — Luka asked for it darker than the original 0.24. the new year's number (`.year-tag`) is placed by
`Heatmap` under the line's bottom end, and `.heatmap[data-seam]` adds bottom padding, since
its `overflow-x: auto` would clip it. the older year isn't labelled; it's implied. month
labels carry no year. the hover tip's date carries the year.

habits page has no boxes (2026-10-16): Luka asked for the grids to sit on the page background,
modelled on a wealthsimple screenshot where the main chart has no card and only the small side
widgets do. so `.page[data-tab="habits"] .panel` drops background, border, radius, shadow and
the shine, and habits are split by a `var(--line)` hairline (`.panel + .panel`). the page gets
`padding-inline: clamp(16px, 8vw, 160px)`. this is scoped to the habits tab — `.panel` keeps
its box everywhere else (profile modal grids). the shine notes below only apply there now.

centred grids (2026-10-16): `WEEKS` is now **44**, not 52 — Luka wanted fewer columns and more
margin. a `fit` Heatmap measures the *panel* (not `.heatmap`, whose width now follows the
cells — measuring it would loop) and `fitCell` sizes cells to leave the label column's width
(`leadFor`) free on *both* sides. when the labels fit to the left it sets `data-centred` plus
`--grid-w` / `--lead` / `--left`: title row, footer and the divider hairline (`::after`) are
exactly the cells' width and start at the first column; the day labels hang into the margin.
too narrow for that (phones), it falls back to the old full-width scrolling layout.
future cells (after today) are no longer rendered at all — in every grid, profile ones too.

cells (2026-10-14): hovering any cell shows `DayPopover` in `mode="tip"` — date plus "done" /
"not done" or "25 pushups", `pointer-events: none`. clicking a past-or-today cell of a yes/no
habit flips it straight away (no popover); of a counted habit it opens `DayPopover` in
`mode="edit"` with the amount field focused and selected — enter or blur saves and closes,
escape closes without saving (unmounting doesn't fire blur). `Heatmap` holds edits as
`Record<dayIndex, amount>`, not a single today value — the today field, the flip and the
popover all write into it, so a day edited any way repaints its cell and moves the stats.

the popover is `width: max-content` and centre-aligned, so it hugs its text. that means it
cannot be clamped before it renders — `DayPopover` measures itself in a `useLayoutEffect`
(pre-paint, so no flash; it renders `visibility: hidden` for the one measuring pass) and sets
its own `left`. `Heatmap` only hands it the cell centre and the panel width. the clamp is
needed because `.panel` is `overflow: hidden` for the shine and would otherwise crop it — the
leftmost and rightmost columns both overflow when centred. the effect's deps include `mode`
and `value` for a real reason: the tip's text changes width as values change, and against the
right edge that overflows unless it re-clamps. vertically it always sits above the cell;
the top row has ~14px to spare, so don't add height without re-checking. future cells and
every cell in a `readOnly` grid are `aria-disabled`, not `disabled` — a disabled button gets no
pointer events, and those cells still need the hover date.

that hidden pass is also why the edit field can't use `autoFocus` (2026-10-16): it fires on
the first render, while the popover is still hidden, and browsers won't focus a hidden
element, so clicking a counted cell used to leave the field unfocused. `DayPopover` instead
focuses the input in an effect once `left` has been set.

editing habits (2026-10-16): a pencil (`.panel-edit`) sits top-right of each of your own
habits, after the meta text in `.panel-side`, always visible (Luka moved it off the name and
dropped the hover-only fade); a -3px margin puts the icon on the last column's edge. it opens `EditHabit`, which uses the same
`new-*` classes as the new-habit dialog: name, goal + unit for counted habits, colour, and
"delete habit" (`.new-delete`). delete needs a second click to confirm, done in the page,
not with `confirm()`. you can't switch a habit between yes/no and a number, because its
entries were logged as one or the other. saves go through `PATCH /api/habits/{id}` and
deletes through `DELETE /api/habits/{id}`, which archives the habit and keeps its entries.
App applies both to the page right away, without waiting for the server, and refreshes the
leaderboards afterwards. colour is still localStorage only (`saveRamp`).

cells are `<button>`s but carry `tabIndex={-1}` on purpose: 364 of them would otherwise be 364
tab stops. the today field is the keyboard path; the cell hover/click is pointer-only.

`src/lib/habits.ts` generates amounts, not just shades: `buildSeries` draws one noise value
per day and derives both the 0..4 cell level and a plausible amount in the habit's unit from
it, with the bands lined up so `levelFor(amount)` returns the level the cell is painted with.
`statsFor` only counts days up to today. the grid's dates still run to the end of the current
week, but `Heatmap` stops drawing cells at today, so the last column is short.

`Heatmap` is reused inside `ProfileModal` at `weeks={24} cell={14}` and with `readOnly`, which
keeps the stats but drops the today card. it stays at 24 weeks on purpose — a year would need
~7px cells to fit the modal, which is unreadable. keep those props working.

## new habit dialog

two pieces, reworked twice on 2026-10-13 at Luka's request (first as in-dialog
tabs, then as this — the tabs are gone and should not come back).

`NewHabitMenu.tsx` is a round plus button at the *bottom* of the habits tab — the to-do
tab's `.add-btn` reused as-is (aria-label "create new habit"), lit and rotated while open —
(it replaced the old "last n weeks" footnote 2026-10-16, so the grids start right under
the masthead) plus the menu it opens — upward, via `bottom:` and a `rise-in` animation,
since it's the last thing on the page: `custom`, `preset`, `join a friend`, each with an inline svg to its left
(pencil, four grid cells, two people — hand-drawn 24px strokes like every other
icon here, there is no icon library). it closes on outside mousedown and escape,
the same way `Heatmap` closes its popover. `.add-menu` is centred over the link
by a fixed width, not a transform, because `rise-in` animates transform.

picking an option opens `NewHabit.tsx` with that `mode` as a prop (`App` holds
`adding: Mode | null`). the dialog shows only that one pane, titled for it, with
no way to switch — close and reopen for another. the panes: the form (`custom`),
`PRESETS` from `src/lib/habits.ts` (`presets`), or account search then that
account's habits (`copy`, labelled `join a friend` — it still copies the
definition, there is no shared habit).

a preset or a friend's habit is **created as picked**. clicking a row only
selects it (`data-active`, an inset ring in the chosen ramp colour); it never
loads the custom form — Luka did not want that. the footer is the same on all
three: the colour row (the only place a colour is ever chosen, so presets need it
too), `create habit`, and beside it either "you already track that" (custom) or
what is picked ("gym preset", "running from @maya"). `draft` in the component is
whatever the button would create right now; null disables it. clearing the
account clears the pick. rows for a habit you already track are disabled and
read `tracking`.

the modal sizes to its content and is vertically centred by `margin-block:
auto` (Luka tried a fixed 600px height first and dropped it the same day). auto
margins and not `align-items: center`, so a window too short for it scrolls from
the top. `max-height: max(100%, 400px)` stops it at the scrim's padding;
`.new-pane` is the piece that gives then — lists scroll inside it, the colour
row and button stay put. so the `join a friend` dialog grows and shrinks as
results come and go, which is intended. the body is a `<form>` in every mode:
enter in the search box can't create anything because no habit is picked while
that box is on screen.

the `join a friend` search and the social tab's search are the same pieces:
`useAccountSearch` (`src/lib/usersApi.ts`), `SearchField`, `AccountList`. once an
account is picked the search pill is reused as a chip showing who it is, with ×
to go back. your own account is filtered out of the copy results.

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

Account search: `GET /api/users?search=<prefix>` (username startswith, security
definer rpc `search_users`) and `GET /api/users/{id}/card` (public profile +
streak/best/tracked via `get_user_card`, deliberately no habit names/entries).
Social tab's search box is wired to these; clicking a hit opens ProfileModal
with the real card. Migration `20260909100000_account_search.sql`.

Copying a habit: `GET /api/users/{id}/habits` (security definer rpc
`get_user_habits`, migration `20261013120000_user_habits.sql`) returns another
account's unarchived habits as `{name, type, goal, unit}` only. Added 2026-10-13
at Luka's request for the new-habit dialog — it is the first and only place
habit names leave their owner, so any signed-in user can now read what any
account tracks. The card (`get_user_card`) still carries no habit names.

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


## hosting

Vercel, two projects off github `lukajvnic/willowstreak` (repo was renamed from
`willo`; local remote updated). Every push to main auto-deploys production.

- `willo-api` — root `backend/`, FastAPI as a python serverless function
  (`backend/api/index.py` exposes the app, `backend/vercel.json` rewrites all
  paths to it, `backend/requirements.txt` exported from uv.lock because the
  builder doesn't read pyproject). env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
  ENVIRONMENT, BACKEND_CORS_ORIGINS (frontend url).
- `willo` — root `web-app/`, zero-config vite build. env: VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY, VITE_API_URL (api url).
- supabase auth Site URL must point at the hosted frontend or confirmation
  emails redirect to localhost.
- domain `willowstreak.com` (bought 2026-10-21) is on the `willo` frontend project
  next to `willo-ochre.vercel.app`; the api is `willo-api.vercel.app`. production
  `BACKEND_CORS_ORIGINS` on `willo-api` is
  `https://willo-ochre.vercel.app,https://willowstreak.com,https://www.willowstreak.com`.
  it's a *sensitive* env var, so its value can't be read back — overwrite it in full,
  and redeploy, since env changes only land on a new deployment. preview's copy was
  left as it was. the Vercel MCP connector has no access to this team; the CLI does.
