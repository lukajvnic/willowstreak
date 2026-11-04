import { api, type ApiCall } from "./api";

/** the server's own explanation when it gave one — "the database is missing a
 * migration: …" says far more than a bare status code */
function failure(what: string, res: ApiCall): Error {
  const message = (res.data as { error?: { message?: string } } | null)?.error?.message;
  return new Error(message ? `${what}: ${message}` : `${what} (${res.status})`);
}
import { CATEGORY_COLORS, DEFAULT_CATEGORIES, type Category, type Reminder } from "./todos";

/** rows as the backend returns them */
type ApiReminder = {
  id: string;
  title: string;
  kind: Reminder["kind"];
  done: boolean;
  start_date: string | null;
  end_date: string | null;
  at_time: string | null;
  /** absent until the duration migration is applied */
  duration_minutes?: number | null;
  /** absent until the alert migration is applied */
  alert_minutes?: number | null;
  /** absent until the repeat migration is applied */
  repeat?: Reminder["repeat"];
  repeat_until?: string | null;
  /** absent until the done-dates migration is applied */
  done_dates?: string[] | null;
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
    duration: row.duration_minutes ?? undefined,
    alert: row.alert_minutes ?? undefined,
    repeat: row.repeat ?? undefined,
    repeatUntil: row.repeat_until ?? undefined,
    doneDates: row.done_dates ?? undefined,
    place: row.place || undefined,
    categoryId: row.category_id ?? undefined,
  };
}

/** category rows as the backend returns them: one you made, or (with `builtin`
 * set) your changes to a built-in one. `color` / `builtin` / `hidden` are
 * absent until the colours migration is applied */
type ApiCategory = {
  id: string;
  name: string;
  icon: string;
  color?: string | null;
  builtin?: string | null;
  hidden?: boolean;
};

/** a colour for a category saved before colours existed — steady per id */
function fallbackColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return CATEGORY_COLORS[Math.abs(h) % CATEGORY_COLORS.length];
}

/** the built-ins, each with your changes laid over it (or gone, if you removed
 * it), followed by the ones you made */
function mergeCategories(rows: ApiCategory[]): Category[] {
  const builtins = DEFAULT_CATEGORIES.flatMap((d) => {
    const o = rows.find((r) => r.builtin === d.id);
    if (!o) return [d];
    if (o.hidden) return [];
    return [{ id: d.id, name: o.name, icon: o.icon, color: o.color ?? d.color }];
  });
  const own = rows
    .filter((r) => !r.builtin)
    .map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color ?? fallbackColor(r.id) }));
  return [...builtins, ...own];
}

/** the whole to-do tab: your reminders and every category you have */
export async function loadTodos(
  token: string,
): Promise<{ reminders: Reminder[]; categories: Category[] }> {
  const res = await api("/api/reminders", { token });
  if (!res.ok) throw failure("reminders load failed", res);
  const data = res.data as { reminders: ApiReminder[]; categories: ApiCategory[] };
  return {
    reminders: data.reminders.map(toReminder),
    categories: mergeCategories(data.categories),
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
    duration_minutes: r.duration ?? null,
    // only sent when there is one, so a database without the column still files the rest
    ...(r.alert != null ? { alert_minutes: r.alert } : {}),
    ...(r.repeat != null ? { repeat: r.repeat, repeat_until: r.repeatUntil ?? null } : {}),
    place: r.place ?? "",
    category_id: r.categoryId ?? null,
  };
  const res = await api("/api/reminders", { method: "POST", token, body });
  if (!res.ok) throw failure("reminder save failed", res);
}

/** rewrites everything the reminder says; `done` isn't touched */
export async function editReminder(token: string, r: Reminder): Promise<void> {
  const body = {
    title: r.title,
    kind: r.kind,
    start_date: r.start ?? null,
    end_date: r.end ?? null,
    at_time: r.time ?? null,
    duration_minutes: r.duration ?? null,
    // sent, null included, for one that has or had an alert — null clears it
    ...(r.alert !== undefined ? { alert_minutes: r.alert } : {}),
    ...(r.repeat !== undefined ? { repeat: r.repeat, repeat_until: r.repeat ? (r.repeatUntil ?? null) : null } : {}),
    place: r.place ?? "",
    category_id: r.categoryId ?? null,
  };
  const res = await api(`/api/reminders/${r.id}`, { method: "PUT", token, body });
  if (!res.ok) throw failure("reminder edit failed", res);
}

export async function setReminderDone(token: string, id: string, done: boolean): Promise<void> {
  const res = await api(`/api/reminders/${id}`, { method: "PATCH", token, body: { done } });
  if (!res.ok) throw failure("reminder update failed", res);
}

/** a repeating reminder's ticked-off occurrences, all of them, by start day */
export async function setDoneDates(token: string, id: string, doneDates: string[]): Promise<void> {
  const res = await api(`/api/reminders/${id}`, { method: "PATCH", token, body: { done_dates: doneDates } });
  if (!res.ok) throw failure("reminder update failed", res);
}

export async function deleteReminder(token: string, id: string): Promise<void> {
  const res = await api(`/api/reminders/${id}`, { method: "DELETE", token });
  if (!res.ok) throw failure("reminder delete failed", res);
}

export async function createCategory(token: string, c: Category): Promise<void> {
  const res = await api("/api/reminder-categories", { method: "POST", token, body: c });
  if (!res.ok) throw failure("category save failed", res);
}

/** rewrites a category's name, icon and colour — a built-in one included */
export async function editCategory(token: string, c: Category): Promise<void> {
  const body = { name: c.name, icon: c.icon, color: c.color };
  const res = await api(`/api/reminder-categories/${c.id}`, { method: "PUT", token, body });
  if (!res.ok) throw failure("category save failed", res);
}

/** removes a category; its reminders stay, without one */
export async function deleteCategory(token: string, id: string): Promise<void> {
  const res = await api(`/api/reminder-categories/${id}`, { method: "DELETE", token });
  if (!res.ok) throw failure("category delete failed", res);
}
