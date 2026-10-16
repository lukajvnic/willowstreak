import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DayPopover from "./DayPopover";
import HabitToday from "./HabitToday";
import {
  formatAmount,
  formatDay,
  gridDates,
  levelFor,
  monthLabels,
  statsFor,
  newYearIndex,
  todayIndex,
  WEEKS,
  yearSeamPath,
  type Habit,
} from "../lib/habits";

const DAY_LABELS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** the cell size every other measure was designed around */
const BASE_CELL = 14;
/** past this a grid stops growing — any bigger and a year reads as blocks, not a pattern */
const MAX_CELL = 28;
/** the gap between cells, as a share of a cell */
const GAP_RATIO = 0.22;
/** the day-label column, and the space between it and the grid, at BASE_CELL */
const LABEL_W = 26;
const LABEL_GAP = 8;
/** `.heatmap`'s padding, both sides — room for the today ring */
const PAD = 6;

// floored, never rounded: a gap even half a pixel over the estimate, times 51
// gaps, would push the grid past the width it was fitted to
const gapFor = (cell: number) => Math.max(3, Math.floor(cell * GAP_RATIO));
/** labels and text grow with the cells, but slower — full-scale text would shout */
const labelScale = (cell: number) => 1 + (cell / BASE_CELL - 1) * 0.6;
const textScale = (cell: number) => 1 + (cell / BASE_CELL - 1) * 0.5;

/** the space left of the cells: the ring padding, the day labels and the gap after them */
const leadFor = (cell: number) => PAD / 2 + LABEL_W * labelScale(cell) + LABEL_GAP;

/** the biggest cell that fits `width` across `weeks` columns with the label
 * column's width kept clear on both sides, so the cells can sit centred */
function fitCell(width: number, weeks: number, min: number): number {
  let cell = min;
  // the label column grows with the cell, so settle it in two passes
  for (let pass = 0; pass < 2; pass++) {
    const room = width - 2 * leadFor(cell);
    cell = Math.floor(room / (weeks + GAP_RATIO * (weeks - 1)));
  }
  return Math.max(min, Math.min(MAX_CELL, cell));
}

type Props = {
  habit: Habit;
  /** day index -> amount from the server, indexed against a grid `weeks` wide */
  entries: Record<number, number>;
  weeks?: number;
  cell?: number;
  /** grow the cells (from `cell` up) to fill the panel's width, scaling the
   * labels and text with them, and centre them with the title and footer lined
   * up to the first and last column */
  fit?: boolean;
  /** someone else's habit — stats still read, but their days aren't yours to log */
  readOnly?: boolean;
  /** fires with the cell's date whenever a day is logged or changed */
  onLog?: (date: Date, value: number) => void;
};

/** where a cell sits, relative to the panel — what a popover is placed from */
type Spot = { index: number; centerX: number; panelWidth: number; top: number };

