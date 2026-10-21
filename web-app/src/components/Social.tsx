import { useEffect, useState } from "react";
import AccountList from "./AccountList";
import ProfileModal from "./ProfileModal";
import SearchField from "./SearchField";
import UserAvatar from "./UserAvatar";
import { useActivity } from "../lib/activityApi";
import { useAuth } from "../lib/auth";
import { changeFriendship, relationTo, useFriends } from "../lib/friendsApi";
import { FEED_SIZE } from "../lib/pageData";
import { displayName, stubOf, useAccountSearch, type AccountHit, type PersonStub } from "../lib/usersApi";

function ago(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Social() {
  const [query, setQuery] = useState("");
  const { q, results, searching } = useAccountSearch(query);
  const [selected, setSelected] = useState<PersonStub | null>(null);
  const events = useActivity(FEED_SIZE);
  const friends = useFriends();
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const myId = profile && profile !== "none" ? profile.id : null;
  // the requests being sent or answered, so a double click doesn't do it twice
  const [answering, setAnswering] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const answer = (id: string, what: "send" | "accept" | "decline") => {
    if (!token) return;
    setAnswering((ids) => [...ids, id]);
    changeFriendship(token, what, id)
      .catch((err) => console.error(err))
      .finally(() => setAnswering((ids) => ids.filter((x) => x !== id)));
  };

  const incoming = friends?.incoming ?? [];

  // only friends (and you) have a profile to open; everyone else gets a button
  const canOpen = (u: AccountHit) =>
    u.id === myId || (friends !== null && relationTo(friends, u.id) === "friends");

  const friendAction = (u: AccountHit) => {
    if (!friends || canOpen(u)) return null;
    const relation = relationTo(friends, u.id);
    if (relation === "outgoing") {
      return (
        <button
          className="ac-btn"
          type="button"
          title="unrequest"
          disabled={answering.includes(u.id)}
          onClick={() => answer(u.id, "decline")}
        >
          requested
        </button>
      );
    }
    const accept = relation === "incoming";
    return (
      <button
        className="ac-btn"
        data-key
        type="button"
        disabled={answering.includes(u.id)}
        onClick={() => answer(u.id, accept ? "accept" : "send")}
      >
        {accept ? "accept" : "add friend"}
      </button>
    );
  };

  // timestamps stay honest between polls
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  return (
    <div className="social">
      <div className="search-wrap">
        <SearchField value={query} onChange={setQuery} />
      </div>

      {q ? (
        <div className="feed">
          <div className="feed-head">
            <span className="feed-title">accounts</span>
            <span className="feed-count">
              {searching ? "searching…" : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
            </span>
          </div>

          <AccountList
            results={results}
            searching={searching}
            onPick={(hit) => {
              if (!canOpen(hit)) return;
              setSelected(stubOf(hit));
              setQuery("");
            }}
            action={friendAction}
          />
        </div>
      ) : (
        <>
          {incoming.length > 0 && (
            <div className="feed">
              <div className="feed-head">
                <span className="feed-title">friend requests</span>
                <span className="feed-count">{incoming.length}</span>
              </div>

              <ul className="feed-list requests">
                {incoming.map((u) => (
                  <li className="feed-item" key={u.id}>
                    <UserAvatar user={u} size={30} />
                    <span className="feed-text">
                      <strong>{displayName(u) || u.username}</strong> wants to be friends
                    </span>
                    <button
                      className="ac-btn"
                      data-key
                      type="button"
                      disabled={answering.includes(u.id)}
                      onClick={() => answer(u.id, "accept")}
                    >
                      accept
                    </button>
                    <button
                      className="ac-btn"
                      type="button"
                      disabled={answering.includes(u.id)}
                      onClick={() => answer(u.id, "decline")}
                    >
                      decline
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="feed">
            <div className="feed-head">
              <span className="feed-title">recent activity</span>
              <span className="live">
                <i /> live
              </span>
            </div>

            <ul className="feed-list">
              {events?.length === 0 && (
                <li className="result-empty">
                  {friends?.friends.length === 0
                    ? "add friends to see what they're logging"
                    : "your friends haven't logged anything yet"}
                </li>
              )}
              {events?.map((e) => (
                <li className="feed-item" key={e.id}>
                  <UserAvatar user={e.person} size={30} />
                  <span className="feed-text">
                    <strong>{e.person.name}</strong> {e.text}!
                  </span>
                  <span className="feed-time">{ago(now - e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {selected && <ProfileModal person={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
