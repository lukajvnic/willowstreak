# google calendar → willowstreak — plan

written 2026-11-25, revised the same day after Luka said a **one-time port is
fine**: the user brings their google calendar over once, then lives in the
willowstreak calendar. nothing is built yet.

the first draft of this plan proposed a live read-only link. a one-time port is
a different and much smaller thing, so most of that draft is gone. what's left
of it is under "what we're not doing".

## the short version

- **an import, not a link.** google events are copied in once and become real
  willowstreak reminders the user can edit, tick off and repeat like any other.
- **nothing of google's is kept.** the browser gets a read-only pass from google
  that lasts about an hour, reads the calendar, and throws the pass away. no
  tokens in our database, no google code in the backend, no sync job, no webhook.
- **two ways in, one import behind them:** an "import from google" button (the
  easy path), and a calendar-file upload (works without google's approval, and
  for apple / outlook calendars too).
- **it lives on the to-do page**, as an action, not a setting.
- **the real work is the translation**, not the plumbing: google's events have
  to be turned into anchors and floaters, and some don't fit.
- **the decision this forces on the to-do redesign:** imported events aren't
  to-dos. a week of lectures shouldn't become 15 open tick boxes.

## why a one-time port is the right call for this app

- willowstreak's calendar is meant to be where the user plans, with reminders,
  floaters and habits next to each other. a live mirror of google keeps google
  as the real calendar and makes ours a viewer.
- a mirror means storing google tokens, a sync job, and google's review before
  anyone outside a test list can use it. a port needs none of the first two and
  makes the third optional for a long while.
- it leaves the to-do redesign free: once events are native rows there's one
  kind of thing on the calendar to design for, not two.

