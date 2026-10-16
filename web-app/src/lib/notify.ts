import { useEffect, useSyncExternalStore } from "react";
import { KEYS } from "./pageData";
import { peek, preload } from "./preload";
import { fmtTime, parseKey, type Reminder } from "./todos";
import { loadTodos } from "./todosApi";

/**
 * Desktop alerts for anchors — the only kind with a set moment. Each anchor
 * carries its own `alert` (minutes before it starts), stored with the reminder.
 *
 * These come from the page itself (the Notification API), not from a push
 * server, so they only fire while willo is open in some tab — a background
 * tab is fine.
 */

/** what the dialog offers, in minutes before the start. null = no alert */
export const ALERT_OPTIONS: (number | null)[] = [null, 0, 5, 10, 15, 30, 60, 120, 1440];

/** "at start", "15m before", "1h before", "1 day before" */
export function alertLabel(minutes: number | null | undefined): string {
  if (minutes == null) return "none";
  if (minutes === 0) return "at start";
  if (minutes < 60) return `${minutes}m before`;
  if (minutes === 1440) return "1 day before";
  return `${minutes / 60}h before`;
}

const SEEN_KEY = "willo:notified";
/** how often the due list is checked */
const TICK_MS = 15_000;
/** an alert this late still goes out — covers a sleeping laptop or a reload,
 * without dumping a day of missed ones on you when the page opens */
const GRACE_MS = 5 * 60_000;
/** how often the reminders are re-read, to catch edits made on another device */
const REFRESH_MS = 5 * 60_000;

export const supported = typeof window !== "undefined" && "Notification" in window;

/* ---------- permission ---------- */

// the browser has no event for a permission change, so the one place that
// asks for it tells everyone listening
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const readPermission = (): NotificationPermission | "unsupported" =>
  supported ? Notification.permission : "unsupported";

export const usePermission = () => useSyncExternalStore(subscribe, readPermission);

/** asks once, from a click — browsers ignore a request that isn't one */
export async function askPermission(): Promise<void> {
  if (!supported || Notification.permission !== "default") return;
  await Notification.requestPermission();
  listeners.forEach((l) => l());
}

/* ---------- firing ---------- */

/** keyed by the moment and lead as well as the id, so moving an anchor or
 * changing its alert re-arms it */
const seenKey = (r: Reminder) => `${r.id}@${r.start}T${r.time}-${r.alert}`;

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function markSeen(key: string) {
  try {
    // only the recent ones matter — anything older is past its grace anyway
    const next = [...readSeen().filter((k) => k !== key), key].slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // no storage: worst case a reload repeats one inside the grace window
  }
}

/** when an anchor's alert is due, or null if it has none to give */
function dueAt(r: Reminder): number | null {
  if (r.kind !== "anchor" || r.done || r.alert == null || !r.start || !r.time) return null;
  const [h, m] = r.time.split(":").map(Number);
  const d = parseKey(r.start);
  d.setHours(h, m, 0, 0);
  return d.getTime() - r.alert * 60_000;
}

function check(reminders: Reminder[], onOpen: () => void) {
  const now = Date.now();
  // re-read every tick: another open tab may have just sent one
  const seen = new Set(readSeen());
  for (const r of reminders) {
    const due = dueAt(r);
    if (due === null || due > now || now - due > GRACE_MS) continue;
    const key = seenKey(r);
    if (seen.has(key)) continue;
    markSeen(key);

    const when = r.alert === 0 ? "now" : `at ${fmtTime(r.time!)}`;
    const n = new Notification(r.title, {
      body: [when, r.place].filter(Boolean).join(" · "),
      tag: key,
    });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  }
}

/** mounted once, in App, so alerts fire whichever tab you're looking at.
 * the to-do tab writes its local edits back to the shared cache, so reading
 * that cache sees a change the moment it's made */
export function useReminderAlerts(token: string | undefined, onOpen: () => void) {
  const permission = usePermission();

  useEffect(() => {
    if (!token || permission !== "granted") return;
    let lastFetch = 0;

    const tick = () => {
      if (Date.now() - lastFetch > REFRESH_MS) {
        lastFetch = Date.now();
        preload(KEYS.todos, () => loadTodos(token)).catch(() => {});
      }
      const todos = peek<{ reminders: Reminder[] }>(KEYS.todos);
      if (todos) check(todos.reminders, onOpen);
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
    // onOpen only switches tabs; a new closure each render needn't restart the clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, permission]);
}
