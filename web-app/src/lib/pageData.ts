import { loadActivity, type Activity } from "./activityApi";
import { photoUrl } from "./avatarStore";
import { loadBoards, type Board } from "./leaderboards";
import { preload } from "./preload";
import { loadTodos } from "./todosApi";
import { loadUserGrids, type HabitWithEntries } from "./habitsApi";
import { getUserCard, getUserFriends, type FriendOf, type Person, type PersonStub } from "./usersApi";

/** how many events the social feed shows — shared so the preload and the tab
 * ask for the same thing and land in the same cache slot */
export const FEED_SIZE = 10;

/** the habits tab's drifting bubbles — their own feed slot */
export const BUBBLES_SIZE = 10;

export const KEYS = {
  leaderboards: "leaderboards",
  todos: "todos",
  feed: `activity:${FEED_SIZE}`,
  bubbles: `activity:${BUBBLES_SIZE}`,
  friends: "friends",
  /** one person's friends list, as their profile shows it */
  friendsOf: (userId: string) => `friends-of:${userId}`,
  /** a profile's header: name, joined, friend count, bio */
  cardOf: (userId: string) => `card:${userId}`,
  /** a profile's habit grids */
  gridsOf: (userId: string) => `grids:${userId}`,
} as const;

/** a year won't fit the profile at a readable cell size */
export const PROFILE_GRID_WEEKS = 24;

export function preloadCard(token: string, userId: string): Promise<Person> {
  return preload(KEYS.cardOf(userId), () => getUserCard(token, userId));
}

export function preloadGrids(token: string, userId: string): Promise<HabitWithEntries[]> {
  return preload(KEYS.gridsOf(userId), () => loadUserGrids(token, userId, PROFILE_GRID_WEEKS));
}

/** everything a profile draws — warmed on hover, and for your own after sign-in,
 * so opening one paints straight away */
export function preloadProfile(token: string, userId: string) {
  const quiet = () => {
    // a failed warm-up is fine: the profile tries again itself when it opens
  };
  preloadCard(token, userId).catch(quiet);
  preloadGrids(token, userId).catch(quiet);
  preloadFriendsOf(token, userId).catch(quiet);
}

/** someone's friends list, through the cache — the profile warms it when it
 * opens and the list reads the same slot, so it's there before it's clicked */
export function preloadFriendsOf(token: string, userId: string): Promise<FriendOf[]> {
  return preload(KEYS.friendsOf(userId), () => getUserFriends(token, userId));
}

const warmed = new Set<string>();

/** start the browser fetching everyone's photos now, so the faces are already
 * cached by the time the podium draws them */
function warmPhotos(people: PersonStub[]) {
  for (const p of people) {
    if (!p.avatar_path || warmed.has(p.avatar_path)) continue;
    warmed.add(p.avatar_path);
    new Image().src = photoUrl(p.avatar_path);
  }
}

export function loadBoardsWarm(token: string): Promise<Board[]> {
  return loadBoards(token).then((boards) => {
    warmPhotos(boards.flatMap((b) => b.entries.map((e) => e.person)));
    return boards;
  });
}

export function loadFeedWarm(token: string): Promise<Activity[]> {
  return loadActivity(token, FEED_SIZE).then((feed) => {
    warmPhotos(feed.map((a) => a.person));
    return feed;
  });
}

/** what each tab needs before it can draw, keyed by its nav name. the habits
 * tab isn't here — App already loads it up front */
const TAB_LOADS: Record<string, (token: string) => Promise<unknown>> = {
  leaderboard: (token) => preload(KEYS.leaderboards, () => loadBoardsWarm(token)),
  "to-do": (token) => preload(KEYS.todos, () => loadTodos(token)),
  social: (token) => preload(KEYS.feed, () => loadFeedWarm(token)),
};

/** warm one tab's data — a no-op if it's already fresh or on its way */
export function preloadTab(tab: string, token: string) {
  TAB_LOADS[tab]?.(token).catch(() => {
    // a failed warm-up is fine: the tab tries again itself when it opens
  });
}

export function preloadAllTabs(token: string, userId?: string) {
  for (const tab of Object.keys(TAB_LOADS)) preloadTab(tab, token);
  // your own profile too, so the avatar button opens it instantly
  if (userId) preloadProfile(token, userId);
}
