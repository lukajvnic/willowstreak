/**
 * Reading someone's Google Calendar, once, straight from the browser.
 *
 * Google hands the page a read-only access token that lasts about an hour
 * (its "token model"). Nothing is kept: no refresh token, nothing sent to our
 * backend, and `revokeAccess` hands the permission back when the import ends.
 */

import { seriesPlan } from "./calendarImport";
import { parseKey, shiftKey } from "./todos";

const CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/** false until a Google client id is set — the import isn't offered without one */
export const googleConfigured = Boolean(CLIENT_ID);

/** the narrowest pair that lists someone's calendars and reads their events */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

const SIGN_IN_SCRIPT = "https://accounts.google.com/gsi/client";
const API = "https://www.googleapis.com/calendar/v3";

/** how far ahead a repeat willowstreak can't express is copied in, day by day */
const FLATTEN_DAYS = 90;

/* ---------- what Google sends, cut down to what the import reads ---------- */

/** a moment as Google gives it: `date` for an all-day event, `dateTime` otherwise */
export type GoogleTime = { date?: string; dateTime?: string };

export type GoogleEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  location?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  /** on the first event of a series: its rule, as iCalendar lines */
  recurrence?: string[];
  /** on one occurrence that was moved, changed or cancelled: its series… */
  recurringEventId?: string;
  /** …and when it would have been */
  originalStartTime?: GoogleTime;
  attendees?: { self?: boolean; responseStatus?: string }[];
  /** "default" for an ordinary event; working locations, focus time and the like otherwise */
  eventType?: string;
};

export type GoogleCalendar = {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  /** the account's own calendar */
  primary: boolean;
  /** ticked in Google's own sidebar */
  shown: boolean;
};

type ApiCalendar = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
};

/* ---------- signing in ---------- */

type TokenResponse = { access_token?: string; error?: string; error_description?: string };

type TokenClient = { requestAccessToken: () => void };

type GoogleSignIn = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: (error: { type: string }) => void;
      }) => TokenClient;
      hasGrantedAllScopes: (response: TokenResponse, ...scopes: string[]) => boolean;
      revoke: (token: string, done?: () => void) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleSignIn;
  }
}

let signIn: Promise<GoogleSignIn> | null = null;

/** Google's sign-in script, fetched once. Call it before the button is pressed:
 * the sign-in window only opens from a click, and waiting on a download first
 * can lose that */
export function loadGoogle(): Promise<GoogleSignIn> {
  signIn ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SIGN_IN_SCRIPT;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("google sign-in didn't load")));
    script.onerror = () => {
      signIn = null;
      reject(new Error("couldn't reach google"));
    };
    document.head.append(script);
  });
  return signIn;
}

/** opens Google's window and resolves with a read-only token once access is
 * given — all of it, since a calendar list without its events is no use */
export async function requestAccess(): Promise<string> {
  const google = await loadGoogle();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPES.join(" "),
      callback: (response) => {
        if (!response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? "google didn't give access"));
        } else if (!google.accounts.oauth2.hasGrantedAllScopes(response, ...SCOPES)) {
          reject(new Error("both boxes on google's screen need ticking to read your calendar"));
        } else {
          resolve(response.access_token);
        }
      },
      error_callback: (error) =>
        reject(new Error(error.type === "popup_closed" ? "the google window was closed" : "google sign-in failed")),
    });
    client.requestAccessToken();
  });
}

/** hands the permission back — the next import asks again */
export function revokeAccess(token: string) {
  window.google?.accounts.oauth2.revoke(token);
}

/* ---------- reading ---------- */

type Page<T> = { items?: T[]; nextPageToken?: string };

/** every item of a paged list */
async function list<T>(token: string, path: string, params: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ ...params, maxResults: "2500", ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`${API}${path}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`google calendar didn't answer (${res.status})`);
    const page: Page<T> = await res.json();
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

export async function listCalendars(token: string): Promise<GoogleCalendar[]> {
  const rows = await list<ApiCalendar>(token, "/users/me/calendarList", {});
  return rows.map((row) => ({
    id: row.id,
    name: row.summaryOverride ?? row.summary ?? row.id,
    color: row.backgroundColor ?? "",
    primary: row.primary ?? false,
    shown: row.selected ?? false,
  }));
}

const startOfDay = (key: string) => parseKey(key).toISOString();

/**
 * Everything the import needs from one calendar, from `today` on: single
 * events, each series as its one first event, and the occurrences that were
 * moved or cancelled.
 *
 * A series willowstreak can't repeat the same way is swapped for its
 * occurrences over the next `FLATTEN_DAYS`, which come in as single events.
 * `flattened` is how many series that happened to.
 */
export async function readCalendar(
  token: string,
  calendarId: string,
  today: string,
): Promise<{ events: GoogleEvent[]; flattened: number }> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const from = startOfDay(today);
  const events = await list<GoogleEvent>(token, path, { timeMin: from, singleEvents: "false" });

  const flatten = events.filter((e) => e.recurrence && e.status !== "cancelled" && !seriesPlan(e));
  const until = startOfDay(shiftKey(today, FLATTEN_DAYS));
  const occurrences = await Promise.all(
    flatten.map((series) =>
      list<GoogleEvent>(token, `${path}/${encodeURIComponent(series.id)}/instances`, { timeMin: from, timeMax: until }),
    ),
  );

  // an occurrence that was changed is in both lists under one id — keep one
  const dropped = new Set(flatten.map((e) => e.id));
  const byId = new Map<string, GoogleEvent>();
  for (const event of [...events, ...occurrences.flat()]) {
    if (!dropped.has(event.id)) byId.set(event.id, event);
  }
  return { events: [...byId.values()], flattened: flatten.length };
}
