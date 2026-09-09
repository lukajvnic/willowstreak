import { useEffect, useMemo, useRef, useState } from "react";
import DayPopover from "./DayPopover";
import HabitToday from "./HabitToday";
import {
  buildSeries,
  formatAmount,
  formatDay,
  gridDates,
  levelFor,
  monthLabels,
  statsFor,
  todayIndex,
  WEEKS,
  type Habit,
} from "../lib/habits";

const DAY_LABELS = ["", "mon", "", "wed", "", "fri", ""];

type Props = {
  habit: Habit;
  seed: number;
  weeks?: number;
  cell?: number;
  /** someone else's habit — stats still read, but their days aren't yours to log */
  readOnly?: boolean;
  /** day index -> amount from the server. when present the seeded mock series is off */
  entries?: Record<number, number>;
  /** fires with the cell's date whenever a day is logged or changed */
  onLog?: (date: Date, value: number) => void;
};

type Open = { index: number; centerX: number; panelWidth: number; top: number };

export default function Heatmap({ habit, seed, weeks = WEEKS, cell = 14, readOnly = false, entries, onLog }: Props) {
  // day index -> amount, for days you've touched. everything else shows the seeded value
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<Open | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const series = useMemo(() => {
    if (!entries) return buildSeries(seed, habit, weeks);
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const amount = entries[i] ?? 0;
      return { level: levelFor(amount, habit.goal), amount };
    });
  }, [entries, seed, habit, weeks]);
  const dates = useMemo(() => gridDates(weeks), [weeks]);
  const months = useMemo(() => monthLabels(dates, weeks), [dates, weeks]);
  const today = useMemo(() => todayIndex(weeks), [weeks]);

  const days = useMemo(() => {
    const touched = Object.keys(edits);
    if (touched.length === 0) return series;
    const next = series.slice();
    for (const key of touched) {
      const i = Number(key);
      next[i] = { level: levelFor(edits[i], habit.goal), amount: edits[i] };
    }
    return next;
  }, [series, edits, habit.goal]);

  const stats = useMemo(() => statsFor(days, today), [days, today]);

  // dismiss on outside click or escape. clicks on this panel's cells reposition instead
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target) && target.closest(".day-pop, .cell")) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openCell = (i: number, el: HTMLElement) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open?.index === i) return setOpen(null);

    const p = panel.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    // the popover clamps itself once measured — it sizes to its own text
    setOpen({
      index: i,
      centerX: c.left + c.width / 2 - p.left,
      panelWidth: p.width,
      top: c.top - p.top - 8,
    });
  };

  const logDay = (i: number, v: number) => {
    setEdits((e) => ({ ...e, [i]: v }));
    onLog?.(dates[i], v);
  };

  const rampVars = {
    "--c0": habit.ramp[0],
    "--c1": habit.ramp[1],
    "--c2": habit.ramp[2],
    "--c3": habit.ramp[3],
    "--c4": habit.ramp[4],
    "--cell": `${cell}px`,
    "--gap": cell > 14 ? "5px" : "3px",
  } as React.CSSProperties;

  const rows: [string, string][] = habit.toggle
    ? [
        ["streak", `${stats.streak} days`],
        ["done", `${stats.done} days`],
        ["rate", `${Math.round(stats.rate * 100)}%`],
      ]
    : [
        ["streak", `${stats.streak} days`],
        ["average", `${formatAmount(stats.average)} ${habit.unit}`],
        ["std deviation", `${formatAmount(stats.deviation)} ${habit.unit}`],
      ];

  return (
    <section className="panel" style={rampVars} ref={panelRef}>
      <div className="panel-head">
        <h2 className="panel-title">{habit.name}</h2>
        <span className="panel-meta">{habit.meta}</span>
      </div>

      <div className="heatmap">
        <div className="day-labels">
          {DAY_LABELS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        <div className="grid-wrap">
          <div className="months">
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          <div className="grid">
            {Array.from({ length: weeks * 7 }, (_, i) => (
              <button
                key={i}
                className="cell"
                type="button"
                // 364 cells would otherwise be 364 tab stops — the today field is the keyboard path
                tabIndex={-1}
                disabled={readOnly || i > today}
                data-level={days[i].level}
                data-today={i === today}
                data-open={open?.index === i}
                aria-label={`${formatDay(dates[i])}, ${formatAmount(days[i].amount)} ${habit.unit}`}
                onClick={(e) => openCell(i, e.currentTarget)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="panel-foot">
        <dl className="habit-stats">
          {rows.map(([label, value]) => (
            <div key={label} className="habit-stat">
              <dt>{label}:</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {!readOnly && today >= 0 && (
          <HabitToday
            habit={habit}
            value={days[today].amount}
            onSet={(v) => logDay(today, v)}
          />
        )}
      </div>

      {open && (
        <DayPopover
          habit={habit}
          date={dates[open.index]}
          value={days[open.index].amount}
          centerX={open.centerX}
          panelWidth={open.panelWidth}
          top={open.top}
          onSet={(v) => logDay(open.index, v)}
        />
      )}
    </section>
  );
}
