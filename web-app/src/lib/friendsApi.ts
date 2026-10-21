import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { KEYS } from "./pageData";
import { invalidate, peek, preload } from "./preload";
import type { AccountHit } from "./usersApi";

export type Friends = {
  friends: AccountHit[];
  /** requests other people sent you, waiting on your accept */
  incoming: AccountHit[];
  /** requests you sent, waiting on theirs */
  outgoing: AccountHit[];
};

export type Relation = "friends" | "incoming" | "outgoing" | "none";

type ApiFriends = Record<keyof Friends, { user: AccountHit }[]>;

const POLL_MS = 30_000;

export async function loadFriends(token: string): Promise<Friends> {
  const res = await api("/api/friends", { token });
  if (!res.ok) throw new Error(`friends load failed (${res.status})`);
  const data = res.data as ApiFriends;
  return {
    friends: data.friends.map((f) => f.user),
    incoming: data.incoming.map((f) => f.user),
    outgoing: data.outgoing.map((f) => f.user),
  };
}

export function relationTo(friends: Friends, id: string): Relation {
  if (friends.friends.some((u) => u.id === id)) return "friends";
  if (friends.incoming.some((u) => u.id === id)) return "incoming";
  if (friends.outgoing.some((u) => u.id === id)) return "outgoing";
  return "none";
}

// every mounted useFriends, so a change made in one place (accepting from a
// profile) shows everywhere else (the requests list, the nav dot) at once
const listeners = new Set<(friends: Friends) => void>();

function pull(token: string): Promise<Friends> {
  return preload(KEYS.friends, () => loadFriends(token)).then((friends) => {
    listeners.forEach((listener) => listener(friends));
    return friends;
  });
}

/** your friends and requests, re-read on an interval while mounted. `null`
 * until the first load lands; a failed poll keeps whatever was last shown */
export function useFriends(): Friends | null {
  const token = useAuth().session?.access_token;
  const [friends, setFriends] = useState<Friends | null>(() => peek<Friends>(KEYS.friends) ?? null);

  useEffect(() => {
    // signed out: the next account must never see the last one's friends
    if (!token) return setFriends(null);
    listeners.add(setFriends);
    const poll = () => pull(token).catch((err) => console.error("friends load failed", err));
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      listeners.delete(setFriends);
      clearInterval(timer);
    };
  }, [token]);

  return friends;
}

type Change = "send" | "accept" | "decline" | "unfriend";

const CHANGES: Record<Change, (id: string) => [string, string]> = {
  send: (id) => ["POST", `/api/friends/requests/${id}`],
  accept: (id) => ["POST", `/api/friends/requests/${id}/accept`],
  // declines theirs or cancels yours, whichever is pending
  decline: (id) => ["DELETE", `/api/friends/requests/${id}`],
  unfriend: (id) => ["DELETE", `/api/friends/${id}`],
};

/** send, accept, decline/cancel or unfriend, then re-read. a 404 or 409 means
 * this screen was behind (they already cancelled, you're already friends), so
 * the re-read is the fix and it isn't treated as a failure. only the change
 * itself can fail: once it's saved, a re-read that doesn't land is left to the
 * next poll */
export async function changeFriendship(token: string, change: Change, id: string): Promise<void> {
  const [method, path] = CHANGES[change](id);
  const res = await api(path, { method, token });
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`friend ${change} failed (${res.status})`);
  }
  // who counts as a friend decides who's on your boards and in your feed
  invalidate(KEYS.leaderboards);
  invalidate(KEYS.feed);
  invalidate(KEYS.bubbles);
  invalidate(KEYS.friends);
  await pull(token).catch((err) => console.error("friends load failed", err));
}
