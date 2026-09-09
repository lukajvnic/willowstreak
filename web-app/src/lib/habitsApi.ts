import { api } from "./api";
import { gridDates, RAMPS, WEEKS, type Habit, type RampName } from "./habits";

/** rows as the backend returns them */
type ApiEntry = { entry_date: string; value: string | number };
type ApiHabit = {
  id: string;
  name: string;
  type: "completion" | "count";
  goal: number | null;
  unit: string;
  entries?: ApiEntry[];
};

const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

/** the backend doesn't store colour — the picked ramp lives in this browser,
 * with a stable name-hash fallback anywhere else */
export function saveRamp(habitId: string, ramp: RampName) {
  localStorage.setItem(`willo:ramp:${habitId}`, ramp);
}

function rampFor(row: ApiHabit): Habit["ramp"] {
  const saved = localStorage.getItem(`willo:ramp:${row.id}`) as RampName | null;
  if (saved && saved in RAMPS) return RAMPS[saved];
  let h = 0;
  for (let i = 0; i < row.name.length; i++) h = (h * 31 + row.name.charCodeAt(i)) >>> 0;
  return RAMPS[RAMP_NAMES[h % RAMP_NAMES.length]];
}

/** local-date YYYY-MM-DD — entry_date is the client's day, never UTC's */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function toUiHabit(row: ApiHabit): Habit {
  const toggle = row.type === "completion";
  return {
    id: row.id,
    name: row.name,
    meta: toggle ? "yes / no" : `${row.unit || "count"} per day`,
    ramp: rampFor(row),
    density: 0,
    goal: toggle ? 1 : (row.goal ?? 1),
    unit: toggle ? "" : row.unit,
    toggle,
  };
}

export type HabitWithEntries = {
  habit: Habit;
  /** grid day index -> amount, only days inside the current 52-week window */
  entries: Record<number, number>;
};

/** the habits page in one request: every habit with a year of entries embedded */
export async function loadHabits(token: string): Promise<HabitWithEntries[]> {
  const dates = gridDates(WEEKS);
  const from = isoDay(dates[0]);
  const to = isoDay(dates[dates.length - 1]);
  const res = await api(`/api/habits?include=entries&from=${from}&to=${to}`, { token });
  if (!res.ok) throw new Error(`habits load failed (${res.status})`);

  const index = new Map(dates.map((d, i) => [isoDay(d), i]));
  const rows = (res.data as { habits: ApiHabit[] }).habits;
  return rows.map((row) => {
    const entries: Record<number, number> = {};
    for (const e of row.entries ?? []) {
      const i = index.get(e.entry_date);
      if (i !== undefined) entries[i] = Number(e.value);
    }
    return { habit: toUiHabit(row), entries };
  });
}

export async function createHabit(
  token: string,
  input: { name: string; toggle: boolean; goal: number; unit: string },
): Promise<Habit> {
  const body = input.toggle
    ? { name: input.name, type: "completion", unit: "" }
    : { name: input.name, type: "count", goal: input.goal, unit: input.unit };
  const res = await api("/api/habits", { method: "POST", token, body });
  if (!res.ok) throw new Error(`habit create failed (${res.status})`);
  return toUiHabit((res.data as { habit: ApiHabit }).habit);
}

export async function logEntry(
  token: string,
  habitId: string,
  date: Date,
  value: number,
): Promise<void> {
  const res = await api(`/api/habits/${habitId}/entries/${isoDay(date)}`, {
    method: "PUT",
    token,
    body: { value },
  });
  if (!res.ok) throw new Error(`entry save failed (${res.status})`);
}
