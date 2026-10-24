import { useEffect, useState, type ReactNode } from "react";
import SearchField from "./SearchField";
import { CheckIcon } from "./SocialIcons";
import UserAvatar from "./UserAvatar";
import { mutualText, relationTo, type Change, type Friends } from "../lib/friendsApi";
import { displayName, stubOf, useAccountSearch, type PersonHit, type PersonStub } from "../lib/usersApi";

type Props = {
  friends: Friends | null;
  act: (id: string, change: Change) => void;
  busy: (id: string) => boolean;
  onOpen: (person: PersonStub) => void;
};

/** `text` with the first match of `q` marked */
function Hit({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** the search pill, with results dropping down over the page while there's a
 * query. esc clears it */
export default function SocialSearch({ friends, act, busy, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const { q, results, searching } = useAccountSearch(query);

  // esc closes the results wherever focus is: after a click on "add friend"
  // it's on that button, or on nothing once the button disables
  const open = query !== "";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuery("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // the friends list is polled and changes as you act, so it wins over the
  // relation the search came back with
  const relationOf = (hit: PersonHit) => (friends ? relationTo(friends, hit.id) : hit.relation);

  const action = (hit: PersonHit, name: string): ReactNode => {
    const disabled = busy(hit.id);
    switch (relationOf(hit)) {
      case "outgoing":
        return (
          <button
            className="ac-btn"
            data-quiet
            type="button"
            aria-label={`cancel friend request to ${name}`}
            disabled={disabled}
            onClick={() => act(hit.id, "decline")}
          >
            requested
          </button>
        );
      case "incoming":
        return (
          <button className="ac-btn" data-key type="button" disabled={disabled} onClick={() => act(hit.id, "accept")}>
            accept request
          </button>
        );
      case "none":
        return (
          <button className="ac-btn" type="button" disabled={disabled} onClick={() => act(hit.id, "send")}>
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

  const label = searching && results.length === 0
    ? "searching…"
    : `${results.length} ${results.length === 1 ? "account" : "accounts"}`;

  return (
    <div className="social-search">
      <SearchField value={query} onChange={setQuery} placeholder="search by name or @username" />

      {q && (
        <div className="search-drop" role="region" aria-label="search results">
          <div className="search-drop-head">
            <span>{label}</span>
            <span>esc to close</span>
          </div>

          {!searching && results.length === 0 && (
            <p className="search-drop-empty">
              no accounts match “{query.trim()}”. check the spelling, or invite them to willowstreak
            </p>
          )}

          <ul>
            {results.map((hit) => {
              const name = displayName(hit) || hit.username;
              const who = (
                <>
                  <UserAvatar user={hit} size={44} />
                  <span className="person-text">
                    <span className="person-name">
                      <Hit text={name} q={q} />
                    </span>
                    <span className="person-sub">
                      @<Hit text={hit.username} q={q} /> · {mutualText(hit.mutual_friends)}
                    </span>
                  </span>
                </>
              );
              // only friends have a profile to open
              const isFriend = relationOf(hit) === "friends";
              return (
                <li key={hit.id}>
                  {isFriend ? (
                    <button
                      className="search-hit"
                      type="button"
                      onClick={() => {
                        onOpen(stubOf(hit));
                        setQuery("");
                      }}
                    >
                      {who}
                      {action(hit, name)}
                    </button>
                  ) : (
                    <div className="search-hit">
                      {who}
                      {action(hit, name)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
