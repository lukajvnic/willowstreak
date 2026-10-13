import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth, type Profile } from "./auth";
import type { AvatarOwner } from "./avatarKit";
import type { HabitTemplate } from "./habits";

/** the public face of an account — what search, leaderboards and the feed all
 * carry for each person */
export type AccountHit = AvatarOwner & {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
};

type ApiCard = AccountHit & {
  bio: string;
  created_at: string | null;
  streak: number;
  best: number;
  tracked: number;
};

/** enough of someone to open their profile on — the rest loads once it's open */
export type PersonStub = AvatarOwner & {
  id: string;
  name: string;
  handle: string;
};

/** a full profile card */
export type Person = PersonStub & {
  bio: string;
  joined: string;
  streak: number;
  best: number;
  tracked: number;
};

export function displayName(u: { first_name: string; last_name: string }): string {
  return `${u.first_name} ${u.last_name}`.trim();
}

export function stubOf(u: AccountHit | Profile): PersonStub {
  return {
    id: u.id,
    name: displayName(u) || u.username,
    handle: `@${u.username}`,
    avatar: u.avatar,
    avatar_path: u.avatar_path,
  };
}

/** username-prefix search. `prefix` must already be sanitized to [a-z0-9_]. */
export async function searchUsers(token: string, prefix: string): Promise<AccountHit[]> {
  const res = await api(`/api/users?search=${encodeURIComponent(prefix)}`, { token });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return (res.data as { users: AccountHit[] }).users;
}

/** debounced account search for a search box. `q` is what actually gets sent —
 * usernames are [a-z0-9_], so the typed query collapses to that first. */
export function useAccountSearch(query: string) {
  const token = useAuth().session?.access_token;
  const [results, setResults] = useState<AccountHit[]>([]);
  const [searching, setSearching] = useState(false);
  const q = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

  useEffect(() => {
    if (!q || !token) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(token, q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200); // debounce — one request per pause, not per keystroke
    return () => clearTimeout(timer);
  }, [q, token]);

  return { q, results, searching };
}

/** what someone tracks, definition only — enough to start the same habit */
export async function getUserHabits(token: string, userId: string): Promise<HabitTemplate[]> {
  const res = await api(`/api/users/${userId}/habits`, { token });
  if (!res.ok) throw new Error(`habits load failed (${res.status})`);
  type Row = { name: string; type: "completion" | "count"; goal: number | null; unit: string };
  return (res.data as { habits: Row[] }).habits.map((row) => {
    const toggle = row.type === "completion";
    return {
      name: row.name,
      toggle,
      goal: toggle ? 1 : (row.goal ?? 1),
      unit: toggle ? "" : row.unit,
    };
  });
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** the full profile card for any account, your own included */
export async function getUserCard(token: string, userId: string): Promise<Person> {
  const res = await api(`/api/users/${userId}/card`, { token });
  if (!res.ok) throw new Error(`card load failed (${res.status})`);
  const card = (res.data as { card: ApiCard }).card;
  const joined = card.created_at ? new Date(card.created_at) : null;
  return {
    ...stubOf(card),
    bio: card.bio,
    joined: joined ? `${MONTHS[joined.getMonth()]} ${joined.getFullYear()}` : "—",
    streak: card.streak,
    best: card.best,
    tracked: card.tracked,
  };
}
