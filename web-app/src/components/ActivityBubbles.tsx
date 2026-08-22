import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { ACTIVITIES, PEOPLE, toneFor } from "../lib/people";

type Side = "left" | "right";
type Phase = "enter" | "visible" | "leaving";

type Bubble = {
  id: number;
  name: string;
  text: string;
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

/** friends' activity, drifting in beside the heatmaps — same feed as the
 * social tab, just surfaced ambiently while you're looking at your habits */
export default function ActivityBubbles() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    let timer = 0;

    const spawn = () => {
      const id = nextId++;
      const side: Side = Math.random() < 0.5 ? "left" : "right";
      const name = PEOPLE[Math.floor(Math.random() * PEOPLE.length)].name;
      const text = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
      // comfortably clear of the browser's own edge, not hugging it
      const inset = 30 + Math.random() * 26;

      setBubbles((prev) => {
        const top = pickTop(prev.filter((b) => b.side === side).map((b) => b.top));
        return [...prev, { id, name, text, side, top, inset, phase: "enter" }];
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

      // the next one lands at its own random moment, not on a strict beat
      timer = window.setTimeout(spawn, 3200 + Math.random() * 2600);
    };

    timer = window.setTimeout(spawn, 1400);
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
          <Avatar name={b.name} tone={toneFor(b.name)} size={26} />
          <span className="activity-bubble-text">
            <strong>{b.name}</strong> {b.text}!
          </span>
        </div>
      ))}
    </div>
  );
}
