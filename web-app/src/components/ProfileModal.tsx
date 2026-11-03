import { useEffect, useState } from "react";
import AvatarCreator from "./AvatarCreator";
import FriendsList from "./FriendsList";
import Heatmap from "./Heatmap";
import UserAvatar from "./UserAvatar";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AvatarPreview } from "../lib/avatarKit";
import { useAvatarState } from "../lib/AvatarContext";
import { changeFriendship, relationTo, useFriends } from "../lib/friendsApi";
import type { HabitWithEntries } from "../lib/habitsApi";
import { KEYS, PROFILE_GRID_WEEKS, preloadCard, preloadFriendsOf, preloadGrids } from "../lib/pageData";
import { usePreloaded } from "../lib/preload";
import type { Person, PersonStub } from "../lib/usersApi";

const BIO_MAX = 160;

/** the standing figure at the top, by its height */
const FIGURE_H = 168;

type Props = { person: PersonStub; onClose: () => void; onSignOut?: () => void };

/** a friend's profile, or your own, as one centered column: avatar, name, a
 * line of handle / joined / friends, the bio, then their habits. it opens on
 * what the caller already knows — name, handle, avatar — and fills in the card
 * and the grids as they load. picking someone from the friends list swaps them
 * in here. nobody else's opens: search offers "add friend" instead */
export default function ProfileModal({ person: opened, onClose, onSignOut }: Props) {
  const { session, profile, refreshProfile } = useAuth();
  const token = session?.access_token;
  const [person, setPerson] = useState(opened);
  // both read the shared cache: your own is warmed after sign-in and anyone's
  // on hover, so they're usually there the moment this opens
  const { data: cardData, set: setCard } = usePreloaded<Person>(token ? KEYS.cardOf(person.id) : null, () =>
    preloadCard(token!, person.id),
  );
  const { data: gridsData } = usePreloaded<HabitWithEntries[]>(token ? KEYS.gridsOf(person.id) : null, () =>
    preloadGrids(token!, person.id),
  );
  const card = cardData ?? null;
  const grids = gridsData ?? null;
  const [listOpen, setListOpen] = useState(false);

  // the friends list over this one handles its own esc
  useEffect(() => {
    if (listOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, listOpen]);

  const isMe = profile !== null && profile !== "none" && profile.id === person.id;
  const friends = useFriends();
  const isFriend = !isMe && friends !== null && relationTo(friends, person.id) === "friends";

  // their friends list, so it's ready by the time "n friends" is clicked
  useEffect(() => {
    if (token) preloadFriendsOf(token, person.id).catch(() => {});
  }, [token, person.id]);
  // your own avatar comes from the live editing state, so a change shows before it's saved
  const { photo, skin, worn } = useAvatarState();
  // collapsed until the avatar itself is clicked, so opening your profile doesn't
  // dump you straight into the editor
  const [editing, setEditing] = useState(false);

  // yours is the live list, so adding or dropping someone shows straight away
  const friendCount = isMe && friends ? friends.friends.length : card?.friends;

  const saveBio = async (bio: string) => {
    if (!token || !card) return;
    const before = card.bio;
    setCard({ ...card, bio });
    const res = await api("/api/me", { method: "PATCH", token, body: { bio } });
    if (!res.ok) {
      console.error(`bio save failed (${res.status})`);
      setCard({ ...card, bio: before });
      return;
    }
    void refreshProfile();
  };

  return (
    <>
      <div className="scrim" onClick={onClose}>
        <div className="modal profile" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
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
                <AvatarPreview tone={skin} photo={photo} head={worn.head} shirt={worn.shirt} size={FIGURE_H} />
              </button>
            ) : (
              <span className="profile-figure">
              <UserAvatar user={person} size={FIGURE_H} full />
            </span>
            )}

            <h3 className="profile-name">{person.name}</h3>

            <p className="profile-meta">
              <span>{person.handle}</span>
              <span aria-hidden>·</span>
              <span>joined {card?.joined ?? "—"}</span>
              <span aria-hidden>·</span>
              <button className="profile-friends" type="button" onClick={() => setListOpen(true)}>
                <b>{friendCount ?? "—"}</b> {friendCount === 1 ? "friend" : "friends"}
              </button>
            </p>

            {isMe ? (
              card && <BioEditor bio={card.bio} onSave={saveBio} />
            ) : (
              card?.bio && <p className="profile-bio">{card.bio}</p>
            )}

            {isFriend && <Unfriend id={person.id} onDone={onClose} />}
          </div>

          {isMe && editing && <AvatarCreator />}

          <div className="profile-grids">
            {grids?.map(({ habit, entries }, i) => (
              <Heatmap key={i} habit={habit} entries={entries} weeks={PROFILE_GRID_WEEKS} cell={14} readOnly />
            ))}
            {grids?.length === 0 && <p className="profile-empty">no habits yet</p>}
          </div>

          {isMe && onSignOut && (
            <button className="auth-alt profile-signout" type="button" onClick={onSignOut}>
              sign out
            </button>
          )}
        </div>
      </div>

      {listOpen && (
        <FriendsList
          person={person}
          onClose={() => setListOpen(false)}
          onOpen={(next) => {
            setListOpen(false);
            setEditing(false);
            setPerson(next);
          }}
        />
      )}
    </>
  );
}

/** your bio, edited where it sits: click it (or "add a bio"), type, and it
 * saves on enter or when you click away. esc drops the change */
function BioEditor({ bio, onSave }: { bio: string; onSave: (bio: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        className="profile-bio profile-bio-edit"
        data-empty={!bio}
        type="button"
        onClick={() => setDraft(bio)}
        title="edit bio"
      >
        {bio || "add a bio"}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next !== bio) onSave(next);
  };

  return (
    <textarea
      className="profile-bio-input"
      value={draft}
      maxLength={BIO_MAX}
      rows={2}
      autoFocus
      placeholder="a line about you"
      aria-label="bio"
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          // just this edit — not the profile
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          setDraft(null);
        }
      }}
    />
  );
}

/** ends the friendship. asks twice, in place, then closes the profile, since
 * a profile only opens for friends */
function Unfriend({ id, onDone }: { id: string; onDone: () => void }) {
  const token = useAuth().session?.access_token;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <button
      className="new-delete"
      type="button"
      disabled={busy}
      data-confirming={confirming}
      onClick={() => {
        if (!confirming) return setConfirming(true);
        if (!token) return;
        setBusy(true);
        changeFriendship(token, "unfriend", id)
          .then(onDone)
          .catch((err) => {
            console.error(err);
            setBusy(false);
          });
      }}
      onBlur={() => setConfirming(false)}
    >
      {confirming ? "sure? unfriend" : "unfriend"}
    </button>
  );
}