what it costs: anything that lands in google afterwards (an invite from someone
else, an event added on the phone's calendar app) won't appear. re-running the
import picks up new events, but that's a manual step. see "after the import".

## the two ways in

| | import from google (button) | calendar file (.ics / .zip) |
|---|---|---|
| steps for the user | click, pick a google account, allow, pick calendars | on a computer: google calendar settings → import & export → export, then upload the file |
| works on a phone | yes | no — google only exports from a computer |
| needs google's approval | not for people on our test list; yes to open it to everyone | never |
| other calendars (apple, outlook) | no | yes |
| school / work accounts | the organisation's admin can block outside apps | the admin can block export too |
| build cost | small: a google script tag and two api calls | medium: a file parser, including time zones and zip |

**build the google button first.** it's the path people will actually finish,
and it's the smaller build. the file upload comes second, as the route for
anyone the button can't serve. both feed the same translate → review → save
steps, so the second one is only a new front door.

### what "test list" means for the button

reading a calendar is a scope google calls sensitive. until google has reviewed
the app:

- **testing mode:** up to 100 people, each added by email in the google cloud
  console. their access lapses after 7 days — which broke the live-link idea
  but **doesn't matter here**, since the import is done in a minute.
- **published but unreviewed:** anyone can use it, behind a "google hasn't
  verified this app" warning, up to 100 people over the project's lifetime.
  that cap can't be reset.
- **reviewed:** no warning, no cap. needs a homepage and privacy policy on
  `willowstreak.com`, a written reason for the scope, and a demo video. google
  says days; their own docs also say it can take much longer.

so: testing mode covers Luka and friends now. start the review when strangers
need it. the file upload is the release valve in between.

## the translation: google event → reminder

| google event | becomes | notes |
|---|---|---|
| timed, within a day | **anchor** with a time and a length | length clamped to 5 min – 24 h |
| all day, one day | **anchor** with no time | sits in the all-day band, as untimed anchors do now |
| all day, several days | **floater** over those days | draws right (a bar across the days). a floater means "some time in here", which isn't quite it — see the redesign question |
| timed, longer than 24 h | **floater** over those days | the times are lost. flagged in the review |
| repeats daily / weekly / every 2 weeks / monthly on a date / yearly | the same repeat | maps straight onto our six |
| repeats mon–fri | `weekdays` | |
| repeats on several weekdays (mon, wed, fri) | **one weekly anchor per weekday** | three rows for a m/w/f class. this is the common timetable case |
| "ends after 12 times" / "ends on" | `repeat_until` | the count is turned into a date |
| a repeat we can't express (every 3 weeks, "2nd tuesday") | **one-off anchors** for the next 3 months | flagged in the review |
| one occurrence cancelled | that day goes into `done_dates` | it shows ticked off instead of gone. we have no "skip this one" — see open questions |
| one occurrence moved | the original day skipped as above, plus a one-off anchor | |
| event's time zone | converted to the browser's zone, then stored as plain date + time | same as every reminder today |
| location | `place`, cut to 120 characters | |
| title | `title`, cut to 200; untitled → "busy" | |
| google reminder (popup) | `alert_minutes`, if a day or less before | optional; off by default |
| description, guests, video link | **dropped** | there's nowhere to put them yet |
| a google calendar | a **category** | chosen in the review: an existing one, or a new one in the calendar's colour |
| declined invitations | skipped | |
| one-off events already past | skipped | a repeat that's still running is kept from its first day |
| holidays / birthdays calendars | off by default | |

## the flow

1. **start.** on the to-do page: "import a calendar". (where exactly, below.)
2. **pick the source.** google button or a file.
3. **review.** one row per calendar: its name, how many events it would bring,
   a switch, and which category they go into. under it, a short list of
   anything that didn't translate cleanly ("4 events repeat in a way
   willowstreak can't; they'll come in as single events for the next 3 months").
   a total at the bottom: "imports 62 reminders".
4. **import.** one batch request. the calendar fills in.
5. **done.** a line saying what came in, with **undo** (removes that import).

## what has to be built

- **frontend:** the import dialog; the google sign-in script; `lib/calendarImport.ts`
  holding the translation (pure functions, unit-testable against sample events);
  later, the file parser.
- **backend:** `POST /api/reminders/import`, taking up to a couple of thousand
  rows validated by the existing `ReminderShape`. today's create endpoint is one
  row per request, which is too slow and too easy to half-finish.
- **database:** one migration adding `reminders.source` (text, nullable — the
  google event's id, plus the weekday when one event became several) with
  `unique (user_id, source)`, and `reminders.import_id`. `source` makes a second
  import skip what's already there. `import_id` is what undo deletes by.
- **google cloud:** a project, the calendar api switched on, an oauth client for
  `willowstreak.com` and localhost, test users added. scopes: read-only events
  and read-only calendar list, nothing wider.
- **not needed:** a google client secret, token storage, the service-role key,
  a cron, a webhook.

## where it lives

**on the to-do page, as an action.** a one-time port isn't a setting: there's
nothing to configure afterwards and nothing to switch off.

- **when the calendar is empty** (a new account): the empty state offers it.
  "bring your calendar over" beside "add your first reminder".
- **always:** an "import" item in a small menu on the calendar's heading, for
  running it again later.

no entry in the profile popup. if a settings page appears later it could link
here, but shouldn't hold it.

## after the import

- **running it again is safe.** events already imported are skipped, new ones
  come in. events *changed* in google since are not updated — the willowstreak
  copy is the user's now, and may have been edited.
- **the gap:** invitations and anything added elsewhere keep landing in google
  only. for a student whose timetable is the main thing, that's fine. for
  someone whose work lives in google invites, a one-time port won't be enough,
  and that's the case the live link in the first draft was for.
- worth watching once people use it: how often anyone re-imports. if it's
  often, that's the signal to build the live link.

## what this means for the to-do redesign

**imported events aren't to-dos.** today every anchor has a tick box and counts
towards "N open". port a term's timetable and the list fills with lectures to
tick off. three ways to handle it, in the order I'd consider them:

1. **a fifth kind, `event`** (recommended): dated like an anchor or floater, no
   tick box, shown on the calendar and not in the reminders list. the import
   writes these. it also fixes the several-days case, where "floater" doesn't
   mean the right thing. the original brief already splits "appointments at a
   set time" from "things to get done in a range of days" — this makes the
   first one a first-class thing.
2. a flag on anchors ("no tick box"). smaller change, but floaters still don't
   fit and the list needs a filter anyway.
3. import as plain anchors and live with it. fine for a first test with one
   account; not for other people.

the import can be built against option 3 now and switched to `event` when the
redesign lands, since only the translation's output changes.

two smaller things the redesign could pick up, both surfaced by this:

- **skipping one occurrence** of a repeat ("no class this week"). we can only
  tick it off.
- **a notes / link field.** google descriptions and video links have nowhere
  to go.

## phases

1. **prove it** — google project in testing mode; the button; the translation
   with tests; batch endpoint and migration; a bare review screen. Luka's
   account only, importing as anchors and floaters.
2. **make it good** — the full review screen, undo, the empty-state entry,
   calendar → category mapping.
3. **the other door** — file upload (.ics and google's .zip).
4. **open it up** — privacy policy, google's review. only when strangers need
   the button.

## what we're not doing (and when we would)

- **a live link** (google events mirrored and kept up to date): needs stored
  tokens, a sync job and google's review up front. revisit if people keep
  re-importing.
- **two-way sync** (willowstreak reminders appearing in google): all of the
  above plus a write scope and conflict handling.
- **pasting a private calendar address:** the backend would fetch it, and it's
  no easier for the user than the file export.

## open questions for Luka

1. does the redesign get an `event` kind (no tick box), or do imports come in
   as anchors?
2. a cancelled occurrence of a repeat: ticked off (works today), or add a real
   "skip"?
3. keep google descriptions somewhere (a notes field), or drop them?
4. is the first version just for you and friends on the test list, or should
   the file upload ship with it so anyone can use it?

## sources

- google identity: [using the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
  (browser-only access, no refresh token; their example uses a calendar scope),
  [sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification),
  [unverified apps (the 100-user lifetime cap)](https://support.google.com/cloud/answer/7454865),
  [manage app audience (testing mode, 7-day expiry)](https://support.google.com/cloud/answer/15549945)
- google calendar: [export events (computer only, .zip of .ics, admins can restrict)](https://support.google.com/calendar/answer/37111)
- **not confirmed, from memory:** that the two narrow read-only scopes
  (`calendar.events.readonly`, `calendar.calendarlist.readonly`) are enough on
  their own and are both classed sensitive rather than restricted; how exactly
  school admins block outside apps; the exact shape of google's recurrence data
  for moved and cancelled occurrences. check each when building phase 1.