export default function Heatmap({
  habit,
  entries,
  weeks = WEEKS,
  cell: baseCell = BASE_CELL,
  fit = false,
  readOnly = false,
  onLog,
}: Props) {
  // day index -> amount, for days you've touched. everything else shows the saved value
  const [edits, setEdits] = useState<Record<number, number>>({});
  // the amount field a click opens (counted habits only), and the hover label
  const [open, setOpen] = useState<Spot | null>(null);
  const [hover, setHover] = useState<Spot | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);

  // re-measured whenever the panel resizes, before paint so there's no jump.
  // the panel and not the heatmap: the heatmap's width now follows the cells
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!fit || !el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [fit]);

  const cell = fit && width ? fitCell(width, weeks, baseCell) : baseCell;

  const series = useMemo(
    () =>
      Array.from({ length: weeks * 7 }, (_, i) => {
        const amount = entries[i] ?? 0;
        return { level: levelFor(amount, habit.goal), amount };
      }),
    [entries, habit, weeks],
  );
  const dates = useMemo(() => gridDates(weeks), [weeks]);
  const months = useMemo(() => monthLabels(dates, weeks), [dates, weeks]);
  const jan1 = useMemo(() => newYearIndex(dates), [dates]);
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

  const spotOf = (i: number, el: HTMLElement): Spot | null => {
    const panel = panelRef.current;
    if (!panel) return null;
    const p = panel.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    // the popover clamps itself once measured — it sizes to its own text
    return { index: i, centerX: c.left + c.width / 2 - p.left, panelWidth: p.width, top: c.top - p.top - 8 };
  };

  // a yes/no day just flips; a counted day opens its amount for editing
  const clickCell = (i: number, el: HTMLElement) => {
    if (readOnly || i > today) return;
    if (habit.toggle) return logDay(i, days[i].amount > 0 ? 0 : 1);
    if (open?.index === i) return setOpen(null);
    setHover(null);
    setOpen(spotOf(i, el));
  };

  const logDay = (i: number, v: number) => {
    setEdits((e) => ({ ...e, [i]: v }));
    onLog?.(dates[i], v);
  };

  const gap = gapFor(cell);
  const seam = jan1 === -1 ? null : yearSeamPath(jan1, weeks, cell, gap);

  // centred only while the labels fit to the left — on a narrow screen the
  // cells stay at their minimum and the heatmap scrolls instead
  const gridWidth = weeks * cell + (weeks - 1) * gap;
  const lead = leadFor(cell);
  const left = Math.floor((width - gridWidth) / 2);
  const centred = fit && width > 0 && left >= lead;
  // nothing is drawn past today; the grid still runs to the end of the week underneath
  const shown = today === -1 ? weeks * 7 : today + 1;

  const rampVars = {
    "--c0": habit.ramp[0],
    "--c1": habit.ramp[1],
    "--c2": habit.ramp[2],
    "--c3": habit.ramp[3],
    "--c4": habit.ramp[4],
    "--cell": `${cell}px`,
    "--gap": `${gap}px`,
    "--label": labelScale(cell),
    "--text": textScale(cell),
    ...(centred && { "--grid-w": `${gridWidth}px`, "--lead": `${lead}px`, "--left": `${left}px` }),
  } as React.CSSProperties;

  const rows: [string, string][] = habit.toggle
    ? [
        ["streak", `${stats.streak} days`],
        ["done", `${stats.done} days`],
      ]
    : [
        ["streak", `${stats.streak} days`],
        ["average", `${formatAmount(stats.average)} ${habit.unit}`],
      ];

  return (
    <section className="panel" style={rampVars} ref={panelRef} data-centred={centred}>
      <div className="panel-head">
        <h2 className="panel-title">{habit.name}</h2>
        <span className="panel-meta">{habit.meta}</span>
      </div>

      <div className="heatmap" data-seam={seam !== null}>
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
            {Array.from({ length: shown }, (_, i) => (
              <button
                key={i}
                className="cell"
                type="button"
                // 364 cells would otherwise be 364 tab stops — the today field is the keyboard path
                tabIndex={-1}
                // not `disabled`: a disabled button gets no hover, and every day shows its date
                aria-disabled={readOnly}
                data-level={days[i].level}
                data-today={i === today}
                data-open={open?.index === i}
                aria-label={`${formatDay(dates[i])}, ${formatAmount(days[i].amount)} ${habit.unit}`}
                onPointerEnter={(e) => setHover(spotOf(i, e.currentTarget))}
                onPointerLeave={() => setHover((h) => (h?.index === i ? null : h))}
                onClick={(e) => clickCell(i, e.currentTarget)}
              />
            ))}
            {seam && (
              <>
                <svg className="year-seam" aria-hidden>
                  <path d={seam} />
                </svg>
                {/* the new year's label hangs off the bottom of the line */}
                <span
                  className="year-tag"
                  aria-hidden
                  style={{ left: Math.floor(jan1 / 7) * (cell + gap) - gap / 2, top: 7 * (cell + gap) - gap / 2 + 3 }}
                >
                  {dates[jan1].getFullYear()}
                </span>
              </>
            )}
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
          key={open.index}
          mode="edit"
          habit={habit}
          date={dates[open.index]}
          value={days[open.index].amount}
          centerX={open.centerX}
          panelWidth={open.panelWidth}
          top={open.top}
          onSet={(v) => logDay(open.index, v)}
          onClose={() => setOpen(null)}
        />
      )}

      {/* the hover label stays out of the way of a field that's open for editing */}
      {hover && hover.index !== open?.index && (
        <DayPopover
          mode="tip"
          habit={habit}
          date={dates[hover.index]}
          value={days[hover.index].amount}
          centerX={hover.centerX}
          panelWidth={hover.panelWidth}
          top={hover.top}
        />
      )}
    </section>
  );
}
