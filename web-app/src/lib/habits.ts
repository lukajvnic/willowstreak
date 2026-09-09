export type Habit = {
  /** server id — absent on mock habits (friends' grids, tests) */
  id?: string;
  name: string;
  meta: string;
  /** css color ramp, lightest -> darkest */
  ramp: [string, string, string, string, string];
  /** deterministic-ish 0..1 "commitment" — higher means more filled days */
  density: number;
  /** what a full day looks like — 1 for yes/no habits */
  goal: number;
  unit: string;
  /** yes/no habit — logged with a single button instead of a typed amount */
  toggle: boolean;
};

export const WEEKS = 52;

export type RampName = "gold" | "clay" | "blue" | "moss" | "violet";

export const RAMPS: Record<RampName, Habit["ramp"]> = {
  gold: ["#3E3C3A", "#5C4A28", "#8B6C2A", "#C09231", "#F2BF48"],
  clay: ["#3E3C3A", "#573330", "#853F35", "#B75340", "#E37152"],
  blue: ["#3E3C3A", "#31404F", "#3F5C79", "#5079A6", "#6C9BD0"],
  moss: ["#3E3C3A", "#2F4238", "#3B6349", "#4D8A60", "#70B784"],
  violet: ["#3E3C3A", "#3F3349", "#584770", "#75609B", "#9C88C6"],
};

export const HABITS: Habit[] = [
  {
    name: "gym",
    meta: "yes / no",
    ramp: RAMPS.gold,
    density: 0.58,
    goal: 1,
    unit: "",
    toggle: true,
  },
  {
    name: "push-ups",
    meta: "count per day",
    ramp: RAMPS.clay,
    density: 0.62,
    goal: 100,
    unit: "reps",
    toggle: false,
  },
  {
    name: "reading",
    meta: "minutes per day",
    ramp: RAMPS.blue,
    density: 0.55,
    goal: 30,
    unit: "min",
    toggle: false,
  },
];

/** cheap seeded noise so the grids look plausible and stay stable across renders */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** one day of a habit — the grid level and the amount behind it */
export type Day = { level: number; amount: number };

/**
 * levels 1..4, each with the noise value that opens it and the slice of the goal
 * it stands for. the ratios line up with `levelFor`, so an amount always maps
 * back to the level its cell is painted with.
 */
const LEVELS = [
  { at: 0.30, ratio: [0.10, 0.33] },
  { at: 0.42, ratio: [0.34, 0.66] },
  { at: 0.55, ratio: [0.67, 0.99] },
  { at: 0.68, ratio: [1.00, 1.35] },
];

export function buildSeries(seed: number, habit: Habit, weeks: number = WEEKS): Day[] {
  const days = weeks * 7;
  return Array.from({ length: days }, (_, i) => {
    const n = noise(seed * 100 + i);
    // gentle upward trend — recent weeks a bit stronger
    const trend = 0.75 + (i / days) * 0.5;
    const v = n * habit.density * trend;

    let level = 0;
    for (let l = LEVELS.length; l > 0; l--) {
      if (v >= LEVELS[l - 1].at) {
        level = l;
        break;
      }
    }

    if (level === 0) return { level: 0, amount: 0 };
    if (habit.toggle) return { level, amount: 1 };

    // spread v across the level's band so the amount reads as a real number
    const band = LEVELS[level - 1];
    const ceiling = LEVELS[level]?.at ?? 1;
    const t = Math.min(1, (v - band.at) / (ceiling - band.at));
    const [lo, hi] = band.ratio;
    return { level, amount: Math.max(1, Math.round((lo + t * (hi - lo)) * habit.goal)) };
  });
}

export type Stats = {
  /** consecutive logged days ending today */
  streak: number;
  done: number;
  /** share of days logged, 0..1 */
  rate: number;
  /** mean and spread across logged days only — an unlogged day isn't a zero */
  average: number;
  deviation: number;
};

export function statsFor(days: Day[], today: number): Stats {
  // days after today are still drawn, but they can't count toward anything
  const upTo = today >= 0 ? days.slice(0, today + 1) : days;

  let streak = 0;
  for (let i = upTo.length - 1; i >= 0 && upTo[i].amount > 0; i--) streak++;

  const logged = upTo.filter((d) => d.amount > 0);
  const done = logged.length;
  if (done === 0) return { streak: 0, done: 0, rate: 0, average: 0, deviation: 0 };

  const average = logged.reduce((sum, d) => sum + d.amount, 0) / done;
  const variance = logged.reduce((sum, d) => sum + (d.amount - average) ** 2, 0) / done;

  return { streak, done, rate: done / upTo.length, average, deviation: Math.sqrt(variance) };
}

/** enough precision to be worth reading, never more */
export function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "wed 12 mar" — short enough for a tooltip */
export function formatDay(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** dates for every cell, column-first (col = week, row = Sun..Sat) */
export function gridDates(weeks: number): Date[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
  const start = new Date(endOfWeek);
  start.setDate(endOfWeek.getDate() - (weeks * 7 - 1));

  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** one entry per column — month name if the 1st falls in that week, else null */
export function monthLabels(dates: Date[], weeks: number): (string | null)[] {
  return Array.from({ length: weeks }, (_, c) => {
    const first = dates.slice(c * 7, c * 7 + 7).find((d) => d.getDate() === 1);
    return first ? MONTHS[first.getMonth()] : null;
  });
}

/** where a logged amount lands on the habit's 0..4 colour ramp */
export function levelFor(value: number, goal: number): number {
  if (value <= 0) return 0;
  const r = value / goal;
  if (r < 0.34) return 1;
  if (r < 0.67) return 2;
  if (r < 1) return 3;
  return 4;
}

/** index of today's cell in the grid, or -1 if it falls outside */
export function todayIndex(weeks: number = WEEKS): number {
  const now = new Date();
  return gridDates(weeks).findIndex(
    (d) =>
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate(),
  );
}
