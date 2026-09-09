import { api } from "./api";
import type { Person } from "./people";

/** what GET /api/users?search= returns per row */
export type AccountHit = {
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

export function displayName(u: { first_name: string; last_name: string }): string {
  return `${u.first_name} ${u.last_name}`.trim();
}

/** username-prefix search. `prefix` must already be sanitized to [a-z0-9_]. */
export async function searchUsers(token: string, prefix: string): Promise<AccountHit[]> {
  const res = await api(`/api/users?search=${encodeURIComponent(prefix)}`, { token });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return (res.data as { users: AccountHit[] }).users;
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** full profile card, shaped as a `Person` so ProfileModal renders it as-is.
 * `habits` stays empty — other people's grids aren't public. */
export async function getUserCard(token: string, userId: string): Promise<Person> {
  const res = await api(`/api/users/${userId}/card`, { token });
  if (!res.ok) throw new Error(`card load failed (${res.status})`);
  const card = (res.data as { card: ApiCard }).card;
  const joined = card.created_at ? new Date(card.created_at) : null;
  return {
    name: displayName(card) || card.username,
    handle: `@${card.username}`,
    bio: card.bio,
    joined: joined ? `${MONTHS[joined.getMonth()]} ${joined.getFullYear()}` : "—",
    streak: card.streak,
    best: card.best,
    tracked: card.tracked,
    habits: [],
  };
}
