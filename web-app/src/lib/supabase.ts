import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — see .env.example");
}

export const supabase = createClient(url, key);

/** whether this browser was signed in last time, read straight off the saved
 * session — a guess that's ready before supabase has checked it. the same test
 * is inlined in index.html for the page that shows before any of this loads */
export function hasStoredSession(): boolean {
  try {
    return Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k));
  } catch {
    return false;
  }
}
