import { api } from "./api";
import { gridDates, RAMPS, WEEKS, type Habit, type RampName } from "./habits";

/** rows as the backend returns them. someone else's habit has no id */
type ApiEntry = { entry_date: string; value: string | number };
export type ApiHabit = {
  id?: string;
  name: string;
  type: "completion" | "count";
  goal: number | null;
  unit: string;
  private?: boolean;
  entries?: ApiEntry[];
};

const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

/** the backend doesn't store colour — the picked ramp lives in this browser,
 * with a stable name-hash fallback anywhere else */
export function saveRamp(habitId: string, ramp: RampName) {
  localStorage.setItem(`willo:ramp:${habitId}`, ramp);
}

function rampFor(row: ApiHabit): Habit["ramp"] {
  const saved = row.id ? (localStorage.getItem(`willo:ramp:${row.id}`) as RampName | null) : null;
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
    goal: toggle ? 1 : (row.goal ?? 1),
    unit: toggle ? "" : row.unit,
    toggle,
    private: row.private ?? false,
  };
}

export type HabitWithEntries = {
  habit: Habit;
  /** grid day index -> amount, only days inside the grid's window */
  entries: Record<number, number>;
};

/** habits with their entries embedded, laid onto a grid `weeks` wide. `path` is
 * whose: `/api/habits` for your own, `/api/users/{id}/habits` for anyone's */
async function loadGrids(token: string, path: string, weeks: number): Promise<HabitWithEntries[]> {
  const dates = gridDates(weeks);
  const from = isoDay(dates[0]);
  const to = isoDay(dates[dates.length - 1]);
  const res = await api(`${path}?include=entries&from=${from}&to=${to}`, { token });
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

/** the habits page in one request: every habit with a year of entries embedded */
export const loadHabits = (token: string) => loadGrids(token, "/api/habits", WEEKS);

/** the grids on someone's profile — read-only, and narrower than your own */
export const loadUserGrids = (token: string, userId: string, weeks: number) =>
  loadGrids(token, `/api/users/${userId}/habits`, weeks);

export async function createHabit(
  token: string,
  input: { name: string; toggle: boolean; goal: number; unit: string; private?: boolean },
): Promise<Habit> {
  const body = input.toggle
    ? { name: input.name, type: "completion", unit: "" }
    : { name: input.name, type: "count", goal: input.goal, unit: input.unit };
  const res = await api("/api/habits", {
    method: "POST",
    token,
    body: { ...body, private: input.private ?? false },
  });
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

/** a habit's yes/no-or-count kind is fixed once made — its entries were logged
 * in that kind's terms — so only the name and a count's goal and unit change */
export async function updateHabit(
  token: string,
  habitId: string,
  input: { name: string; toggle: boolean; goal: number; unit: string },
): Promise<Habit> {
  const body = input.toggle
    ? { name: input.name }
    : { name: input.name, goal: input.goal, unit: input.unit };
  const res = await api(`/api/habits/${habitId}`, { method: "PATCH", token, body });
  if (!res.ok) throw new Error(`habit update failed (${res.status})`);
  return toUiHabit((res.data as { habit: ApiHabit }).habit);
}

/** archived server-side, not erased — it just stops coming back */
export async function deleteHabit(token: string, habitId: string): Promise<void> {
  const res = await api(`/api/habits/${habitId}`, { method: "DELETE", token });
  if (!res.ok) throw new Error(`habit delete failed (${res.status})`);
}
