import { useEffect, useState } from "react";
import AccountList from "./AccountList";
import SearchField from "./SearchField";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import {
  PRESETS,
  RAMPS,
  templateMeta,
  type Habit,
  type HabitTemplate,
  type RampName,
} from "../lib/habits";
import { displayName, getUserHabits, useAccountSearch, type AccountHit } from "../lib/usersApi";

const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

/** three ways to start. the last two only fill the form in — every habit is
 * still created from `custom`, so there's one place to pick a colour and one
 * duplicate check */
const MODES = [
  { id: "custom", label: "custom" },
  { id: "presets", label: "presets" },
  { id: "copy", label: "copy someone's" },
] as const;

type Mode = (typeof MODES)[number]["id"];

type Props = {
  taken: string[];
  onCreate: (habit: Habit) => void;
  onClose: () => void;
};

export default function NewHabit({ taken, onCreate, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("custom");
  const [name, setName] = useState("");
  const [toggle, setToggle] = useState(false);
  const [unit, setUnit] = useState("");
  const [goal, setGoal] = useState("");
  const [ramp, setRamp] = useState<RampName>("moss");
  // held here so the search survives a trip to another tab and back
  const [query, setQuery] = useState("");
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
  const valid = clean !== "" && !duplicate && (toggle || (unit.trim() !== "" && Number(goal) > 0));

  const fill = (t: HabitTemplate) => {
    setName(t.name);
    setToggle(t.toggle);
    setGoal(t.toggle ? "" : String(t.goal));
    setUnit(t.unit);
    setMode("custom");
  };

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

        <h3 className="add-title">new habit</h3>

        <div className="auth-tabs">
          {MODES.map((m) => (
            <button key={m.id} type="button" data-active={m.id === mode} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>

        <div className="new-body">
          {mode === "custom" && (
            <form
              className="new-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) return;
                onCreate({
                  name: clean,
                  meta: toggle ? "yes / no" : `${unit.trim()} per day`,
                  ramp: RAMPS[ramp],
                  goal: toggle ? 1 : Number(goal),
                  unit: toggle ? "" : unit.trim(),
                  toggle,
                });
                onClose();
              }}
            >
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
              </div>

              <div className="new-actions">
                <button className="new-create" type="submit" disabled={!valid}>
                  create habit
                </button>
                {duplicate && <span className="new-warn">you already track that</span>}
              </div>
            </form>
          )}

          {mode === "presets" && <TemplateList items={PRESETS} taken={taken} onPick={fill} />}

          {mode === "copy" && (
            <CopyFrom
              query={query}
              onQuery={setQuery}
              account={account}
              onAccount={setAccount}
              taken={taken}
              onPick={fill}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type ListProps = {
  items: HabitTemplate[];
  taken: string[];
  onPick: (template: HabitTemplate) => void;
  /** shown in place of the rows when there are none */
  empty?: string;
};

function TemplateList({ items, taken, onPick, empty }: ListProps) {
  return (
    <ul className="results">
      {items.length === 0 && empty && <li className="result-empty">{empty}</li>}
      {items.map((t, i) => {
        const tracked = taken.includes(t.name.trim().toLowerCase());
        return (
          <li key={i}>
            <button type="button" disabled={tracked} onClick={() => onPick(t)}>
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
  query: string;
  onQuery: (query: string) => void;
  account: AccountHit | null;
  onAccount: (account: AccountHit | null) => void;
  taken: string[];
  onPick: (template: HabitTemplate) => void;
};

/** find an account, then pick one of the habits it tracks */
function CopyFrom({ query, onQuery, account, onAccount, taken, onPick }: CopyProps) {
  const { session, profile } = useAuth();
  const token = session?.access_token;
  const myId = profile && profile !== "none" ? profile.id : null;
  const { q, results, searching } = useAccountSearch(query);
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

  // you can't copy from yourself
  const others = results.filter((u) => u.id !== myId);

  return (
    <>
      <SearchField value={query} onChange={onQuery} autoFocus />
      {q &&
        (searching && others.length === 0 ? (
          <ul className="results">
            <li className="result-empty">searching…</li>
          </ul>
        ) : (
          <AccountList results={others} searching={searching} onPick={onAccount} />
        ))}
    </>
  );
}
