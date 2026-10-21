import { useEffect, useState } from "react";

/**
 * A tiny shared cache so a tab can paint from data fetched before it opened.
 *
 * Every tab used to start fetching only when it mounted, so switching to one
 * meant staring at "loading…" for a full round trip. Now App warms each tab's
 * data in the background after sign-in (and again when a tab is hovered), and
 * the tab reads it through `usePreloaded`: cached data shows instantly, and a
 * fresh copy is fetched behind it if the cached one is getting old.
 */

type Slot = { value?: unknown; at: number; pending?: Promise<unknown> };

const slots = new Map<string, Slot>();

// bumped whenever a key's cached answer stops counting (`invalidate`, `forget`,
// `forgetAll`), so a load already in flight is neither joined nor saved after.
// otherwise a poll that started before a change lands after it and puts the
// old answer back as fresh, or one from before sign-out refills the next
// account's cache
const versions = new Map<string, number>();
let generation = 0;
const versionOf = (key: string) => `${generation}.${versions.get(key) ?? 0}`;
const bump = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);

/** cached data younger than this is served as-is, with no refetch */
const FRESH_MS = 15_000;

/** start a load for `key`, or join the one already in flight. data that's
 * still fresh is handed back without asking the server again */
export function preload<T>(key: string, load: () => Promise<T>): Promise<T> {
  const slot = slots.get(key);
  if (slot?.pending) return slot.pending as Promise<T>;
  if (slot && "value" in slot && Date.now() - slot.at < FRESH_MS) {
    return Promise.resolve(slot.value as T);
  }

  const started = versionOf(key);
  const pending: Promise<T> = load().then(
    (value) => {
      if (versionOf(key) !== started) throw new Error(`${key}: superseded by a newer load`);
      slots.set(key, { value, at: Date.now() });
      return value;
    },
    (err) => {
      // keep whatever was cached before — a failed refresh isn't a reason to lose it
      const prev = slots.get(key);
      if (prev?.pending === pending) delete prev.pending;
      throw err;
    },
  );
  slots.set(key, { ...slot, at: slot?.at ?? 0, pending });
  return pending;
}

/** whatever is cached for `key` right now, however old */
export function peek<T>(key: string): T | undefined {
  return slots.get(key)?.value as T | undefined;
}

/** a tab that changes its own data locally writes it back here, so coming back
 * to the tab later doesn't flash the version from before the change */
export function remember<T>(key: string, value: T) {
  slots.set(key, { value, at: Date.now() });
}

/** mark one key out of date: it's still shown while a fresh copy loads, but the
 * next `preload` of it asks the server instead of reusing it */
export function invalidate(key: string) {
  bump(key);
  const slot = slots.get(key);
  if (!slot) return;
  slot.at = 0;
  delete slot.pending;
}

/** drop one key, so the next `preload` of it really asks the server */
export function forget(key: string) {
  bump(key);
  slots.delete(key);
}

/** on sign-out — the next account must never see the last one's data */
export function forgetAll() {
  generation += 1;
  slots.clear();
}

/** a tab's data: the cached copy straight away (if any), then the fresh one.
 * `error` is only set when there's nothing at all to show */
export function usePreloaded<T>(
  key: string | null,
  load: () => Promise<T>,
): { data: T | undefined; error: string } {
  const [data, setData] = useState<T | undefined>(() => (key ? peek<T>(key) : undefined));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!key) return;
    let stale = false;
    preload(key, load)
      .then((value) => !stale && setData(value))
      .catch((err) => !stale && setError(String(err?.message ?? err)));
    return () => {
      stale = true;
    };
    // `load` is a fresh closure each render; the key already says what's loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error };
}
