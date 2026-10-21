import { loadActivity, type Activity } from "./activityApi";
import { photoUrl } from "./avatarStore";
import { loadBoards, type Board } from "./leaderboards";
import { preload } from "./preload";
import { loadTodos } from "./todosApi";
import type { PersonStub } from "./usersApi";

/** how many events the social feed shows — shared so the preload and the tab
 * ask for the same thing and land in the same cache slot */
export const FEED_SIZE = 14;

/** the habits tab's drifting bubbles — their own feed slot */
export const BUBBLES_SIZE = 10;

export const KEYS = {
  leaderboards: "leaderboards",
  todos: "todos",
  feed: `activity:${FEED_SIZE}`,
  bubbles: `activity:${BUBBLES_SIZE}`,
  friends: "friends",
} as const;

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

export function preloadAllTabs(token: string) {
  for (const tab of Object.keys(TAB_LOADS)) preloadTab(tab, token);
}
