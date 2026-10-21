import { useEffect, useState } from "react";
import AccountList from "./AccountList";
import SearchField from "./SearchField";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import { useFriends } from "../lib/friendsApi";
import {
  PRESETS,
  RAMPS,
  templateMeta,
  type Habit,
  type HabitTemplate,
  type RampName,
} from "../lib/habits";
import { displayName, getUserHabits, type AccountHit } from "../lib/usersApi";

const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

/** the way in, chosen from `NewHabitMenu` before the dialog opens. a preset or
 * a friend's habit is created as picked — only `custom` asks for the details */
export type Mode = "custom" | "presets" | "copy";

const TITLES: Record<Mode, string> = {
  custom: "custom habit",
  presets: "preset habit",
  copy: "join a friend",
};

type Props = {
  mode: Mode;
  taken: string[];
  onCreate: (habit: Habit) => void;
  onClose: () => void;
};

export default function NewHabit({ mode, taken, onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [toggle, setToggle] = useState(false);
  const [unit, setUnit] = useState("");
  const [goal, setGoal] = useState("");
  const [ramp, setRamp] = useState<RampName>("moss");
  // the preset or friend's habit that's selected, and whose it is
  const [picked, setPicked] = useState<HabitTemplate | null>(null);
  const [account, setAccount] = useState<AccountHit | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clean = name.trim().toLowerCase();
  const duplicate = clean !== "" && taken.includes(clean);
  const custom: HabitTemplate | null =
    clean !== "" && !duplicate && (toggle || (unit.trim() !== "" && Number(goal) > 0))
      ? { name: clean, toggle, goal: toggle ? 1 : Number(goal), unit: toggle ? "" : unit.trim() }
      : null;

  // what "create habit" would make right now — null until there's enough to go on
  const draft = mode === "custom" ? custom : picked;

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal new-modal"
        role="dialog"
        aria-modal
        style={{ "--c4": RAMPS[ramp][4] } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="close">
          ×
        </button>

        <h3 className="add-title">{TITLES[mode]}</h3>

        {/* a form whichever pane it holds: enter in the search box can't create
            anything, because nothing is picked while that box is on screen */}
        <form
          className="new-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft) return;
            onCreate({
              ...draft,
              name: draft.name.trim().toLowerCase(),
              meta: draft.toggle ? "yes / no" : `${draft.unit} per day`,
              ramp: RAMPS[ramp],
            });
            onClose();
          }}
        >
          <div className="new-pane">
            {mode === "custom" && (
              <div className="new-grid">
                <label className="new-row">
                  <span className="new-label">name</span>
                  <input
                    className="new-input"
                    value={name}
                    placeholder="stretching"
                    maxLength={24}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

                <div className="new-row">
                  <span className="new-label">tracks</span>
                  <div className="new-seg">
                    <button type="button" data-active={toggle} onClick={() => setToggle(true)}>
                      yes / no
                    </button>
                    <button type="button" data-active={!toggle} onClick={() => setToggle(false)}>
                      a number
                    </button>
                  </div>
                </div>

                {!toggle && (
                  <div className="new-row">
                    <span className="new-label">goal</span>
                    <div className="new-pair">
                      <input
                        className="new-input"
                        value={goal}
                        placeholder="30"
                        inputMode="numeric"
                        maxLength={5}
                        aria-label="daily goal"
                        onChange={(e) => setGoal(e.target.value.replace(/\D/g, ""))}
                      />
                      <input
                        className="new-input"
                        value={unit}
                        placeholder="min"
                        maxLength={8}
                        aria-label="unit"
                        onChange={(e) => setUnit(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {mode === "presets" && (
              <TemplateList items={PRESETS} taken={taken} picked={picked} onPick={setPicked} />
            )}

            {mode === "copy" && (
              <CopyFrom
                account={account}
                // a pick belongs to the account it came off
                onAccount={(next) => {
                  setAccount(next);
                  setPicked(null);
                }}
                taken={taken}
                picked={picked}
                onPick={setPicked}
              />
            )}
          </div>

          <div className="new-row">
            <span className="new-label">colour</span>
            <div className="new-swatches">
              {RAMP_NAMES.map((n) => (
                <button
                  key={n}
                  className="swatch"
                  type="button"
                  data-active={n === ramp}
                  style={{ background: RAMPS[n][4] }}
                  aria-label={n}
                  onClick={() => setRamp(n)}
                />
              ))}
            </div>
          </div>

          <div className="new-actions">
            <button className="new-create" type="submit" disabled={!draft}>
              create habit
            </button>
            {mode === "custom" && duplicate && (
              <span className="new-warn">you already track that</span>
            )}
            {picked && (
              <span className="new-note">
                {account ? `${picked.name} from @${account.username}` : `${picked.name} preset`}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

type ListProps = {
  items: HabitTemplate[];
  taken: string[];
  /** the row "create habit" would make, if one is chosen */
  picked: HabitTemplate | null;
  onPick: (template: HabitTemplate) => void;
  /** shown in place of the rows when there are none */
  empty?: string;
};

function TemplateList({ items, taken, picked, onPick, empty }: ListProps) {
  return (
    <ul className="results">
      {items.length === 0 && empty && <li className="result-empty">{empty}</li>}
      {items.map((t, i) => {
        const tracked = taken.includes(t.name.trim().toLowerCase());
        return (
          <li key={i}>
            {/* matched by name, not identity — a friend's list is refetched
                whenever the session token rotates */}
            <button
              type="button"
              disabled={tracked}
              data-active={t.name === picked?.name}
              onClick={() => onPick(t)}
            >
              <span className="result-name">{t.name}</span>
              <span className="result-handle">{tracked ? "tracking" : templateMeta(t)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type CopyProps = {
  account: AccountHit | null;
  onAccount: (account: AccountHit | null) => void;
  taken: string[];
  picked: HabitTemplate | null;
  onPick: (template: HabitTemplate) => void;
};

/** pick a friend, then one of the habits they track. friends only, because
 * nobody else's habits are visible */
function CopyFrom({ account, onAccount, taken, picked, onPick }: CopyProps) {
  const [query, setQuery] = useState("");
  const token = useAuth().session?.access_token;
  const friends = useFriends();
  // tagged with the account it answers for, so a stale answer reads as "loading";
  // `habits: null` is a failed load
  const [loaded, setLoaded] = useState<{ id: string; habits: HabitTemplate[] | null } | null>(null);

  useEffect(() => {
    if (!account || !token) return;
    let stale = false;
    getUserHabits(token, account.id)
      .then((habits) => !stale && setLoaded({ id: account.id, habits }))
      .catch(() => !stale && setLoaded({ id: account.id, habits: null }));
    return () => {
      stale = true;
    };
  }, [account, token]);

  if (account) {
    const answer = loaded?.id === account.id ? loaded : null;
    const who = displayName(account) || account.username;
    return (
      <>
        <div className="search">
          <UserAvatar user={account} size={24} />
          <span className="result-name">{who}</span>
          <span className="result-handle">@{account.username}</span>
          <button
            className="search-clear"
            type="button"
            onClick={() => onAccount(null)}
            aria-label="pick someone else"
          >
            ×
          </button>
        </div>
        <TemplateList
          items={answer?.habits ?? []}
          taken={taken}
          picked={picked}
          onPick={onPick}
          empty={
            !answer
              ? "loading…"
              : answer.habits
                ? "nothing tracked yet"
                : "couldn't load their habits"
          }
        />
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (friends?.friends ?? []).filter(
    (u) => u.username.includes(q) || displayName(u).toLowerCase().includes(q),
  );

  return (
    <>
      <SearchField value={query} onChange={setQuery} autoFocus />
      <AccountList
        results={matches}
        searching={false}
        onPick={onAccount}
        empty={
          friends === null
            ? "loading…"
            : friends.friends.length
              ? "no friends match that"
              : "no friends yet, add some from the social tab"
        }
      />
    </>
  );
}
