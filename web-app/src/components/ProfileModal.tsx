import { useEffect, useState } from "react";
import AvatarCreator from "./AvatarCreator";
import Heatmap from "./Heatmap";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import { AvatarPreview } from "../lib/avatarKit";
import { useAvatarState } from "../lib/AvatarContext";
import { loadUserGrids, type HabitWithEntries } from "../lib/habitsApi";
import { getUserCard, type Person, type PersonStub } from "../lib/usersApi";

/** a year won't fit the modal at a readable cell size */
const GRID_WEEKS = 24;

type Props = { person: PersonStub; onClose: () => void; onSignOut?: () => void };

/** anyone's profile, your own included. it opens on what the caller already
 * knows — name, handle, avatar — and fills in the card and the grids as they load */
export default function ProfileModal({ person, onClose, onSignOut }: Props) {
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const [card, setCard] = useState<Person | null>(null);
  const [grids, setGrids] = useState<HabitWithEntries[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    getUserCard(token, person.id)
      .then((c) => !stale && setCard(c))
      .catch((err) => console.error("card load failed", err));
    loadUserGrids(token, person.id, GRID_WEEKS)
      .then((g) => !stale && setGrids(g))
      .catch((err) => console.error("grids load failed", err));
    return () => {
      stale = true;
    };
  }, [token, person.id]);

  const isMe = profile !== null && profile !== "none" && profile.id === person.id;
  // your own avatar comes from the live editing state, so a change shows before it's saved
  const { photo, skin, worn } = useAvatarState();
  // collapsed until the avatar itself is clicked, so opening your profile doesn't
  // dump you straight into the editor
  const [editing, setEditing] = useState(false);

  const stats: [string | number, string][] = [
    [card?.streak ?? "—", "day streak"],
    [card?.best ?? "—", "best streak"],
    [card?.tracked ?? "—", "habits"],
    [card?.joined ?? "—", "joined"],
  ];

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <button className="modal-close" type="button" onClick={onClose} aria-label="close">
          ×
        </button>

        <div className="profile-head">
          {isMe ? (
            <button
              type="button"
              className="profile-avatar-btn"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              aria-label={editing ? "close avatar customization" : "customize avatar"}
              title={editing ? "close avatar customization" : "customize avatar"}
            >
              <AvatarPreview tone={skin} photo={photo} head={worn.head} shirt={worn.shirt} size={64} crop />
            </button>
          ) : (
            <UserAvatar user={person} size={64} />
          )}
          <div>
            <h3 className="profile-name">{person.name}</h3>
            <p className="profile-handle">{person.handle}</p>
            {card?.bio && <p className="profile-bio">{card.bio}</p>}
          </div>
        </div>

        <div className="stats">
          {stats.map(([value, label]) => (
            <div className="stat" key={label}>
              <span className="stat-value">{value}</span>
              <span className="stat-label">{label}</span>
            </div>
          ))}
        </div>

        {isMe && editing && <AvatarCreator />}

        <div className="profile-grids">
          {grids?.map(({ habit, entries }, i) => (
            <Heatmap key={i} habit={habit} entries={entries} weeks={GRID_WEEKS} cell={14} readOnly />
          ))}
        </div>

        {isMe && onSignOut && (
          <button className="auth-alt profile-signout" type="button" onClick={onSignOut}>
            sign out
          </button>
        )}
      </div>
    </div>
  );
}
