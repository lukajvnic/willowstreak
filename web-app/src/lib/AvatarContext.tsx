import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { KITS, BASE_COLORS, type AvatarLook, type Category, type Kit } from "./avatarKit";
import { photoDataUrl, removePhoto, uploadPhoto } from "./avatarStore";

type Picks = Record<Category, number>;

const START_PICK = Object.fromEntries(KITS.map((k) => [k.key, 0])) as Picks;

type Worn = Record<Category, Kit["items"][number]>;

type AvatarState = {
  photo: string | null;
  setPhoto: (photo: string | null) => void;
  skin: string;
  setSkin: (skin: string) => void;
  pick: Picks;
  setPick: (pick: Picks | ((p: Picks) => Picks)) => void;
  worn: Worn;
};

const AvatarStateContext = createContext<AvatarState | null>(null);

/** where a saved look sits in each kit — an item that's gone falls back to bare */
function picksFor(look: AvatarLook | null): Picks {
  return Object.fromEntries(
    KITS.map((k) => [k.key, Math.max(0, k.items.findIndex((i) => i.id === look?.[k.key]))]),
  ) as Picks;
}

const lookOf = (skin: string, pick: Picks): AvatarLook => ({
  skin,
  head: KITS.find((k) => k.key === "head")!.items[pick.head].id,
  shirt: KITS.find((k) => k.key === "shirt")!.items[pick.shirt].id,
});

/** avatar state (photo, skin, worn items) lifted above every place that needs to
 * render or edit it — the nav-bar preview, the profile header, and the embedded
 * customization editor all read/write the same state through this.
 *
 * it is the signed-in user's saved avatar: loaded from their profile, and every
 * change is written back (the look to `users.avatar`, the photo to Storage). */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const me = profile && profile !== "none" ? profile : null;

  const [photo, setPhotoState] = useState<string | null>(null);
  const [skin, setSkin] = useState(BASE_COLORS[0]);
  const [pick, setPick] = useState<Picks>(START_PICK);
  // what the server holds, so loading an avatar isn't mistaken for editing one.
  // null until there's a profile to compare against
  const saved = useRef<{ userId: string; look: string; path: string | null } | null>(null);

  const worn = useMemo(
    () => Object.fromEntries(KITS.map((k) => [k.key, k.items[pick[k.key]]])) as Worn,
    [pick],
  );

  // look changes save themselves, debounced — stepping through hats is many
  // changes, one write. declared before the load below on purpose: effects run
  // in order, so on the render that loads a profile this one still sees
  // `saved` empty and stays quiet
  useEffect(() => {
    if (!token || !saved.current) return;
    const look = lookOf(skin, pick);
    const json = JSON.stringify(look);
    if (json === saved.current.look) return;
    const timer = setTimeout(() => {
      api("/api/me", { method: "PATCH", token, body: { avatar: look } })
        .then((res) => {
          if (!res.ok) throw new Error(`avatar save failed (${res.status})`);
          if (saved.current) saved.current.look = json;
        })
        .catch((err) => console.error("avatar save failed", err));
    }, 600);
    return () => clearTimeout(timer);
  }, [skin, pick, token]);

  // load the avatar once per account; signing out puts the default back
  useEffect(() => {
    if (!me) {
      if (!saved.current) return;
      saved.current = null;
      setSkin(BASE_COLORS[0]);
      setPick(START_PICK);
      setPhotoState(null);
      return;
    }
    if (saved.current?.userId === me.id) return;

    const nextSkin = me.avatar?.skin ?? BASE_COLORS[0];
    const nextPick = picksFor(me.avatar);
    saved.current = {
      userId: me.id,
      look: JSON.stringify(lookOf(nextSkin, nextPick)),
      path: me.avatar_path,
    };
    setSkin(nextSkin);
    setPick(nextPick);
    setPhotoState(null);
    if (me.avatar_path) {
      const userId = me.id;
      photoDataUrl(me.avatar_path)
        .then((url) => saved.current?.userId === userId && setPhotoState(url))
        .catch((err) => console.error("photo load failed", err));
    }
  }, [me]);

  const setPhoto = useCallback(
    (next: string | null) => {
      setPhotoState(next);
      const userId = saved.current?.userId;
      if (!token || !userId) return;
      const old = saved.current?.path ?? null;
      void (async () => {
        try {
          const path = next ? await uploadPhoto(userId, next) : null;
          const res = await api("/api/me", { method: "PATCH", token, body: { avatar_path: path } });
          if (!res.ok) throw new Error(`status ${res.status}`);
          if (saved.current?.userId === userId) saved.current.path = path;
          // the row no longer points at the old file, so it can go
          if (old) await removePhoto(old);
        } catch (err) {
          console.error("photo save failed", err);
        }
      })();
    },
    [token],
  );

  const value = useMemo(
    () => ({ photo, setPhoto, skin, setSkin, pick, setPick, worn }),
    [photo, setPhoto, skin, pick, worn],
  );

  return <AvatarStateContext.Provider value={value}>{children}</AvatarStateContext.Provider>;
}

export function useAvatarState() {
  const ctx = useContext(AvatarStateContext);
  if (!ctx) throw new Error("useAvatarState must be used within an AvatarProvider");
  return ctx;
}

export { START_PICK };
