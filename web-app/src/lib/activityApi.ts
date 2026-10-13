import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { formatAmount } from "./habits";
import { stubOf, type AccountHit, type PersonStub } from "./usersApi";

/** one day someone else logged */
export type Activity = {
  /** the entry's id — stable, so a poll can tell new from already-seen */
  id: string;
  person: PersonStub;
  text: string;
  /** when it was logged, ms since epoch */
  at: number;
};

type ApiActivity = {
  id: string;
  user: AccountHit;
  habit: string;
  type: "completion" | "count";
  unit: string;
  value: string | number;
  logged_at: string;
};

/** "checked off gym", "logged 45 min of reading" */
function describe(a: ApiActivity): string {
  if (a.type === "completion") return `checked off ${a.habit}`;
  const amount = [formatAmount(Number(a.value)), a.unit].filter(Boolean).join(" ");
  return `logged ${amount} of ${a.habit}`;
}

/** the most recent logs from everyone but you, newest first */
export async function loadActivity(token: string, limit: number): Promise<Activity[]> {
  const res = await api(`/api/activity?limit=${limit}`, { token });
  if (!res.ok) throw new Error(`activity load failed (${res.status})`);
  return (res.data as { activity: ApiActivity[] }).activity.map((a) => ({
    id: a.id,
    person: stubOf(a.user),
    text: describe(a),
    at: new Date(a.logged_at).getTime(),
  }));
}

const POLL_MS = 30_000;

/** the feed, re-read on an interval while mounted. `null` until the first
 * load lands; a failed poll keeps whatever was last shown */
export function useActivity(limit: number): Activity[] | null {
  const token = useAuth().session?.access_token;
  const [items, setItems] = useState<Activity[] | null>(null);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    const pull = () =>
      loadActivity(token, limit)
        .then((list) => !stale && setItems(list))
        .catch((err) => {
          console.error("activity load failed", err);
          if (!stale) setItems((prev) => prev ?? []);
        });
    void pull();
    const timer = setInterval(pull, POLL_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [token, limit]);

  return items;
}
