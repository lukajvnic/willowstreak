import { useCallback, useEffect, useState } from "react";

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

/** `invalidate` every key starting with `prefix` — e.g. all the friends lists
 * after a friendship changes, whoever's they are */
export function invalidatePrefix(prefix: string) {
  for (const key of new Set([...slots.keys(), ...versions.keys()])) {
    if (key.startsWith(prefix)) invalidate(key);
  }
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

type Held<T> = { key: string | null; data: T | undefined; error: string };

/** a tab's data: the cached copy straight away (if any), then the fresh one.
 * when `key` changes (a profile swapping to someone else) it switches to that
 * key's cached copy at once, never showing the last one's under the new key.
 * `set` is for a local edit: it shows now and is written back to the cache */
export function usePreloaded<T>(
  key: string | null,
  load: () => Promise<T>,
): { data: T | undefined; error: string; set: (value: T) => void } {
  const [held, setHeld] = useState<Held<T>>(() => ({
    key,
    data: key ? peek<T>(key) : undefined,
    error: "",
  }));
  let current = held;
  if (held.key !== key) {
    current = { key, data: key ? peek<T>(key) : undefined, error: "" };
    setHeld(current);
  }

  useEffect(() => {
    if (!key) return;
    let stale = false;
    const forKey = (patch: Partial<Held<T>>) =>
      setHeld((h) => (h.key === key ? { ...h, ...patch } : h));
    preload(key, load)
      .then((value) => !stale && forKey({ data: value }))
      .catch((err) => !stale && forKey({ error: String(err?.message ?? err) }));
    return () => {
      stale = true;
    };
    // `load` is a fresh closure each render; the key already says what's loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (value: T) => {
      if (!key) return;
      remember(key, value);
      setHeld((h) => (h.key === key ? { ...h, data: value } : h));
    },
    [key],
  );

  return { data: current.data, error: current.error, set };
}
