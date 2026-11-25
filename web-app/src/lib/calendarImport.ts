/**
 * Turning Google Calendar events into reminders. Pure: events in, drafts out.
 *
 * - an event inside one day  → an anchor (with its time and length, if it has them)
 * - an event over several days → a floater across them
 * - a series                 → one repeating reminder, or one per weekday when
 *                              it falls on several ("mon, wed, fri")
 * - a cancelled occurrence   → that day ticked off on its series
 * - a moved occurrence       → ticked off where it was, plus a one-off where it went
 *
 * A series whose rule has no equivalent here ("every 3 weeks", "2nd tuesday")
 * gets no plan from `seriesPlan`; `readCalendar` swaps those for their
 * occurrences before they reach `translate`.
 */

import type { GoogleEvent, GoogleTime } from "./googleCalendar";
import {
  MAX_DURATION,
  MIN_DURATION,
  daysBetween,
  keyOf,
  occurrenceOn,
  parseKey,
  shiftKey,
  type Reminder,
  type Repeat,
} from "./todos";

/** a reminder ready to import: `source` says which event it was, so importing
 * the same calendar again skips it */
export type ImportDraft = Reminder & { source: string };

const TITLE_MAX = 200;
const PLACE_MAX = 120;
/** what an event with no title is called — usually one marked private */
const UNTITLED = "busy";

/** iCalendar's day names, indexed like `Date.getDay()` */
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MON_TO_FRI = [1, 2, 3, 4, 5];

/** as far as a series' last day is searched for — see `dayOfNth` */
const COUNT_HORIZON_DAYS = 366 * 30;

/* ---------- when ---------- */

/** the event's day where the viewer is */
const localDay = (t: GoogleTime) => t.date ?? keyOf(new Date(t.dateTime!));

/** the event's day where it was made: a `dateTime` opens with it, in the
 * event's own zone. this is the day its repeat rule talks about */
const ruleDay = (t: GoogleTime) => t.date ?? t.dateTime!.slice(0, 10);

