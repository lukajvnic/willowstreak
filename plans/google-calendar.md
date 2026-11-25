# google calendar link — plan

written 2026-11-25, before the to-do redesign. nothing is built yet. this is the
proposal and the questions that need an answer first.

## the short version

- **do it one way first: google → willowstreak, read-only.** google events show
  on our calendar as their own layer. we never write to google.
- **don't turn google events into reminders.** the two don't mean the same
  thing (see "mismatches"). draw them next to reminders instead.
- **we run the google sign-in ourselves, in the backend**, and keep the tokens
  server-side. supabase's google login isn't enough on its own.
- **the link button goes on the to-do page**, on the calendar. there's no
  settings page today.
- **the slow part isn't code, it's google's review.** reading calendars is a
  "sensitive" scope, so anyone beyond a short test list needs google to approve
  the app.

## options

| | what the user gets | cost |
|---|---|---|
| **A. read-only link (recommended)** | their google events on our calendar, kept up to date | google review; token storage; a sync job |
| B. two-way | A, plus willowstreak anchors appear in google | A, plus a write scope (harder review), duplicates and conflicts to resolve, loops to prevent |
| C. paste a private ics link | events show, no google sign-in at all | no review; but the user has to dig a secret url out of google's settings, and google only refreshes that feed every several hours |

C is a cheap fallback worth keeping in mind if the review drags. it's also the
only one that works for apple / outlook calendars.

## mismatches between google's calendar and ours

| google | willowstreak today | what we do |
|---|---|---|
| an **event**: something that happens. no "done". | a **reminder**: something to do, ticked off. four kinds (refile, backlog, floater, anchor). | keep events as their own thing: no tick box, not counted in "N open" |
| a timed event can run past midnight or over several days | an anchor is one day, at most 24h | draw it across the days; don't store it as an anchor |
| an all-day event over several days means "this is on, all of those days" | a floater's window means "do it some time in here" | looks alike, means something else. show in the all-day band, styled as an event |
| repeats by any rule (rrule), with moved and cancelled single occurrences | six presets (daily … yearly), `repeat_until`, `done_dates` | ask google for the occurrences already expanded (`singleEvents=true`) for the weeks on screen. we never read an rrule |
| every time has a time zone | a date and a clock time, no zone | convert to the browser's zone when drawing |
| many calendars per account, each with a colour | categories, each with a colour | each google calendar is a switch with its own colour. mapping a calendar to a category is a later nicety |
| its own notifications | browser alerts while a tab is open | no alerts for google events. google already sends them |
| invitations: accepted / declined / maybe; "busy" events with no title | — | hide declined; show untitled ones as "busy" |

this is why a straight import into `reminders` is the wrong shape: most of an
event doesn't fit, and edits on either side would fight.

## how it would work (option A)

1. **connect.** the button sends the browser to google's consent screen. google
   sends it back to a backend endpoint with a code. the backend swaps the code
   for an access token and a long-lived refresh token.
2. **store.** new table `calendar_links` (`user_id`, google account email,
   refresh token **encrypted**, per-calendar sync state, which calendars are
   switched on). no row-level access for the browser: only the backend reads it,
   with the service-role key.
3. **read.** `GET /api/calendar/events?from=&to=` gives the calendar what's in
   view. the backend asks google with the user's token.
4. **keep up to date.** two ways, in order of effort:
   - *on open*: fetch when the to-do tab opens, and every few minutes while it
     stays open. no extra moving parts. this is "automatic" as far as the user
     can tell, and is what phase 1 does.
   - *push*: google calls a webhook of ours when a calendar changes. it only
     says "something changed", so we still fetch. the subscriptions expire and
     have to be renewed on a schedule, which needs a cron (vercel cron or
     `pg_cron`). only worth it if events must show up within seconds, or once
     we want alerts for them.
5. **disconnect.** revoke the token at google, delete the row.

### store events, or fetch them each time?

- **fetch each time (recommended to start):** nothing of the user's google data
  sits in our database, which keeps the privacy story and google's review
  simple. cost: the calendar waits on google when it opens (a grey placeholder
  covers it), and events can't feed alerts or leaderboards.
- **keep a copy** in an `external_events` table, updated with google's
  "what changed since last time" token: instant paint and usable for alerts
  later. cost: a sync job, stale-copy bugs, and we're now holding calendar data.

### why not just use supabase's google login?

supabase can sign someone in with google and ask for calendar access in the
same step, but as far as I know it hands the google tokens to the browser once
and doesn't keep or renew them. (I couldn't confirm this from supabase's docs
in this pass — check before ruling it out.) we'd still need our own storage and
refresh. accounts here are email + password, so a separate "link google" step
is the natural fit anyway.

## where the link lives

**on the to-do page, in the calendar's heading.** reasons:

- that's where the payoff is, and where someone notices their events are missing.
- there is no settings page. the only account ui is the profile popup.
- google returns the browser to wherever we say, so it can land back on the
  to-do tab with the events appearing.

what it looks like: a quiet "link google calendar" chip in the calendar heading
while not linked. once linked it becomes a small menu: which calendars show,
last synced, disconnect. if a settings page is built later, the same menu can be
reached from there too.

since the to-do page is about to be redesigned, the one thing to settle in that
design is whether **events and reminders share one timeline** (recommended:
yes, visually distinct) or sit in separate views.

## what google requires

- a google cloud project with the calendar api on, and an oauth client.
- reading calendar events is a **sensitive** scope. before review, the app runs
  in "testing": up to 100 test users, each added by email, and their link
  **expires after 7 days** so they have to reconnect weekly.
- to open it to everyone: google's review. it needs a homepage and privacy
  policy on our own domain (`willowstreak.com`), a written reason for the
  scope, and usually a short video of the flow. google quotes a few business
  days; plan for longer with back-and-forth.
- ask for the narrowest scope that works: read-only events plus the read-only
  calendar list.

## what has to be set up

- backend env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a key to encrypt
  stored tokens, and `SUPABASE_SERVICE_ROLE_KEY` (production doesn't have this
  one yet; the local `.env` has a placeholder).
- a privacy policy page on the site.
- one migration for `calendar_links`.

## phases

1. **prove it** — google project in testing mode, connect flow, token storage,
   `GET /api/calendar/events`, events drawn read-only on the week and month
   views. just Luka's account. no review needed.
2. **make it pleasant** — calendar switches and colours, the linked/unlinked
   menu, placeholder while loading, a clear "reconnect" state when a token dies.
3. **open it up** — privacy policy, submit for google's review.
4. **maybe later** — stored copy + push for instant updates and alerts; "turn
   this event into a reminder"; two-way; ics links for other calendars.

## open questions for Luka

1. is read-only enough for now, or is seeing willowstreak anchors inside google
   a must?
2. fetch each time, or keep a copy? (changes how much google data we hold.)
3. in the redesign, do events and reminders share one timeline?
4. who needs this first — just you and a few friends (testing mode is fine), or
   everyone (start the review early)?

## sources

- google: [sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification),
  [manage app audience (testing mode, 100 users, 7-day expiry)](https://support.google.com/cloud/answer/15549945),
  [production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview),
  [calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push),
  [events: watch](https://developers.google.com/calendar/api/v3/reference/events/watch)
- not confirmed in this pass, from memory: the exact scope names' classification,
  how long google's "what changed" tokens last, the refresh delay on ics feeds,
  and supabase's handling of google tokens.
