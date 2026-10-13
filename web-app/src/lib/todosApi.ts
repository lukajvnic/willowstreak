import { api } from "./api";
import type { Category, Reminder } from "./todos";

/** rows as the backend returns them */
type ApiReminder = {
  id: string;
  title: string;
  kind: Reminder["kind"];
  done: boolean;
  start_date: string | null;
  end_date: string | null;
  at_time: string | null;
  place: string;
  category_id: string | null;
};

function toReminder(row: ApiReminder): Reminder {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    done: row.done,
    start: row.start_date ?? undefined,
    end: row.end_date ?? undefined,
    // postgres hands a time back with seconds; the tab works in HH:MM
    time: row.at_time?.slice(0, 5),
    place: row.place || undefined,
    categoryId: row.category_id ?? undefined,
  };
}

/** the whole to-do tab: your reminders and the categories you've made */
export async function loadTodos(
  token: string,
): Promise<{ reminders: Reminder[]; categories: Category[] }> {
  const res = await api("/api/reminders", { token });
  if (!res.ok) throw new Error(`reminders load failed (${res.status})`);
  const data = res.data as { reminders: ApiReminder[]; categories: Category[] };
  return {
    reminders: data.reminders.map(toReminder),
    categories: data.categories.map(({ id, name, icon }) => ({ id, name, icon })),
  };
}

/** `r.id` is made by the client, so the row already on screen is the saved one */
export async function createReminder(token: string, r: Reminder): Promise<void> {
  const body = {
    id: r.id,
    title: r.title,
    kind: r.kind,
    done: r.done,
    start_date: r.start ?? null,
    end_date: r.end ?? null,
    at_time: r.time ?? null,
    place: r.place ?? "",
    category_id: r.categoryId ?? null,
  };
  const res = await api("/api/reminders", { method: "POST", token, body });
  if (!res.ok) throw new Error(`reminder save failed (${res.status})`);
}

export async function setReminderDone(token: string, id: string, done: boolean): Promise<void> {
  const res = await api(`/api/reminders/${id}`, { method: "PATCH", token, body: { done } });
  if (!res.ok) throw new Error(`reminder update failed (${res.status})`);
}

export async function deleteReminder(token: string, id: string): Promise<void> {
  const res = await api(`/api/reminders/${id}`, { method: "DELETE", token });
  if (!res.ok) throw new Error(`reminder delete failed (${res.status})`);
}

export async function createCategory(token: string, c: Category): Promise<void> {
  const res = await api("/api/reminder-categories", { method: "POST", token, body: c });
  if (!res.ok) throw new Error(`category save failed (${res.status})`);
}
