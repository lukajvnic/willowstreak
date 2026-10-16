export type Kind = "refile" | "backlog" | "floater" | "anchor";

export type Reminder = {
  id: string;
  title: string;
  kind: Kind;
  done: boolean;
  /** local date key, YYYY-MM-DD. floater: window start. anchor: the day */
  start?: string;
  /** floater only — inclusive end of the window */
  end?: string;
  /** anchor only */
  time?: string;
  /** anchor only — minutes it lasts. unset draws as DEFAULT_DURATION */
  duration?: number;
  /** anchor only — minutes before the start to send a desktop alert. null is
   * "turned off", which an edit has to send so the server clears it; unset is
   * "never had one" */
  alert?: number | null;
  place?: string;
  /** free-form grouping — school, work, exercise... — orthogonal to kind */
  categoryId?: string;
};

export type Category = {
  id: string;
  name: string;
  /** a single emoji, picked freehand — no fixed set to choose from */
  icon: string;
};

// written as escaped code points rather than literal glyphs — some emoji
// (multi-byte astral-plane characters) don't survive being typed straight
// into source reliably, so this is the safe way to pin down exactly which
// character each one is
const GRADUATION_CAP = "\u{1F393}"; // 🎓
const BRIEFCASE = "\u{1F4BC}"; // πŸ’Ό
const FLEXED_BICEPS = "\u{1F4AA}"; // πŸ’ͺ
const BROOM = "\u{1F9F9}"; // 🧹
const HOSPITAL = "\u{1F3E5}"; // πŸ₯
export const LABEL_TAG = "\u{1F3F7}\u{FE0F}"; // 🏷️ — default icon for a fresh category

/** the categories everyone starts with. they live here, not in the database —
 * a reminder points at one by its slug, and at one you made by its uuid */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "school", name: "school", icon: GRADUATION_CAP },
  { id: "work", name: "work", icon: BRIEFCASE },
  { id: "exercise", name: "exercise", icon: FLEXED_BICEPS },
  { id: "chores", name: "chores", icon: BROOM },
  { id: "health", name: "health", icon: HOSPITAL },
];

export type KindInfo = {
  id: Kind;
  label: string;
  blurb: string;
  tone: string;
  /** what the popup asks for after the kind is picked */
  needs: "nothing" | "window" | "moment";
};

export const KINDS: KindInfo[] = [
  {
    id: "refile",
    label: "refile",
    blurb: "get it out of your head — fill in the details later",
    tone: "#6C9BD0",
    needs: "nothing",
  },
  {
    id: "backlog",
    label: "backlog",
    blurb: "park it — months or years from now",
    tone: "#8B8681",
    needs: "nothing",
  },
  {
    id: "floater",
    label: "floater",
    blurb: "no set day, but it belongs in a window",
    tone: "#D9A93A",
    needs: "window",
  },
  {
    id: "anchor",
    label: "anchor",
    blurb: "you know exactly when and where",
    tone: "#5FA46B",
    needs: "moment",
  },
];

export const kindInfo = (kind: Kind) => KINDS.find((k) => k.id === kind)!;

/* ---------- dates ---------- */

/** local YYYY-MM-DD — never round-trips through UTC, so days stay put */
export function keyOf(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => keyOf(new Date());

export function shiftKey(key: string, days: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + days);
  return keyOf(d);
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export const monthName = (month: number) => MONTHS[month];

/** "aug 24" — or "aug 24, 2027" once it leaves the current year */
export function fmtDay(key: string): string {
  const d = parseKey(key);
  const short = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? short : `${short}, ${d.getFullYear()}`;
}

/** "2:30pm" from a 24h HH:MM */
export function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${`${m}`.padStart(2, "0")}${suffix}`;
}

/** how long an anchor with no length of its own is drawn, in minutes */
export const DEFAULT_DURATION = 60;
/** the shortest and longest an anchor can last, matching the db check */
export const MIN_DURATION = 5;
export const MAX_DURATION = 24 * 60;

/** "1h 30m", "45m", "2h" */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** the HH:MM an anchor ends at — wraps past midnight like a clock does */
export function endTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${`${Math.floor(total / 60)}`.padStart(2, "0")}:${`${total % 60}`.padStart(2, "0")}`;
}

/** the seven day keys of the Sun..Sat week containing `key` */
export function weekGrid(key: string): string[] {
  const d = parseKey(key);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return keyOf(x);
  });
}

/** "aug 16 — 22", widening to "aug 30 — sep 5" when the week straddles months */
export function fmtRange(a: string, b: string): string {
  const s = parseKey(a);
  const e = parseKey(b);
  const sm = MONTHS[s.getMonth()].slice(0, 3);
  const em = MONTHS[e.getMonth()].slice(0, 3);
  return s.getMonth() === e.getMonth()
    ? `${sm} ${s.getDate()} — ${e.getDate()}`
    : `${sm} ${s.getDate()} — ${em} ${e.getDate()}`;
}

/** six weeks of day keys covering the month, Sun..Sat, so the grid never reflows */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return keyOf(d);
  });
}

/* ---------- queries ---------- */

/** does this reminder touch the given day? backlog and refile never do */
export function covers(r: Reminder, key: string): boolean {
  if (!r.start) return false;
  return key >= r.start && key <= (r.end ?? r.start);
}

export const dated = (r: Reminder) => r.kind === "anchor" || r.kind === "floater";

export type SortMode = "priority" | "due";

/** the day a reminder is measured by — anchors by their day, floaters by their deadline */
export function dueKey(r: Reminder): string | null {
  if (r.kind === "anchor") return r.start ?? null;
  if (r.kind === "floater") return r.end ?? r.start ?? null;
  return null;
}

/** anchors first by when, then floaters by deadline, then the undated piles */
const RANK: Record<Kind, number> = { anchor: 0, floater: 1, refile: 2, backlog: 3 };

export function sortReminders(list: Reminder[], mode: SortMode = "priority"): Reminder[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;

    if (mode === "due") {
      const da = dueKey(a);
      const db = dueKey(b);
      // both keys are fixed-width, so a plain string compare runs chronological
      if (da && db) {
        const cmp = `${da} ${a.time ?? ""}`.localeCompare(`${db} ${b.time ?? ""}`);
        if (cmp !== 0) return cmp;
      } else if (da || db) {
        return da ? -1 : 1; // undated sinks below anything with a date
      }
    }

    if (RANK[a.kind] !== RANK[b.kind]) return RANK[a.kind] - RANK[b.kind];
    if (a.kind === "anchor" && b.kind === "anchor") {
      return `${a.start}${a.time ?? ""}`.localeCompare(`${b.start}${b.time ?? ""}`);
    }
    if (a.kind === "floater" && b.kind === "floater") {
      return (a.end ?? a.start ?? "").localeCompare(b.end ?? b.start ?? "");
    }
    return 0;
  });
}

/** section order — by kind, or led by whichever section comes up soonest */
export function kindOrder(list: Reminder[], mode: SortMode): Kind[] {
  const kinds: Kind[] = ["anchor", "floater", "refile", "backlog"];
  if (mode === "priority") return kinds;

  const soonest = (k: Kind) =>
    list
      .filter((r) => r.kind === k && !r.done)
      .map(dueKey)
      .filter((key): key is string => key !== null)
      .sort()[0] ?? "9999"; // undated sections sort to the back

  return [...kinds].sort((a, b) => {
    const cmp = soonest(a).localeCompare(soonest(b));
    return cmp !== 0 ? cmp : RANK[a] - RANK[b];
  });
}
