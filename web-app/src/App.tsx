import { useEffect, useState } from "react";
import ActivityBubbles from "./components/ActivityBubbles";
import AuthGate from "./components/AuthGate";
import Heatmap from "./components/Heatmap";
import NewHabit from "./components/NewHabit";
import Leaderboard from "./components/Leaderboard";
import Social from "./components/Social";
import ProfileModal from "./components/ProfileModal";
import { ME } from "./lib/people";
import Todo from "./components/Todo";
import { AvatarPreview } from "./lib/avatarKit";
import { useAvatarState } from "./lib/AvatarContext";
import { RAMPS, WEEKS, type RampName } from "./lib/habits";
import { useAuth } from "./lib/auth";
import {
  createHabit,
  loadHabits,
  logEntry,
  saveRamp,
  type HabitWithEntries,
} from "./lib/habitsApi";

const NAV = ["habits", "to-do", "leaderboard", "social"];

export default function App() {
  const { session, ready, profile, signOut } = useAuth();
  const [tab, setTab] = useState("habits");
  const [habits, setHabits] = useState<HabitWithEntries[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [showMe, setShowMe] = useState(false);
  const { photo, skin, worn } = useAvatarState();

  const token = session?.access_token;
  const signedIn = Boolean(token) && profile !== null && profile !== "none";

  useEffect(() => {
    if (!signedIn || !token) {
      setHabits(null);
      return;
    }
    let stale = false;
    loadHabits(token)
      .then((list) => !stale && setHabits(list))
      .catch((err) => !stale && setLoadError(String(err.message ?? err)));
    return () => {
      stale = true;
    };
  }, [signedIn, token]);

  if (!ready || (session && profile === null)) return null;
  if (!signedIn) return <AuthGate />;

  const log = (habitId: string | undefined, date: Date, value: number) => {
    if (!habitId || !token) return;
    // optimistic — the grid already repainted from Heatmap's local edits
    logEntry(token, habitId, date, value).catch((err) => console.error("entry save failed", err));
  };

  return (
    <main className="page" data-tab={tab}>
      <h1 className="wordmark">willo</h1>

      <div className="topbar">
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item}
              type="button"
              data-active={item === tab}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <button
          className="me"
          type="button"
          onClick={() => setShowMe(true)}
          aria-label="your account"
        >
          <AvatarPreview tone={skin} photo={photo} head={worn.head} shirt={worn.shirt} size={34} crop />
        </button>
      </div>

      {tab === "habits" && (
        <>
          <ActivityBubbles />

          <button className="add-habit" type="button" onClick={() => setAdding(true)}>
            new habit
          </button>

          {habits === null ? (
            <p className="foot">{loadError ? `couldn't load habits — ${loadError}` : "loading…"}</p>
          ) : (
            <>
              <div className="stack">
                {habits.map(({ habit, entries }, i) => (
                  <Heatmap
                    key={habit.id ?? habit.name}
                    habit={habit}
                    seed={i + 1}
                    entries={entries}
                    onLog={(date, value) => log(habit.id, date, value)}
                  />
                ))}
              </div>
              <p className="foot">
                {habits.length === 0 ? "no habits yet — add one" : `last ${WEEKS} weeks`}
              </p>
            </>
          )}
        </>
      )}

      {tab === "leaderboard" && <Leaderboard />}

      {tab === "social" && <Social />}

      {tab === "to-do" && <Todo />}

      {adding && token && (
        <NewHabit
          taken={(habits ?? []).map((h) => h.habit.name)}
          onCreate={(draft) => {
            const rampName = (Object.keys(RAMPS) as RampName[]).find(
              (n) => RAMPS[n] === draft.ramp,
            );
            createHabit(token, draft)
              .then((habit) => {
                if (habit.id && rampName) {
                  saveRamp(habit.id, rampName);
                  habit.ramp = RAMPS[rampName];
                }
                setHabits((list) => [...(list ?? []), { habit, entries: {} }]);
              })
              .catch((err) => console.error("habit create failed", err));
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {showMe && (
        <ProfileModal person={ME} onClose={() => setShowMe(false)} onSignOut={() => void signOut()} />
      )}
    </main>
  );
}
