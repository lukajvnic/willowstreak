import { useLayoutEffect, useRef, useState } from "react";
import { formatAmount, formatDay, type Habit } from "../lib/habits";

type Props = {
  habit: Habit;
  date: Date;
  value: number;
  /** cell centre and panel width, both relative to the panel */
  centerX: number;
  panelWidth: number;
  top: number;
  /** "tip" is the read-only hover label; "edit" is the amount field a click opens */
  mode: "tip" | "edit";
  onSet?: (value: number) => void;
  onClose?: () => void;
};

const EDGE = 8;

/** "done" / "not done" for a yes-no habit, "25 pushups" for a counted one */
function describe(habit: Habit, value: number) {
  if (habit.toggle) return value > 0 ? "done" : "not done";
  return [formatAmount(value), habit.unit].filter(Boolean).join(" ");
}

export default function DayPopover({
  habit,
  date,
  value,
  centerX,
  panelWidth,
  top,
  mode,
  onSet,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(value > 0 ? String(value) : "");
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  // the popover sizes to its text, so it can only be clamped once it has been measured.
  // a layout effect runs before paint, so the corrected position is the first one drawn.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const max = Math.max(EDGE, panelWidth - w - EDGE);
    setLeft(Math.min(Math.max(centerX - w / 2, EDGE), max));
  }, [centerX, panelWidth, value, mode, habit.unit]);

  const commit = () => {
    onSet?.(draft === "" ? 0 : Math.max(0, Math.round(Number(draft))));
    onClose?.();
  };

  return (
    <div
      className="day-pop"
      data-mode={mode}
      ref={ref}
      role={mode === "tip" ? "tooltip" : undefined}
      style={{ left: left ?? centerX, top, visibility: left === null ? "hidden" : undefined }}
    >
      {/* with a year's worth of cells, the year matters near the january seam */}
      <span className="day-pop-date">
        {formatDay(date)} {date.getFullYear()}
      </span>

      {mode === "tip" ? (
        <b className="day-pop-value">{describe(habit, value)}</b>
      ) : (
        <form
          className="day-pop-line"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            className="day-pop-input"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={draft}
            placeholder="0"
            inputMode="numeric"
            maxLength={5}
            aria-label={`${habit.name} on ${formatDay(date)} in ${habit.unit}`}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
            onBlur={commit}
          />
          <span className="day-pop-unit">{habit.unit}</span>
        </form>
      )}
    </div>
  );
}