const clockOf = (d: Date) => `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;

type Shape = Pick<Reminder, "kind" | "start" | "end" | "time" | "duration"> & { start: string };

/** the kind and dates an event has here, and whether a clock time had to go
 * (anything over a day becomes a floater, which has none) */
function shapeOf(event: GoogleEvent): { shape: Shape; untimed: boolean } | null {
  const { start, end } = event;
  if (!start || !end) return null;

  if (start.date && end.date) {
    // google's end is the day after the last one
    const last = shiftKey(end.date, -1);
    const shape: Shape =
      last > start.date ? { kind: "floater", start: start.date, end: last } : { kind: "anchor", start: start.date };
    return { shape, untimed: false };
  }
  if (!start.dateTime || !end.dateTime) return null;

  const from = new Date(start.dateTime);
  const to = new Date(end.dateTime);
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (minutes > MAX_DURATION) {
    return { shape: { kind: "floater", start: keyOf(from), end: keyOf(to) }, untimed: true };
  }
  const shape: Shape = {
    kind: "anchor",
    start: keyOf(from),
    time: clockOf(from),
    duration: Math.max(MIN_DURATION, minutes),
  };
  return { shape, untimed: false };
}

/* ---------- repeats ---------- */

export type SeriesPlan = {
  repeat: Repeat;
  /** weekly on several days: the weekdays (as `getDay()`), one reminder each */
  days?: number[];
  /** the last day it can fall on */
  until?: string;
  /** or how many times it happens in all */
  count?: number;
};

/** "FREQ=WEEKLY;BYDAY=MO,WE" → { FREQ: "WEEKLY", BYDAY: "MO,WE" } */
function ruleOf(event: GoogleEvent): Record<string, string> | null {
  // one plain rule only: extra dates or exclusions can't be carried over
  const lines = event.recurrence ?? [];
  if (lines.length !== 1 || !lines[0].startsWith("RRULE:")) return null;
  return Object.fromEntries(lines[0].slice("RRULE:".length).split(";").map((part) => part.split("=")));
}

/** "20261207T045959Z" or "20261207", as the viewer's day */
function untilDay(value: string): string {
  const day = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (!value.includes("T")) return day;
  return keyOf(new Date(`${day}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`));
}

/** which of our repeats a rule is, and on which weekdays — null if none fits */
function repeatOf(rule: Record<string, string>, first: Date): Pick<SeriesPlan, "repeat" | "days"> | null {
  const every = Number(rule.INTERVAL ?? 1);
  const has = (...parts: string[]) => parts.some((part) => part in rule);
  // "2TU" (the second tuesday) isn't a plain weekday, and indexOf says so with -1
  const days = rule.BYDAY?.split(",").map((day) => DAYS.indexOf(day));
  if (days?.includes(-1) || has("BYSETPOS", "BYWEEKNO", "BYYEARDAY")) return null;

  switch (rule.FREQ) {
    case "DAILY":
      return every === 1 && !days && !has("BYMONTH", "BYMONTHDAY") ? { repeat: "daily" } : null;

    case "WEEKLY": {
      if (has("BYMONTH", "BYMONTHDAY")) return null;
      const on = days ?? [first.getDay()];
      const onItsOwnDay = on.length === 1 && on[0] === first.getDay();
      if (every === 2) return onItsOwnDay ? { repeat: "biweekly" } : null;
      if (every !== 1) return null;
      if (onItsOwnDay) return { repeat: "weekly" };
      const sorted = [...on].sort();
      if (sorted.join() === MON_TO_FRI.join()) return { repeat: "weekdays" };
      return { repeat: "weekly", days: sorted };
    }

    case "MONTHLY": {
      const sameDate = !rule.BYMONTHDAY || Number(rule.BYMONTHDAY) === first.getDate();
      return every === 1 && !days && sameDate && !has("BYMONTH") ? { repeat: "monthly" } : null;
    }

    case "YEARLY": {
      const sameDate = !rule.BYMONTHDAY || Number(rule.BYMONTHDAY) === first.getDate();
      const sameMonth = !rule.BYMONTH || Number(rule.BYMONTH) === first.getMonth() + 1;
      return every === 1 && !days && sameDate && sameMonth ? { repeat: "yearly" } : null;
    }

    default:
      return null;
  }
}

/** how a series repeats here — null when it can't, or isn't a series */
export function seriesPlan(event: GoogleEvent): SeriesPlan | null {
  const rule = ruleOf(event);
  const shaped = shapeOf(event);
  if (!rule || !shaped || !event.start) return null;

  const found = repeatOf(rule, parseKey(ruleDay(event.start)));
  if (!found) return null;
  // a floater is a window: it can't come round more often than weekly
  const { shape } = shaped;
  if (shape.kind === "floater" && (found.repeat === "daily" || found.repeat === "weekdays")) return null;

  // the rule names weekdays where the event was made; here they may be a day off
  const shift = daysBetween(ruleDay(event.start), shape.start);
  return {
    repeat: found.repeat,
    days: found.days?.map((day) => (day + shift + 7) % 7),
    until: rule.UNTIL ? untilDay(rule.UNTIL) : undefined,
    count: rule.COUNT ? Number(rule.COUNT) : undefined,
  };
}

/** the first `weekday` on or after `key` */
const nextOn = (key: string, weekday: number) => shiftKey(key, (weekday - parseKey(key).getDay() + 7) % 7);

const startsOn = (r: Reminder, day: string) => occurrenceOn(r, day)?.start === day;

/** the day the `count`-th occurrence across `rows` starts on */
function dayOfNth(rows: ImportDraft[], count: number): string | undefined {
  let day = rows.map((r) => r.start!).sort()[0];
  for (let i = 0, seen = 0; i < COUNT_HORIZON_DAYS; i++, day = shiftKey(day, 1)) {
    seen += rows.filter((r) => startsOn(r, day)).length;
    if (seen >= count) return day;
  }
  return undefined;
}

/* ---------- drafts ---------- */

const baseOf = (event: GoogleEvent) => ({
  title: (event.summary ?? "").trim().slice(0, TITLE_MAX) || UNTITLED,
  place: event.location?.trim().slice(0, PLACE_MAX) || undefined,
  done: false,
});

const sourceOf = (event: GoogleEvent) => `gcal:${event.id}`;

/** a series as reminders: one, or one per weekday. `skipped` are the days an
 * occurrence was cancelled or moved away from */
function seriesDrafts(event: GoogleEvent, shape: Shape, plan: SeriesPlan, skipped: string[]): ImportDraft[] {
  const length = shape.end ? daysBetween(shape.start, shape.end) : 0;
  const rows: ImportDraft[] = (plan.days ?? [null]).map((weekday) => {
    const start = weekday === null ? shape.start : nextOn(shape.start, weekday);
    return {
      ...baseOf(event),
      ...shape,
      id: crypto.randomUUID(),
      start,
      end: shape.end && shiftKey(start, length),
      repeat: plan.repeat,
      source: weekday === null ? sourceOf(event) : `${sourceOf(event)}:${DAYS[weekday]}`,
    };
  });

  const until = plan.until ?? (plan.count ? dayOfNth(rows, plan.count) : undefined);
  return rows
    .filter((r) => !until || r.start! <= until)
    .map((r) => ({ ...r, repeatUntil: until, doneDates: skipped.filter((day) => startsOn(r, day)) }));
}

const declined = (event: GoogleEvent) => event.attendees?.some((a) => a.self && a.responseStatus === "declined");

/** working locations, focus time, out-of-office and birthdays aren't things to do */
const ordinary = (event: GoogleEvent) => !event.eventType || event.eventType === "default" || event.eventType === "fromGmail";

/**
 * One calendar's events as reminders, leaving out what's cancelled, declined,
 * or already over by `today`. `untimed` counts the events that ran past a day
 * and so lost their clock times.
 */
export function translate(events: GoogleEvent[], today: string): { drafts: ImportDraft[]; untimed: number } {
  const series = new Map(events.filter((e) => e.recurrence).map((e) => [e.id, e]));
  const partOf = (e: GoogleEvent) => (e.recurringEventId ? series.get(e.recurringEventId) : undefined);

  // every occurrence that was changed or cancelled leaves its original day
  const skipped = new Map<string, string[]>();
  for (const event of events) {
    const parent = partOf(event);
    if (!parent || !event.originalStartTime) continue;
    skipped.set(parent.id, [...(skipped.get(parent.id) ?? []), localDay(event.originalStartTime)]);
  }

  const drafts: ImportDraft[] = [];
  let untimed = 0;
  for (const event of events) {
    if (event.status === "cancelled" || declined(event) || !ordinary(event)) continue;
    const shaped = shapeOf(event);
    if (!shaped) continue;
    const { shape } = shaped;

    let made: ImportDraft[];
    if (event.recurrence) {
      const plan = seriesPlan(event);
      if (!plan) continue;
      made = seriesDrafts(event, shape, plan, skipped.get(event.id) ?? []).filter(
        (r) => !r.repeatUntil || r.repeatUntil >= today,
      );
    } else {
      const over = (shape.end ?? shape.start) < today;
      made = over ? [] : [{ ...baseOf(event), ...shape, id: crypto.randomUUID(), source: sourceOf(event) }];
    }

    if (made.length && shaped.untimed) untimed++;
    drafts.push(...made);
  }
  return { drafts, untimed };
}
