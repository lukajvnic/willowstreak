import { useEffect, useState } from "react";
import { RAMPS, type Habit, type RampName } from "../lib/habits";

const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

export type HabitEdit = { name: string; goal: number; unit: string; ramp: RampName };

type Props = {
  habit: Habit;
  /** your other habits' names — a rename can't land on one */
  taken: string[];
  onSave: (edit: HabitEdit) => void;
  onDelete: () => void;
  onClose: () => void;
};

/** the custom-habit form, prefilled. yes/no vs a number is fixed once a habit
 * exists, so that row is shown but not offered */
export default function EditHabit({ habit, taken, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(habit.name);
  const [unit, setUnit] = useState(habit.unit);
  const [goal, setGoal] = useState(habit.toggle ? "" : String(habit.goal));
  // ramps are shared constants, so the habit's own ramp is one of them by identity
  const [ramp, setRamp] = useState<RampName>(
    RAMP_NAMES.find((n) => RAMPS[n] === habit.ramp) ?? "moss",
  );
  // delete asks twice, in place — a browser confirm() would block the page
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clean = name.trim().toLowerCase();
  const duplicate = clean !== habit.name && taken.includes(clean);
  const valid =
    clean !== "" && !duplicate && (habit.toggle || (unit.trim() !== "" && Number(goal) > 0));

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

        <h3 className="add-title">edit habit</h3>

        <form
          className="new-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSave({
              name: clean,
              goal: habit.toggle ? 1 : Number(goal),
              unit: habit.toggle ? "" : unit.trim(),
              ramp,
            });
            onClose();
          }}
        >
          <div className="new-pane">
            <div className="new-grid">
              <label className="new-row">
                <span className="new-label">name</span>
                <input
                  className="new-input"
                  value={name}
                  maxLength={24}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <div className="new-row">
                <span className="new-label">tracks</span>
                <span className="new-note">{habit.toggle ? "yes / no" : "a number"}</span>
              </div>

              {!habit.toggle && (
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
            <button className="new-create" type="submit" disabled={!valid}>
              save changes
            </button>
            {duplicate && <span className="new-warn">you already track that</span>}
            <button
              className="new-delete"
              type="button"
              data-confirming={confirming}
              onClick={() => {
                if (!confirming) return setConfirming(true);
                onDelete();
                onClose();
              }}
              onBlur={() => setConfirming(false)}
            >
              {confirming ? "sure? delete it" : "delete habit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
