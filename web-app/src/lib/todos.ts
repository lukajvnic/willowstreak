export type Kind = "refile" | "backlog" | "floater" | "anchor";

export type Repeat = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";

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
  /** anchors and floaters. the row is the current occurrence; the calendar draws
   * the later ones and ticking it off rolls it forward. null / unset as `alert` */
  repeat?: Repeat | null;
  /** the last day an occurrence can start on; unset repeats forever */
  repeatUntil?: string | null;
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

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "tue, oct 21" */
export const fmtLongDay = (key: string) => `${WEEKDAYS[parseKey(key).getDay()]}, ${fmtDay(key)}`;

/** "today", "tomorrow", "in 3 days" — empty once it's more than a week off */
export function relDay(key: string): string {
  const days = Math.round((parseKey(key).getTime() - parseKey(todayKey()).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 7) return `in ${days} days`;
  return "";
}

/** the first of the month `key` falls in */
export function monthOf(key: string): string {
  const d = parseKey(key);
  return keyOf(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** a real calendar day, or null — new Date() would roll feb 30 into march */
function dayKey(y: number, m: number, d: number): string | null {
  const date = new Date(y, m, d);
  return date.getMonth() === m && date.getDate() === d ? keyOf(date) : null;
}

const monthIndex = (word: string) =>
  word.length >= 3 ? MONTHS.findIndex((name) => name.startsWith(word)) : -1;

/** a typed date — "tomorrow", "fri", "next fri", "in 3 days", "oct 22", "22 oct",
 *  "10/22", "22", "2026-10-22" — as a day key; null when it isn't one. a date
 *  with no year is the next one coming, never one already gone */
export function parseDate(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const today = todayKey();
  const now = parseKey(today);
  const upcoming = (m: number, d: number) => {
    const key = dayKey(now.getFullYear(), m, d);
    return key && key < today ? dayKey(now.getFullYear() + 1, m, d) : key;
  };

  if (s === "today" || s === "tod") return today;
  if (s === "tomorrow" || s === "tmr" || s === "tom") return shiftKey(today, 1);
  if (s === "yesterday") return shiftKey(today, -1);

  let m = s.match(/^in (\d+) ?(d|days?|w|wks?|weeks?)$/);
  if (m) return shiftKey(today, Number(m[1]) * (m[2].startsWith("w") ? 7 : 1));

  m = s.match(/^(next )?([a-z]+)$/);
  if (m && m[2].length >= 2) {
    const dow = WEEKDAYS.findIndex((w) => m![2].startsWith(w) || w.startsWith(m![2]));
    if (dow >= 0) {
      // "fri" is the coming one; "next fri" is the one in the week after
      const ahead = (dow - now.getDay() + 7) % 7 || 7;
      return shiftKey(today, ahead + (m[1] ? 7 : 0));
    }
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return dayKey(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (m) {
    if (!m[3]) return upcoming(Number(m[1]) - 1, Number(m[2]));
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return dayKey(y, Number(m[1]) - 1, Number(m[2]));
  }

  // "oct 22", "october 22nd 2027", "22 oct"
  m = s.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/) ?? null;
  let month = m ? monthIndex(m[1]) : -1;
  let day = m ? Number(m[2]) : 0;
  let year = m?.[3];
  if (month < 0) {
    m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/);
    month = m ? monthIndex(m[2]) : -1;
    day = m ? Number(m[1]) : 0;
    year = m?.[3];
  }
  if (month >= 0) return year ? dayKey(Number(year), month, day) : upcoming(month, day);

  // a bare day of the month: this month's, or next month's once it's passed
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m) {
    const d = Number(m[1]);
    const key = dayKey(now.getFullYear(), now.getMonth(), d);
    if (key && key >= today) return key;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return dayKey(next.getFullYear(), next.getMonth(), d);
  }
  return null;
}

/** minutes since midnight, from a 24h HH:MM */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 24h HH:MM from minutes since midnight — wraps like a clock does */
export function timeOf(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  return `${`${Math.floor(total / 60)}`.padStart(2, "0")}:${`${total % 60}`.padStart(2, "0")}`;
}

/** a typed time — "9", "9:30pm", "930", "9.30", "21:15", "noon" — as HH:MM; null when it isn't one */
export function parseTime(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, "").replace(".", ":");
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  const match = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  if (m > 59) return null;
  if (match[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (match[3].startsWith("p") ? 12 : 0);
  } else if (h > 23) return null;
  return timeOf(h * 60 + m);
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

/* ---------- repeats ---------- */

export const REPEATS: { id: Repeat; label: string; anchorOnly?: boolean }[] = [
  { id: "daily", label: "every day", anchorOnly: true },
  { id: "weekdays", label: "weekdays", anchorOnly: true },
  { id: "weekly", label: "every week" },
  { id: "biweekly", label: "every 2 weeks" },
  { id: "monthly", label: "every month" },
  { id: "yearly", label: "every year" },
];

export const repeatLabel = (r: Repeat) => REPEATS.find((x) => x.id === r)!.label;

/** the rules a kind can use — a floater is a window, so nothing shorter than a week */
export const repeatsFor = (kind: Kind) =>
  kind === "anchor" ? REPEATS : kind === "floater" ? REPEATS.filter((x) => !x.anchorOnly) : [];

const DAY_MS = 86_400_000;

/** whole days from a to b — through UTC noon, so a daylight-saving shift can't round it off */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd, 12) - Date.UTC(ay, am - 1, ad, 12)) / DAY_MS);
}

