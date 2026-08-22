import { useState } from "react";
import ActivityBubbles from "./components/ActivityBubbles";
import Heatmap from "./components/Heatmap";
import NewHabit from "./components/NewHabit";
import Leaderboard from "./components/Leaderboard";
import Social from "./components/Social";
import ProfileModal from "./components/ProfileModal";
import { ME } from "./lib/people";
import Todo from "./components/Todo";
import { AvatarPreview } from "./lib/avatarKit";
import { useAvatarState } from "./lib/AvatarContext";
import { HABITS, WEEKS, type Habit } from "./lib/habits";

const NAV = ["habits", "to-do", "leaderboard", "social"];

export default function App() {
  const [tab, setTab] = useState("habits");
  const [habits, setHabits] = useState<Habit[]>(HABITS);
  const [adding, setAdding] = useState(false);
  const [showMe, setShowMe] = useState(false);
  const { photo, skin, worn } = useAvatarState();

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

          <div className="stack">
            {habits.map((habit, i) => (
              <Heatmap key={habit.name} habit={habit} seed={i + 1} />
            ))}
          </div>
          <p className="foot">last {WEEKS} weeks</p>
        </>
      )}

      {tab === "leaderboard" && <Leaderboard />}

      {tab === "social" && <Social />}

      {tab === "to-do" && <Todo />}

      {adding && (
        <NewHabit
          taken={habits.map((h) => h.name)}
          onCreate={(habit) => setHabits((list) => [...list, habit])}
          onClose={() => setAdding(false)}
        />
      )}

      {showMe && <ProfileModal person={ME} onClose={() => setShowMe(false)} />}
    </main>
  );
}
