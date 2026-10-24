# social redesign — backend proposal

spec: `~/Downloads/Main.dc.html`. built 2026-10-23, with cheers cut at Luka's request. open questions 1–3 went with the recommendations.

## what's there now

- `friendships` already has `status` (pending | accepted), one row per pair; decline / cancel / unfriend delete the row. `/api/friends` covers send, accept, decline/cancel, unfriend. no new friendship table needed.
- `search_users(prefix)` matches a username prefix only, no names.
- `get_activity(limit)` returns friends' logs with no streak or cheers. the client polls it every 30s.
- the browser only talks to Supabase directly for auth. there's no realtime yet.

## new tables

**`suggestion_dismissals`**: `user_id`, `dismissed_id` (both → `users`, cascade), `created_at`, pk `(user_id, dismissed_id)`. RLS: owner only.

## rpcs

**`search_people(p_query, p_limit)`** replaces `search_users`.
- matches `first_name last_name` or `username`, case-insensitive, anywhere in the string. it uses `strpos`, so `%` and `_` are literal. a leading `@` is stripped. you're excluded.
- rank: full name starts with q → a name word starts with q → username starts with q → contains q. ties go friends → incoming → outgoing → none, then by mutual count.
- returns `relation` and `mutual_friends`. ranking has to happen server-side because the result is cut to 6.
- one sequential scan of `users`, which is fine at this size. add a `pg_trgm` index if it grows.

**`get_suggestions(p_limit)`**, graph distance first:
- hop 2 (friends of friends) comes first, ranked by mutual friend count, then by shared habits (same `name_key`, neither side private).
- hop 3 fills any slots left, ranked by number of connecting paths, then shared habits.
- excluded: you, friends, anyone with a pending row in either direction, and anyone you dismissed. people with no connection are never suggested, so with no friends the card shows its empty state.
- returns `hop`, `mutual_friends` and `via` (the best-connected friend on the path).
- reason line: hop 2 → "3 mutual friends", or "friends with Phoenix Hsuen" when there's one. hop 3 → "friends with Phoenix's friends".

**`get_activity(p_limit)`**: dropped and recreated, since the return type changes. new columns:
- `streak`: consecutive logged days (value > 0) ending on that entry's date, for that habit. same rule as the card.
- `personal_best`: true on the day the streak passed the habit's previous longest run.
- `milestone`: streak is 7, 14, 30, 50 or 100, then every 100 after.

**`get_friendships()`**: dropped and recreated with `mutual_friends`, for the "@handle · 2 mutual friends" sub line on requests.

## endpoints

| method | path | change |
|---|---|---|
| GET | `/api/users?search=<q>` | same path. matches names and usernames in any case (1–40 chars), returns at most 6 with `relation` and `mutual_friends` |
| GET | `/api/activity?limit=` | adds `streak`, `milestone`, `personal_best` |
| GET | `/api/friends/suggestions?limit=3` | new |
| POST | `/api/friends/suggestions/{user_id}/dismiss` | new, 204, idempotent |
| GET | `/api/friends` | `friends` / `incoming` / `outgoing` rows gain `mutual_friends` |

## realtime

- `postgres_changes` on `habit_entries` won't work: RLS hides friends' entries from whoever subscribes. loosening that is the peeking that `friends_only` removed.
- instead, a trigger on `habit_entries` (insert, or an update of `value`) calls `realtime.send()` with a ping `{entry_id}`. it goes to the private topic `feed:<friend_id>` for each accepted friend of the owner. private / archived habits and value 0 are skipped.
- an RLS policy on `realtime.messages` lets `authenticated` receive only `'feed:' || auth.uid()`.
- client: a supabase-js private channel `feed:<myId>`. on a ping (debounced ~1s) it re-fetches `/api/activity` in the background.
  - ids not on screen go into "N new updates", and clicking the button merges them in.
  - rows already on screen stay as they were until then, so nothing jumps. rows the server dropped (an unlogged day, an unfriend) go straight away.
- the 30s poll stays as a 60s fallback and feeds the same buffer.
- this is the first browser → Supabase traffic besides auth. the hosted project needs Realtime on (`config.toml` has it enabled locally).

## frontend (after OK)

- rebuild `Social.tsx`: the search dropdown, the feed column and a side column (requests, suggestions). `flex-direction: row-reverse` + wrap, like the mockup, so the side column stacks above the feed on narrow screens.
- reuse `UserAvatar`, `ProfileModal`, `useFriends`, `changeFriendship` and the preload cache. colours go through the app's tokens, matched to the mockup's values.
- search: the existing 200ms debounce, highlight via the matched range, Esc clears, empty state copy from the mockup.
- the feed is one list of the latest 10 (day groups were cut after the build). feed rows still open the friend's profile.
- the requests card is hidden when empty, and keeps accepted rows as "friends" until you leave the tab. declined rows go.
- suggestions load once per visit and don't poll, so a row you just added stays as "requested" instead of vanishing.

## tests

- `fake_supabase`: the new rpcs and both tables.
- `test_rls`: search, suggestions, streak columns, dismissals (owner only), the feed ping trigger, and the `realtime.messages` topic policy.

## open questions

1. **shared habits in the reason line.** the mockup's "· tracks gym" shows a non-friend's habit name, which `friends_only` hides on purpose. recommendation: use shared habits for ranking only and keep them off the line.
2. **no-connection fallback.** the mockup has "new to willowstreak". recommendation: none, graph only.
3. **milestone thresholds.** 7 / 14 / 30 / 50 / 100 / every 100 ok?