/** `key` moved on by `n` months, clamped to the month's end — jan 31 + 1 is feb 28 */
function addMonths(key: string, n: number): string {
  const d = parseKey(key);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return keyOf(target);
}

const isWeekday = (key: string) => {
  const dow = parseKey(key).getDay();
  return dow !== 0 && dow !== 6;
};

/** the start of the n-th occurrence after `start`. weekdays isn't a fixed step — see below */
function nthStart(start: string, rule: Exclude<Repeat, "weekdays">, n: number): string {
  switch (rule) {
    case "daily":
      return shiftKey(start, n);
    case "weekly":
      return shiftKey(start, 7 * n);
    case "biweekly":
      return shiftKey(start, 14 * n);
    case "monthly":
      return addMonths(start, n);
    case "yearly":
      return addMonths(start, 12 * n);
  }
}

/** the occurrence of `r` that covers `key` — its own start and end — or null.
 * a one-off has just the one occurrence, itself */
export function occurrenceOn(r: Reminder, key: string): { start: string; end: string } | null {
  if (!r.start) return null;
  const length = r.end ? daysBetween(r.start, r.end) : 0;

  if (!r.repeat) {
    return key >= r.start && key <= (r.end ?? r.start) ? { start: r.start, end: r.end ?? r.start } : null;
  }
  if (key < r.start) return null;

  let start: string;
  if (r.repeat === "weekdays") {
    if (!isWeekday(key)) return null;
    start = key;
  } else {
    // the last occurrence starting on or before `key`
    const span = { daily: 1, weekly: 7, biweekly: 14 } as Record<string, number>;
    let n: number;
    if (r.repeat in span) {
      n = Math.floor(daysBetween(r.start, key) / span[r.repeat]);
    } else {
      const a = parseKey(r.start);
      const b = parseKey(key);
      n = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
      if (r.repeat === "yearly") n = Math.floor(n / 12);
      if (nthStart(r.start, r.repeat, n) > key) n--;
    }
    start = nthStart(r.start, r.repeat, n);
  }

  if (r.repeatUntil && start > r.repeatUntil) return null;
  const end = shiftKey(start, length);
  return key <= end ? { start, end } : null;
}

/** where a repeating reminder goes once this occurrence is ticked off — the
 * next start and end, or null when the repeat has run out */
export function nextOccurrence(r: Reminder): { start: string; end?: string } | null {
  if (!r.repeat || !r.start) return null;
  let start: string;
  if (r.repeat === "weekdays") {
    start = shiftKey(r.start, 1);
    while (!isWeekday(start)) start = shiftKey(start, 1);
  } else {
    start = nthStart(r.start, r.repeat, 1);
  }
  if (r.repeatUntil && start > r.repeatUntil) return null;
  return { start, end: r.end ? shiftKey(start, daysBetween(r.start, r.end)) : undefined };
}

/* ---------- queries ---------- */

/** does this reminder touch the given day? backlog and refile never do. a
 * repeating one touches every day one of its occurrences does */
export function covers(r: Reminder, key: string): boolean {
  return occurrenceOn(r, key) !== null;
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
