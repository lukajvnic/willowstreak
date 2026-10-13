import { useEffect, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";
import { useActivity, type Activity } from "../lib/activityApi";

type Side = "left" | "right";
type Phase = "enter" | "visible" | "leaving";

type Bubble = {
  id: number;
  item: Activity;
  side: Side;
  top: number; // vh — random each time, so drops never line up
  inset: number; // px in from the viewport edge, a little horizontal jitter
  phase: Phase;
};

/** how long a bubble stays up before it fades back out */
const LIFETIME = 6200;
const FADE_OUT = 480;

// clear of the wordmark up top and the "last N weeks" footer down low
const TOP_MIN = 20;
const TOP_MAX = 76;
/** bubbles on the same side must land at least this far apart, so a new
 * one never lands on top of one that's still fading out */
const MIN_GAP_VH = 16;

/** opening the page drifts the last day's few most recent logs past once.
 * anything older is history, not activity */
const OPENING_WINDOW = 24 * 60 * 60 * 1000;
const OPENING_MAX = 4;

let nextId = 0;

/** a spot for a new bubble on `side`, kept clear of whatever's already there */
function pickTop(sameSideTops: number[]): number {
  for (let i = 0; i < 24; i++) {
    const candidate = TOP_MIN + Math.random() * (TOP_MAX - TOP_MIN);
    if (sameSideTops.every((t) => Math.abs(t - candidate) >= MIN_GAP_VH)) return candidate;
  }
  // that side is crowded — fall back to whatever's furthest from everything else
  let best = TOP_MIN;
  let bestDist = -1;
  for (let v = TOP_MIN; v <= TOP_MAX; v += 2) {
    const dist = sameSideTops.length ? Math.min(...sameSideTops.map((t) => Math.abs(t - v))) : Infinity;
    if (dist > bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  return best;
}

/** other people's activity, drifting in beside the heatmaps — same feed as the
 * social tab, just surfaced ambiently while you're looking at your habits.
 * each log is shown once: a few recent ones on arrival, then new ones as the
 * feed's polling turns them up */
export default function ActivityBubbles() {
  const items = useActivity(10);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  // entry ids already queued or shown; null until the first load
  const seen = useRef<Set<string> | null>(null);
  const queue = useRef<Activity[]>([]);

  useEffect(() => {
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((i) => i.id));
      // newest first off the wire, so reverse: they drift past in the order they happened
      queue.current = items
        .filter((i) => Date.now() - i.at < OPENING_WINDOW)
        .slice(0, OPENING_MAX)
        .reverse();
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.id));
    for (const i of fresh) seen.current.add(i.id);
    queue.current.push(...fresh.reverse());
  }, [items]);

  useEffect(() => {
    let timer = 0;

    const spawn = (item: Activity) => {
      const id = nextId++;
      const side: Side = Math.random() < 0.5 ? "left" : "right";
      // comfortably clear of the browser's own edge, not hugging it
      const inset = 30 + Math.random() * 26;

      setBubbles((prev) => {
        const top = pickTop(prev.filter((b) => b.side === side).map((b) => b.top));
        return [...prev, { id, item, side, top, inset, phase: "enter" }];
      });

      // mounts hidden, then flips to visible shortly after so the pop-in is
      // a genuine transition (and, symmetrically, so is the fade-out) — a
      // timeout rather than rAF, since rAF stalls in a backgrounded tab
      window.setTimeout(() => {
        setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, phase: "visible" } : b)));
      }, 20);

      window.setTimeout(() => {
        setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, phase: "leaving" } : b)));
      }, LIFETIME - FADE_OUT);

      window.setTimeout(() => {
        setBubbles((prev) => prev.filter((b) => b.id !== id));
      }, LIFETIME);
    };

    // one bubble at a time off the queue, each at its own random moment
    // rather than on a strict beat — and nothing at all when it's empty
    const tick = () => {
      const item = queue.current.shift();
      if (item) spawn(item);
      timer = window.setTimeout(tick, 3200 + Math.random() * 2600);
    };

    timer = window.setTimeout(tick, 1400);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="activity-bubbles" aria-hidden>
      {bubbles.map((b) => (
        <div
          className="activity-bubble"
          data-side={b.side}
          data-phase={b.phase}
          key={b.id}
          style={{ top: `${b.top}vh`, [b.side]: `${b.inset}px` } as React.CSSProperties}
        >
          <UserAvatar user={b.item.person} size={26} />
          <span className="activity-bubble-text">
            <strong>{b.item.person.name}</strong> {b.item.text}!
          </span>
        </div>
      ))}
    </div>
  );
}
