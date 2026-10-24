import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { formatAmount } from "./habits";
import { peek, preload } from "./preload";
import { stubOf, type AccountHit, type PersonStub } from "./usersApi";

/** one day someone else logged */
export type Activity = {
  /** the entry's id — stable, so a poll can tell new from already-seen */
  id: string;
  person: PersonStub;
  /** "checked off gym", for one-line uses like the habits tab's bubbles */
  text: string;
  /** the words between the name and the habit: "checked off", "logged 45 min of" */
  verb: string;
  habit: string;
  /** when it was logged, ms since epoch */
  at: number;
  /** consecutive logged days of the habit, ending on this one */
  streak: number;
  /** 7, 14, 30 or 50 days, or a multiple of 100 */
  milestone: boolean;
  /** the day this streak passed the habit's previous longest */
  personalBest: boolean;
};

type ApiActivity = {
  id: string;
  user: AccountHit;
  habit: string;
  type: "completion" | "count";
  unit: string;
  value: string | number;
  logged_at: string;
  streak: number;
  milestone: boolean;
  personal_best: boolean;
};

/** "checked off", "logged 45 min of", "hit a 30-day streak on" */
function verbOf(a: ApiActivity): string {
  if (a.milestone) return `hit a ${a.streak}-day streak on`;
  if (a.type === "completion") return "checked off";
  const amount = [formatAmount(Number(a.value)), a.unit].filter(Boolean).join(" ");
  return `logged ${amount} of`;
}

/** the most recent logs from everyone but you, newest first */
export async function loadActivity(token: string, limit: number): Promise<Activity[]> {
  const res = await api(`/api/activity?limit=${limit}`, { token });
  if (!res.ok) throw new Error(`activity load failed (${res.status})`);
  return (res.data as { activity: ApiActivity[] }).activity.map((a) => {
    const verb = verbOf(a);
    return {
      id: a.id,
      person: stubOf(a.user),
      text: `${verb} ${a.habit}`,
      verb,
      habit: a.habit,
      at: new Date(a.logged_at).getTime(),
      streak: a.streak,
      milestone: a.milestone,
      personalBest: a.personal_best,
    };
  });
}

const POLL_MS = 30_000;

/** the feed, re-read on an interval while mounted. starts from the preloaded
 * copy when there is one (see `pageData`), else `null` until the first load
 * lands; a failed poll keeps whatever was last shown */
export function useActivity(limit: number): Activity[] | null {
  const token = useAuth().session?.access_token;
  const key = `activity:${limit}`;
  const [items, setItems] = useState<Activity[] | null>(() => peek<Activity[]>(key) ?? null);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    // through the shared cache, so an open tab's polls keep the preload fresh too
    const pull = () =>
      preload(key, () => loadActivity(token, limit))
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
  }, [token, limit, key]);

  return items;
}
