import { useEffect, useState } from "react";
import ProfileModal from "./ProfileModal";
import { ArrowUpIcon, FlameIcon } from "./SocialIcons";
import SocialSearch from "./SocialSearch";
import { FriendRequests, PeopleYouMayKnow } from "./SocialSide";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import { changeFriendship, useFriends, type Change } from "../lib/friendsApi";
import { useLiveFeed } from "../lib/liveFeed";
import type { PersonStub } from "../lib/usersApi";

function ago(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Social() {
  const [selected, setSelected] = useState<PersonStub | null>(null);
  const { items, waiting, showNew } = useLiveFeed();
  const friends = useFriends();
  const token = useAuth().session?.access_token;
  // the people being added or answered, so a double click doesn't do it twice
  const [answering, setAnswering] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const act = (id: string, change: Change) => {
    if (!token) return;
    setAnswering((ids) => [...ids, id]);
    changeFriendship(token, change, id)
      .catch((err) => console.error(err))
      .finally(() => setAnswering((ids) => ids.filter((x) => x !== id)));
  };
  const busy = (id: string) => answering.includes(id);

  // "3h ago" stays honest between re-reads
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(clock);
  }, []);

  return (
    <div className="social">
      <SocialSearch friends={friends} act={act} busy={busy} onOpen={setSelected} />

      <div className="social-cols">
        {/* first in the markup so it stacks above the feed once the row wraps */}
        <aside className="social-side" aria-label="friends">
          <FriendRequests friends={friends} act={act} busy={busy} />
          <PeopleYouMayKnow friends={friends} act={act} busy={busy} />
        </aside>

        <section className="social-feed" aria-labelledby="feed-title">
          <div className="social-feed-head">
            <h2 id="feed-title">recent activity</h2>
            <span className="live">
              <i /> live
            </span>
          </div>

          {waiting > 0 && (
            <button className="feed-new" type="button" onClick={showNew}>
              <ArrowUpIcon />
              {waiting} new {waiting === 1 ? "update" : "updates"}
            </button>
          )}

          {items?.length === 0 && (
            <p className="feed-empty">
              {friends?.friends.length === 0
                ? "add friends to see what they're logging"
                : "your friends haven't logged anything yet"}
            </p>
          )}

          {items && items.length > 0 && (
            <ul className="feed-list">
              {/* the feed is friends only, so everyone in it has a profile to open */}
              {items.map((a) => (
                <li key={a.id} data-milestone={a.milestone || undefined}>
                  <button className="feed-row" type="button" onClick={() => setSelected(a.person)}>
                    <UserAvatar user={a.person} size={40} />
                    <span className="feed-row-body">
                      <span className="feed-row-what">
                        <strong>{a.person.name}</strong>
                        <span>{a.verb}</span>
                        <span className="habit-chip">{a.habit}</span>
                      </span>
                      <span className="feed-row-meta">
                        <FlameIcon />
                        <span>{a.personalBest ? "new personal best" : `${a.streak}-day streak`}</span>
                        <span aria-hidden>·</span>
                        <span>{ago(now - a.at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {selected && <ProfileModal person={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
