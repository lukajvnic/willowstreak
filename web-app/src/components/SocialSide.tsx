import { useEffect, useState } from "react";
import { CheckIcon, CloseIcon } from "./SocialIcons";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import {
  dismissSuggestion,
  loadSuggestions,
  mutualText,
  relationTo,
  type Change,
  type Friends,
  type Suggestion,
} from "../lib/friendsApi";
import { displayName, type AccountHit } from "../lib/usersApi";

type Props = {
  friends: Friends | null;
  act: (id: string, change: Change) => void;
  busy: (id: string) => boolean;
};

/** requests waiting on you, hidden when there are none. one you accept stays,
 * reading "friends", until you leave the tab; one you decline goes */
export function FriendRequests({ friends, act, busy }: Props) {
  const [rows, setRows] = useState<AccountHit[]>(() => friends?.incoming ?? []);
  // new requests join the top; answered ones stay if you're now friends
  const [synced, setSynced] = useState(friends);
  if (friends !== synced) {
    setSynced(friends);
    if (friends) {
      const isIn = (list: AccountHit[], id: string) => list.some((u) => u.id === id);
      const kept = rows.filter((u) => isIn(friends.incoming, u.id) || isIn(friends.friends, u.id));
      const added = friends.incoming.filter((u) => !isIn(rows, u.id));
      setRows([...added, ...kept]);
    }
  }

  const pending = friends?.incoming.length ?? 0;
  if (rows.length === 0) return null;

  return (
    <section className="side-card" aria-labelledby="requests-title">
      <div className="side-card-head">
        <h2 id="requests-title">friend requests</h2>
        {pending > 0 && <span className="count-badge">{pending}</span>}
      </div>

      <ul>
        {rows.map((u) => {
          const name = displayName(u) || u.username;
          const accepted = friends !== null && relationTo(friends, u.id) === "friends";
          return (
            <li className="person" key={u.id}>
              <UserAvatar user={u} size={40} />
              <span className="person-text">
                <span className="person-name">{name}</span>
                <span className="person-sub">
                  @{u.username} · {mutualText(friends?.mutual[u.id] ?? 0)}
                </span>
              </span>
              {accepted ? (
                <span className="friends-mark">
                  <CheckIcon />
                  friends
                </span>
              ) : (
                <span className="person-actions">
                  <button
                    className="ac-btn"
                    data-key
                    type="button"
                    disabled={busy(u.id)}
                    onClick={() => act(u.id, "accept")}
                  >
                    accept
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={`decline request from ${name}`}
                    disabled={busy(u.id)}
                    onClick={() => act(u.id, "decline")}
                  >
                    <CloseIcon />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SHOWN = 3;
/** more than shown, so a dismissed or added one has a replacement */
const FETCHED = 8;

/** why they're suggested: the mutual friends at hop 2, the friend whose
 * friend they are at hop 3 */
function reasonOf(s: Suggestion): string {
  if (s.hop === 2) {
    return s.mutual === 1 ? `friends with ${displayName(s.via) || s.via.username}` : mutualText(s.mutual);
  }
  return `friends with ${s.via.first_name || s.via.username}'s friends`;
}

/** loaded once per visit and not polled, so someone you just added stays put
 * as "requested" instead of vanishing */
export function PeopleYouMayKnow({ friends, act, busy }: Props) {
  const token = useAuth().session?.access_token;
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    loadSuggestions(token, FETCHED)
      .then((s) => !stale && setList(s))
      .catch((err) => {
        console.error("suggestions load failed", err);
        if (!stale) setList([]);
      });
    return () => {
      stale = true;
    };
  }, [token]);

  const relationOf = (id: string) => (friends ? relationTo(friends, id) : "none");
  // friends and people who've asked you are handled elsewhere
  const visible = (list ?? [])
    .filter((s) => !dismissed.includes(s.user.id))
    .filter((s) => ["none", "outgoing"].includes(relationOf(s.user.id)))
    .slice(0, SHOWN);

  const dismiss = (id: string) => {
    if (!token) return;
    setDismissed((ids) => [...ids, id]);
    dismissSuggestion(token, id).catch((err) => console.error(err));
  };

  return (
    <section className="side-card" aria-labelledby="suggestions-title">
      <div className="side-card-head">
        <h2 id="suggestions-title">people you may know</h2>
      </div>

      {list !== null && visible.length === 0 && (
        <p className="side-card-empty">no suggestions right now. try searching above.</p>
      )}

      <ul>
        {visible.map((s) => {
          const name = displayName(s.user) || s.user.username;
          return (
            <li className="person" key={s.user.id}>
              <UserAvatar user={s.user} size={40} />
              <span className="person-text">
                <span className="person-name">{name}</span>
                <span className="person-sub">{reasonOf(s)}</span>
              </span>
              {relationOf(s.user.id) === "outgoing" ? (
                <button
                  className="ac-btn"
                  data-quiet
                  type="button"
                  aria-label={`cancel request to ${name}`}
                  disabled={busy(s.user.id)}
                  onClick={() => act(s.user.id, "decline")}
                >
                  requested
                </button>
              ) : (
                <span className="person-actions">
                  <button
                    className="ac-btn"
                    type="button"
                    aria-label={`add ${name}`}
                    disabled={busy(s.user.id)}
                    onClick={() => act(s.user.id, "send")}
                  >
                    add
                  </button>
                  <button
                    className="icon-btn"
                    data-quiet
                    type="button"
                    aria-label={`hide suggestion ${name}`}
                    onClick={() => dismiss(s.user.id)}
                  >
                    <CloseIcon />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
