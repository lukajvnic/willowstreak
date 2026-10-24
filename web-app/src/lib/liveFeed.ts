import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "./activityApi";
import { useAuth } from "./auth";
import { useFriends } from "./friendsApi";
import { FEED_SIZE, KEYS, loadFeedWarm } from "./pageData";
import { invalidate, peek, preload } from "./preload";
import { supabase } from "./supabase";

/** the realtime ping is the main signal; this only covers a dropped socket */
const FALLBACK_POLL_MS = 60_000;
/** a burst of pings (logging several habits in a row) becomes one re-read */
const PING_SETTLE_MS = 800;

/**
 * The social tab's feed. What's on screen never changes under you: a friend's
 * new log (announced by a realtime ping on `feed:<your id>`, or found by the
 * fallback poll) is counted in `waiting` until `showNew` puts it in.
 *
 * The ping carries no habit data. It comes from a trigger on habit_entries
 * (see 20261023120000_social_redesign.sql), because postgres_changes can't see
 * friends' entries through RLS. It only says "re-read the feed".
 *
 * Rows that vanish from the server's copy (an unlogged day, an unfriend) go
 * straight away, since removing a row doesn't push anything around under you.
 * Rows that only fell off the end of the window stay.
 */
export function useLiveFeed() {
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const myId = profile && profile !== "none" ? profile.id : null;
  const [shown, setShown] = useState<Activity[] | null>(() => peek<Activity[]>(KEYS.feed) ?? null);
  const [latest, setLatest] = useState<Activity[] | null>(null);
  const pull = useRef<(fresh: boolean) => void>(() => {});

  useEffect(() => {
    if (!token) return;
    let stale = false;
    // the first answer after opening the tab replaces the cached copy outright:
    // it was painted a moment ago, so nothing has been read yet
    let first = true;

    pull.current = (fresh) => {
      if (fresh) invalidate(KEYS.feed);
      preload(KEYS.feed, () => loadFeedWarm(token))
        .then((list) => {
          if (stale) return;
          const replace = first;
          first = false;
          setLatest(list);
          setShown((prev) => (replace || !prev ? list : settle(prev, list)));
        })
        .catch((err: Error) => {
          // a newer load took over; it reports for itself
          if (err.message.includes("superseded")) return;
          console.error("feed load failed", err);
          if (!stale) setShown((prev) => prev ?? []);
        });
    };

    pull.current(false);
    const timer = setInterval(() => pull.current(true), FALLBACK_POLL_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!token || !myId) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    // private channels are authorised by RLS on realtime.messages, as this user
    void supabase.realtime.setAuth(token);
    const channel = supabase
      .channel(`feed:${myId}`, { config: { private: true } })
      .on("broadcast", { event: "activity" }, () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => pull.current(true), PING_SETTLE_MS);
      })
      .subscribe();
    return () => {
      clearTimeout(settleTimer);
      void supabase.removeChannel(channel);
    };
  }, [token, myId]);

  // a new friend's logs, or an old friend's gone: re-read now rather than on
  // the next poll
  const friends = useFriends();
  const circle = friends?.friends.map((f) => f.id).sort().join(",");
  const seenCircle = useRef(circle);
  useEffect(() => {
    if (circle === undefined || seenCircle.current === circle) return;
    const before = seenCircle.current;
    seenCircle.current = circle;
    if (before !== undefined) pull.current(true);
  }, [circle]);

  // new logs, and logs that changed since they were put on screen
  const waiting = useMemo(() => {
    if (!shown || !latest) return 0;
    const at = new Map(shown.map((a) => [a.id, a.at]));
    return latest.filter((a) => at.get(a.id) !== a.at).length;
  }, [shown, latest]);

  const showNew = () => {
    if (latest) setShown(latest);
  };

  return { items: shown, waiting, showNew };
}

/** what stays on screen after a re-read: every row, as it was shown, unless the
 * server no longer has it. a row older than the server's oldest only fell off
 * the end of a full window, so it isn't gone */
function settle(shown: Activity[], latest: Activity[]): Activity[] {
  const ids = new Set(latest.map((a) => a.id));
  const full = latest.length >= FEED_SIZE;
  const oldest = latest.length ? latest[latest.length - 1].at : Infinity;
  const kept = shown.filter((a) => ids.has(a.id) || (full && a.at < oldest));
  return kept.length === shown.length ? shown : kept;
}
