import { api } from "./api";
import { gridDates } from "./habits";
import { isoDay } from "./habitsApi";
import { stubOf, type AccountHit, type PersonStub } from "./usersApi";

export type Entry = {
  person: PersonStub;
  value: number;
};

export type Board = {
  title: string;
  metric: string;
  unit: string;
  entries: Entry[];
};

type ApiBoard = {
  habit: string;
  type: "completion" | "count";
  unit: string;
  entries: { user: AccountHit; value: string | number }[];
};

/** one board per habit you track, ranking everyone who tracks the same one:
 * yes/no habits by current streak, counted ones by this week's total */
export async function loadBoards(token: string): Promise<Board[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // the week is the grid's own, sunday first — and in local time, like every date sent
  const weekStart = gridDates(1)[0];
  const res = await api(
    `/api/leaderboards?today=${isoDay(today)}&week_start=${isoDay(weekStart)}`,
    { token },
  );
  if (!res.ok) throw new Error(`leaderboards load failed (${res.status})`);

  return (res.data as { boards: ApiBoard[] }).boards.map((b) => ({
    title: b.habit,
    metric: b.type === "completion" ? "longest current streak" : "total this week",
    unit: b.type === "completion" ? "days" : b.unit,
    entries: b.entries.map((e) => ({ person: stubOf(e.user), value: Number(e.value) })),
  }));
}
