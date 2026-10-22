import { useState } from "react";
import { cleanAmount, formatAmount, parseAmount, type Habit } from "../lib/habits";

type Props = {
  habit: Habit;
  value: number;
  onSet: (value: number) => void;
};

function Check() {
  return (
    <svg className="today-check" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M7.5 12.4 L10.6 15.5 L16.5 9"
        stroke="var(--dune)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HabitToday({ habit, value, onSet }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const met = value >= habit.goal;

  // yes/no habits have nothing to type — the box is the toggle
  if (habit.toggle) {
    return (
      <button
        className="today"
        type="button"
        data-met={met}
        aria-pressed={met}
        aria-label={met ? `mark ${habit.name} not done` : `mark ${habit.name} done`}
        onClick={() => onSet(met ? 0 : 1)}
      >
        <span className="today-line">
          <span className="today-label">today:</span>
          <b className="today-value">{met ? "done" : "not yet"}</b>
          {met && <Check />}
        </span>
      </button>
    );
  }

  const commit = () => {
    onSet(parseAmount(draft));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="today" data-met={met}>
        <form
          className="today-line"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <span className="today-label">today:</span>
          <input
            className="today-input"
            autoFocus
            value={draft}
            placeholder="0"
            inputMode="decimal"
            maxLength={8}
            aria-label={`${habit.name} today in ${habit.unit}`}
            onChange={(e) => setDraft(cleanAmount(e.target.value))}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
          <span className="today-unit">{habit.unit}</span>
        </form>
      </div>
    );
  }

  return (
    <button
      className="today"
      type="button"
      data-met={met}
      aria-label={`edit today's ${habit.name}`}
      onClick={() => {
        setDraft(value > 0 ? String(value) : "");
        setEditing(true);
      }}
    >
      <span className="today-line">
        <span className="today-label">today:</span>
        <b className="today-value">
          {formatAmount(value)} {habit.unit}
        </b>
        {met && <Check />}
      </span>
    </button>
  );
}
