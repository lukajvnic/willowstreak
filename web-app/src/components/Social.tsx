import { useEffect, useState } from "react";
import AccountList from "./AccountList";
import ProfileModal from "./ProfileModal";
import SearchField from "./SearchField";
import UserAvatar from "./UserAvatar";
import { useActivity } from "../lib/activityApi";
import { stubOf, useAccountSearch, type PersonStub } from "../lib/usersApi";

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

const FEED_SIZE = 14;

export default function Social() {
  const [query, setQuery] = useState("");
  const { q, results, searching } = useAccountSearch(query);
  const [selected, setSelected] = useState<PersonStub | null>(null);
  const events = useActivity(FEED_SIZE);
  const [now, setNow] = useState(() => Date.now());

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
              setSelected(stubOf(hit));
              setQuery("");
            }}
          />
        </div>
      ) : (
        <div className="feed">
          <div className="feed-head">
            <span className="feed-title">recent activity</span>
            <span className="live">
              <i /> live
            </span>
          </div>

          <ul className="feed-list">
            {events?.length === 0 && <li className="result-empty">nobody else has logged anything yet</li>}
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
      )}

      {selected && <ProfileModal person={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
