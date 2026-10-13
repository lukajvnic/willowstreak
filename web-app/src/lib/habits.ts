export type Habit = {
  /** server id — absent on someone else's habit, which comes without one */
  id?: string;
  name: string;
  meta: string;
  /** css color ramp, lightest -> darkest */
  ramp: [string, string, string, string, string];
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

/** the part of a habit you can start from — a preset, or one copied off someone */
export type HabitTemplate = Pick<Habit, "name" | "goal" | "unit" | "toggle">;

export const PRESETS: HabitTemplate[] = [
  { name: "gym", toggle: true, goal: 1, unit: "" },
  { name: "running", toggle: false, goal: 5, unit: "km" },
  { name: "walking", toggle: false, goal: 10000, unit: "steps" },
  { name: "push-ups", toggle: false, goal: 50, unit: "reps" },
  { name: "stretching", toggle: true, goal: 1, unit: "" },
  { name: "reading", toggle: false, goal: 30, unit: "min" },
  { name: "meditation", toggle: false, goal: 10, unit: "min" },
  { name: "journaling", toggle: true, goal: 1, unit: "" },
  { name: "water", toggle: false, goal: 8, unit: "glasses" },
  { name: "sleep", toggle: false, goal: 8, unit: "hours" },
  { name: "studying", toggle: false, goal: 2, unit: "hours" },
  { name: "no sugar", toggle: true, goal: 1, unit: "" },
];

/** "yes / no" or "30 min per day" — a template's shape in one line */
export function templateMeta(t: HabitTemplate): string {
  if (t.toggle) return "yes / no";
  return [t.goal.toLocaleString(), t.unit, "per day"].filter(Boolean).join(" ");
}

/** one day of a habit — the grid level and the amount behind it */
export type Day = { level: number; amount: number };

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
