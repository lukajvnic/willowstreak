import { useEffect, useState, type ReactNode } from "react";
import SearchField from "./SearchField";
import { CheckIcon } from "./SocialIcons";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import { changeFriendship, mutualText, relationTo, useFriends, type Change } from "../lib/friendsApi";
import { KEYS, preloadFriendsOf } from "../lib/pageData";
import { usePreloaded } from "../lib/preload";
import { displayName, stubOf, type FriendOf, type PersonStub } from "../lib/usersApi";

type Props = {
  /** whose friends — you or a friend of yours */
  person: PersonStub;
  onClose: () => void;
  /** a friend (or you) was picked: their profile takes over */
  onOpen: (person: PersonStub) => void;
};

/** someone's friends, over their profile — searchable by name or @username,
 * with the same add / requested / accept action search has. esc closes this
 * one, not the profile under it */
export default function FriendsList({ person, onClose, onOpen }: Props) {
  const token = useAuth().session?.access_token;
  const mine = useFriends();
  // the profile underneath has already started this load (and your own is
  // warmed after sign-in), so it's usually cached by the time this opens
  const { data, error } = usePreloaded(token ? KEYS.friendsOf(person.id) : null, () =>
    preloadFriendsOf(token!, person.id),
  );
  const list: FriendOf[] | null = data ?? null;
  const failed = error !== "";
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // your own friends list is polled and changes as you act, so it wins over
  // the relation the list came back with
  const relationOf = (f: FriendOf) => (f.relation === "self" || !mine ? f.relation : relationTo(mine, f.id));

  const act = (id: string, change: Change) => {
    if (!token) return;
    setPending((p) => new Set(p).add(id));
    changeFriendship(token, change, id)
      .catch((err) => console.error(err))
      .finally(() =>
        setPending((p) => {
          const next = new Set(p);
          next.delete(id);
          return next;
        }),
      );
  };

  const action = (f: FriendOf, name: string): ReactNode => {
    const disabled = pending.has(f.id);
    switch (relationOf(f)) {
      case "self":
        return <span className="friends-you">you</span>;
      case "outgoing":
        return (
          <button
            className="ac-btn"
            data-quiet
            type="button"
            aria-label={`cancel friend request to ${name}`}
            disabled={disabled}
            onClick={() => act(f.id, "decline")}
          >
            requested
          </button>
        );
      case "incoming":
        return (
          <button className="ac-btn" data-key type="button" disabled={disabled} onClick={() => act(f.id, "accept")}>
            accept
          </button>
        );
      case "none":
        return (
          <button className="ac-btn" type="button" disabled={disabled} onClick={() => act(f.id, "send")}>
            add friend
          </button>
        );
      default:
        return (
          <span className="friends-mark">
            <CheckIcon />
            friends
          </span>
        );
    }
  };

  const q = query.trim().replace(/^@+/, "").toLowerCase();
  const shown = (list ?? []).filter(
    (f) => !q || displayName(f).toLowerCase().includes(q) || f.username.includes(q),
  );

  return (
    <div className="scrim scrim-top" onClick={onClose}>
      <div className="modal friends-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="friends">
        <button className="modal-close" type="button" onClick={onClose} aria-label="close">
          ×
        </button>
        <h3 className="friends-title">friends</h3>

        <SearchField value={query} onChange={setQuery} autoFocus placeholder="search friends" />

        <ul className="friends-rows">
          {list === null && <li className="friends-empty">{failed ? "couldn't load friends" : "loading…"}</li>}
          {list !== null && shown.length === 0 && (
            <li className="friends-empty">{q ? `no friends match “${query.trim()}”` : "no friends yet"}</li>
          )}
          {shown.map((f) => {
            const name = displayName(f) || f.username;
            const who = (
              <>
                <UserAvatar user={f} size={40} />
                <span className="person-text">
                  <span className="person-name">{name}</span>
                  <span className="person-sub">
                    @{f.username}
                    {f.relation !== "self" && ` · ${mutualText(f.mutual_friends)}`}
                  </span>
                </span>
              </>
            );
            // only you and your friends have a profile to open
            const opens = relationOf(f) === "self" || relationOf(f) === "friends";
            return (
              <li key={f.id}>
                {opens ? (
                  <button className="friend-row" type="button" onClick={() => onOpen(stubOf(f))}>
                    {who}
                    {action(f, name)}
                  </button>
                ) : (
                  <div className="friend-row">
                    {who}
                    {action(f, name)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
