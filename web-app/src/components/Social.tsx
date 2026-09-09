import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import ProfileModal from "./ProfileModal";
import { ACTIVITIES, PEOPLE, toneFor, type Person } from "../lib/people";
import { useAuth } from "../lib/auth";
import { displayName, getUserCard, searchUsers, type AccountHit } from "../lib/usersApi";

type Event = { id: number; name: string; text: string; at: number };

function ago(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function randomEvent(id: number, at: number): Event {
  return {
    id,
    name: PEOPLE[Math.floor(Math.random() * PEOPLE.length)].name,
    text: ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)],
    at,
  };
}

const SEED_COUNT = 7;

export default function Social() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);
  const nextId = useRef(SEED_COUNT);
  const [events, setEvents] = useState<Event[]>(() => {
    const now = Date.now();
    return Array.from({ length: SEED_COUNT }, (_, i) =>
      randomEvent(i, now - (i + 1) * 1000 * (40 + i * 55)),
    );
  });
  const [, tick] = useState(0);

  // new activity drops in, and timestamps stay honest between drops
  useEffect(() => {
    const add = setInterval(() => {
      setEvents((prev) => [randomEvent(nextId.current++, Date.now()), ...prev].slice(0, 14));
    }, 5000);
    const clock = setInterval(() => tick((t) => t + 1), 1000);
    return () => {
      clearInterval(add);
      clearInterval(clock);
    };
  }, []);

  // usernames are [a-z0-9_], so the query collapses to that before it's sent
  const q = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

  useEffect(() => {
    if (!q || !token) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(token, q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200); // debounce — one request per pause, not per keystroke
    return () => clearTimeout(timer);
  }, [q, token]);

  const openCard = (hit: AccountHit) => {
    if (!token) return;
    getUserCard(token, hit.id)
      .then((person) => {
        setSelected(person);
        setQuery("");
      })
      .catch((err) => console.error("card load failed", err));
  };

  return (
    <div className="social">
      <div className="search-wrap">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M16 16 L21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search accounts"
            aria-label="search accounts"
          />
          {query && (
            <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="clear">
              ×
            </button>
          )}
        </div>

      </div>

      {q ? (
        <div className="feed">
          <div className="feed-head">
            <span className="feed-title">accounts</span>
            <span className="feed-count">
              {searching ? "searching…" : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
            </span>
          </div>

          <ul className="results">
            {results.length === 0 && !searching && (
              <li className="result-empty">no accounts found</li>
            )}
            {results.map((u) => {
              const name = displayName(u) || u.username;
              return (
                <li key={u.id}>
                  <button type="button" onClick={() => openCard(u)}>
                    <Avatar name={name} tone={toneFor(name)} size={30} />
                    <span className="result-name">{name}</span>
                    <span className="result-handle">@{u.username}</span>
                  </button>
                </li>
              );
            })}
          </ul>
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
            {events.map((e) => (
              <li className="feed-item" key={e.id}>
                <Avatar name={e.name} tone={toneFor(e.name)} size={30} />
                <span className="feed-text">
                  <strong>{e.name}</strong> {e.text}!
                </span>
                <span className="feed-time">{ago(Date.now() - e.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected && <ProfileModal person={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
