import { useEffect, useState } from "react";
import ActivityBubbles from "./components/ActivityBubbles";
import AuthGate from "./components/AuthGate";
import EditHabit, { type HabitEdit } from "./components/EditHabit";
import Heatmap from "./components/Heatmap";
import NewHabit, { type Mode } from "./components/NewHabit";
import NewHabitMenu from "./components/NewHabitMenu";
import Leaderboard from "./components/Leaderboard";
import Social from "./components/Social";
import ProfileModal from "./components/ProfileModal";
import Todo from "./components/Todo";
import { AvatarPreview } from "./lib/avatarKit";
import { useAvatarState } from "./lib/AvatarContext";
import { RAMPS, type RampName } from "./lib/habits";
import { useAuth } from "./lib/auth";
import { useFriends } from "./lib/friendsApi";
import {
  createHabit,
  deleteHabit,
  loadHabits,
  logEntry,
  saveRamp,
  updateHabit,
  type HabitWithEntries,
} from "./lib/habitsApi";
import { stubOf } from "./lib/usersApi";
import { useReminderAlerts } from "./lib/notify";
import { KEYS, preloadAllTabs, preloadTab } from "./lib/pageData";
import { forgetAll, invalidate } from "./lib/preload";

const NAV = ["habits", "to-do", "leaderboard", "social"];

export default function App() {
  const { session, ready, profile, signOut } = useAuth();
  const [tab, setTab] = useState("habits");
  const [habits, setHabits] = useState<HabitWithEntries[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState<Mode | null>(null);
  // id of the habit whose edit dialog is open
  const [editing, setEditing] = useState<string | null>(null);
  const [showMe, setShowMe] = useState(false);
  const { photo, skin, worn } = useAvatarState();

  const token = session?.access_token;
  const me = profile !== null && profile !== "none" ? profile : null;
  const signedIn = Boolean(token) && me !== null;
  // polled here so the social tab's dot is right from any tab
  const waiting = useFriends()?.incoming.length ?? 0;

  useEffect(() => {
    if (!signedIn || !token) {
      setHabits(null);
      forgetAll();
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

  // once the first tab has what it needs, fetch the other tabs' data in the
  // background, so opening any of them paints straight away instead of waiting
  // on its own round trip. idle time only, so it never slows the habits load
  const habitsReady = habits !== null;
  useEffect(() => {
    if (!habitsReady || !token) return;
    const warm = () => preloadAllTabs(token);
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(warm, { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 300);
    return () => clearTimeout(id);
  }, [habitsReady, token]);

  // clicking an alert brings you to the reminder it's about
  useReminderAlerts(signedIn ? token : undefined, () => setTab("to-do"));

  if (!ready || (session && profile === null)) return null;
  if (!signedIn || !me) return <AuthGate />;

  const log = (habitId: string | undefined, date: Date, value: number) => {
    if (!habitId || !token) return;
    // optimistic — the grid already repainted from Heatmap's local edits
    logEntry(token, habitId, date, value).catch((err) => console.error("entry save failed", err));
    // a log can move you on a leaderboard — refetch it next time it's wanted
    invalidate(KEYS.leaderboards);
  };

  // both optimistic: the page changes now, the server catches up behind it
  const saveEdit = (habitId: string, edit: HabitEdit) => {
    if (!token) return;
    saveRamp(habitId, edit.ramp);
    const patch = (list: HabitWithEntries[] | null) =>
      (list ?? []).map((h) =>
        h.habit.id !== habitId
          ? h
          : {
              ...h,
              habit: {
                ...h.habit,
                name: edit.name,
                goal: h.habit.toggle ? 1 : edit.goal,
                unit: edit.unit,
                meta: h.habit.toggle ? "yes / no" : `${edit.unit} per day`,
                ramp: RAMPS[edit.ramp],
              },
            },
      );
    setHabits(patch);
    const current = habits?.find((h) => h.habit.id === habitId)?.habit;
    if (!current) return;
    updateHabit(token, habitId, { ...edit, toggle: current.toggle })
      .then(() => invalidate(KEYS.leaderboards))
      .catch((err) => console.error("habit update failed", err));
  };

  const removeHabit = (habitId: string) => {
    if (!token) return;
    setHabits((list) => (list ?? []).filter((h) => h.habit.id !== habitId));
    deleteHabit(token, habitId)
      .then(() => invalidate(KEYS.leaderboards))
      .catch((err) => console.error("habit delete failed", err));
  };

  const editingHabit = editing ? habits?.find((h) => h.habit.id === editing)?.habit : undefined;

  return (
    <main className="page" data-tab={tab}>
      <header className="masthead">
        <nav className="brand">
          <span className="brand-mark">willowstreak</span>

          <div className="nav">
            {NAV.map((item) => (
              <button
                key={item}
                type="button"
                data-active={item === tab}
                // pointing at a tab is a strong hint it's next — top its data up now
                onPointerEnter={() => token && preloadTab(item, token)}
                onFocus={() => token && preloadTab(item, token)}
                onClick={() => setTab(item)}
                aria-label={item === "social" && waiting > 0 ? `social, ${waiting} friend requests` : undefined}
              >
                {item}
                {item === "social" && waiting > 0 && <span className="nav-dot" aria-hidden />}
              </button>
            ))}
          </div>
        </nav>

        <button
          className="me"
          type="button"
          onClick={() => setShowMe(true)}
          aria-label="your account"
        >
          <AvatarPreview tone={skin} photo={photo} head={worn.head} shirt={worn.shirt} size={34} crop />
        </button>
      </header>

      {tab === "habits" && (
        <>
          <ActivityBubbles />

          {habits === null ? (
            <p className="foot">{loadError ? `couldn't load habits — ${loadError}` : "loading…"}</p>
          ) : (
            <>
              <div className="stack">
                {habits.map(({ habit, entries }) => (
                  <Heatmap
                    key={habit.id ?? habit.name}
                    habit={habit}
                    entries={entries}
                    fit
                    onLog={(date, value) => log(habit.id, date, value)}
                    onEdit={habit.id ? () => setEditing(habit.id!) : undefined}
                  />
                ))}
              </div>
              <NewHabitMenu onPick={setAdding} />
            </>
          )}
        </>
      )}

      {tab === "leaderboard" && <Leaderboard />}

      {tab === "social" && <Social />}

      {tab === "to-do" && <Todo />}

      {adding && token && (
        <NewHabit
          mode={adding}
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
          onClose={() => setAdding(null)}
        />
      )}

      {editingHabit?.id && (
        <EditHabit
          key={editingHabit.id}
          habit={editingHabit}
          taken={(habits ?? []).map((h) => h.habit.name)}
          onSave={(edit) => saveEdit(editingHabit.id!, edit)}
          onDelete={() => removeHabit(editingHabit.id!)}
          onClose={() => setEditing(null)}
        />
      )}

      {showMe && (
        <ProfileModal
          person={stubOf(me)}
          onClose={() => setShowMe(false)}
          onSignOut={() => void signOut()}
        />
      )}
    </main>
  );
}
