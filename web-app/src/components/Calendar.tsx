import { useEffect, useRef, useState } from "react";
import {
  covers,
  DEFAULT_DURATION,
  endTime,
  fmtDay,
  fmtTime,
  keyOf,
  kindInfo,
  minutesOf,
  monthGrid,
  monthName,
  occurrenceOn,
  parseKey,
  shiftKey,
  timeOf,
  todayKey,
  type Reminder,
} from "../lib/todos";
import type { Preset } from "./AddReminder";

type Props = {
  reminders: Reminder[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** an anchor's bottom edge was dragged to a new length, in minutes */
  onResize: (r: Reminder, minutes: number) => void;
  /** an empty slot was clicked, or dragged out, on the week grid */
  onCreate: (slot: Preset) => void;
};

type View = "week" | "month";

const VIEWS: View[] = ["week", "month"];
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** one hour of grid, in px — the whole time column is laid out off this */
const HOUR_H = 46;
/** dragging a block's length moves in steps this size, and never below one */
const SNAP_MIN = 15;
const DAY_MIN = 24 * 60;

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** sunday-first week containing the given day */
function weekOf(key: string): string[] {
  const d = parseKey(key);
  const start = shiftKey(key, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => shiftKey(start, i));
}

type Placed = { r: Reminder; start: number; lane: number };

/** greedy lane assignment so two things at the same hour sit side by side */
function place(list: Reminder[], lengthOf: (r: Reminder) => number): { placed: Placed[]; lanes: number } {
  const ends: number[] = [];
  const placed = [...list]
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
    .map((r) => {
      const start = minutesOf(r.time!);
      let lane = ends.findIndex((end) => end <= start);
      if (lane === -1) lane = ends.length;
      ends[lane] = start + lengthOf(r);
      return { r, start, lane };
    });
  return { placed, lanes: Math.max(1, ends.length) };
}

export default function Calendar({ reminders, selected, onSelect, onResize, onCreate }: Props) {
  const today = todayKey();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(today);
  const [now, setNow] = useState(() => new Date());

  // the current-time line only has to be honest to the minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  // the week grid is a full 24h scroll — open it on the working hours, not midnight
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "week" || !scrollRef.current) return;
    const hour = Math.max(0, Math.min(new Date().getHours() - 2, 15));
    scrollRef.current.scrollTop = hour * HOUR_H;
  }, [view]);

  // a block being stretched shows its new length live; it's only saved on release
  const [stretch, setStretch] = useState<{ id: string; minutes: number } | null>(null);
  // the release that ends a drag also lands as a click on the block — swallow that one
  const justStretched = useRef(false);
  const lengthOf = (r: Reminder) =>
    stretch?.id === r.id ? stretch.minutes : (r.duration ?? DEFAULT_DURATION);

  const startStretch = (e: React.PointerEvent, r: Reminder, start: number) => {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const base = r.duration ?? DEFAULT_DURATION;
    // it can grow to the end of its day, never past it
    const most = Math.max(SNAP_MIN, DAY_MIN - start);
    let minutes = base;

    const move = (ev: PointerEvent) => {
      const raw = base + ((ev.clientY - y0) / HOUR_H) * 60;
      minutes = Math.min(most, Math.max(SNAP_MIN, Math.round(raw / SNAP_MIN) * SNAP_MIN));
      setStretch({ id: r.id, minutes });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("stretching");
      setStretch(null);
      justStretched.current = true;
      setTimeout(() => (justStretched.current = false), 0);
      if (minutes !== base) onResize(r, minutes);
    };

    document.body.classList.add("stretching");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // a new block being drawn on an empty stretch of a day — press, pull, let go,
  // like google calendar. a plain click drops the default hour where it landed
  const [sketch, setSketch] = useState<{ key: string; start: number; minutes: number } | null>(null);

  const startSketch = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    // a touch is a scroll; only a mouse or pen draws
    if (e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest(".event")) return;
    e.preventDefault();
    const timeline = e.currentTarget;
    // the slot under the pointer, read fresh each move in case the grid scrolled
    const slotAt = (y: number) => {
      const raw = ((y - timeline.getBoundingClientRect().top) / HOUR_H) * 60;
      return Math.min(DAY_MIN - SNAP_MIN, Math.max(0, Math.floor(raw / SNAP_MIN) * SNAP_MIN));
    };
    const y0 = e.clientY;
    const from = slotAt(y0);
    let drawn = { key, start: from, minutes: Math.min(DEFAULT_DURATION, DAY_MIN - from) };
    let dragged = false;

    const move = (ev: PointerEvent) => {
      // a few px of wobble is still a click
      if (!dragged && Math.abs(ev.clientY - y0) < 4) return;
      dragged = true;
      const to = slotAt(ev.clientY);
      // pulled upward, it grows from the slot it started on back toward the pointer
      const top = Math.min(from, to);
      drawn = { key, start: top, minutes: Math.max(from, to) + SNAP_MIN - top };
      setSketch(drawn);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("sketching");
      setSketch(null);
      if (ev.type === "pointercancel") return;
      onCreate({ start: drawn.key, time: timeOf(drawn.start), duration: drawn.minutes });
    };

    document.body.classList.add("sketching");
    setSketch(drawn);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const cursorDate = parseKey(cursor);
  const days = view === "week" ? weekOf(cursor) : monthGrid(cursorDate.getFullYear(), cursorDate.getMonth());

  function step(by: number) {
    if (view === "week") return setCursor(shiftKey(cursor, by * 7));
    const d = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + by, 1);
    setCursor(keyOf(d));
  }

  function title(): string {
    if (view === "month") return `${monthName(cursorDate.getMonth())} ${cursorDate.getFullYear()}`;
    const week = weekOf(cursor);
    return `${fmtDay(week[0])} — ${fmtDay(week[6])}`;
  }

  // the all-day strip — floaters read best as one continuous bar across the
  // days they span, and anchors with no time have no slot on the hour grid,
  // so both live up here
  const banded = reminders.filter(
    (r) =>
      (r.kind === "floater" || (r.kind === "anchor" && !r.time)) && days.some((k) => covers(r, k)),
  );

  // one chip per occurrence on screen — a repeating reminder can land in the
  // band several times a week, and each one is its own bar. every occurrence of
  // a reminder shares its row; they never overlap
  type Chip = { r: Reminder; row: number; occ: { start: string; end: string }; from: number; to: number };
  const bandChips = banded.flatMap((r, row) => {
    const runs = new Map<string, Chip>();
    days.forEach((k, i) => {
      const occ = occurrenceOn(r, k);
      if (!occ) return;
      const run = runs.get(occ.start);
      if (run) run.to = i;
      else runs.set(occ.start, { r, row, occ, from: i, to: i });
    });
    return [...runs.values()];
  });

  const nowKey = keyOf(now);
  const nowOffset = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;

  return (
    <section className="cal" data-view={view}>
      <header className="cal-head">
        <div className="cal-nav">
          <button className="cal-step" type="button" onClick={() => step(-1)} aria-label="previous">
            ‹
          </button>
          <button className="cal-step" type="button" onClick={() => step(1)} aria-label="next">
            ›
          </button>
          <button
            className="cal-today"
            type="button"
            onClick={() => {
              setCursor(today);
              onSelect(today);
            }}
          >
            today
          </button>
        </div>

        <h3 className="cal-title">{title()}</h3>

        <div className="cal-views">
          {VIEWS.map((v) => (
            <button key={v} type="button" data-active={v === view} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
      </header>

      {/* the grey card is the days alone — the heading above sits on the page */}
      <div className="cal-body">
        {view === "month" ? (
          <>
            <div className="cal-dow">
              {DOW.map((d, i) => (
                <span key={i}>{d.charAt(0)}</span>
              ))}
            </div>

            <div className="cal-grid">
              {days.map((key) => {
                const d = parseKey(key);
                const hits = reminders.filter((r) => covers(r, key));
                const floaters = hits.filter((r) => r.kind === "floater").slice(0, 3);
                const anchors = hits.filter((r) => r.kind === "anchor");

                return (
                  <button
                    key={key}
                    type="button"
                    className="day"
                    data-out={d.getMonth() !== cursorDate.getMonth()}
                    data-today={key === today}
                    data-selected={key === selected}
                    onClick={() => onSelect(key === selected ? null : key)}
                    aria-label={`${key}, ${hits.length} reminders`}
                  >
                    <span className="day-num">{d.getDate()}</span>

                    <span className="day-marks">
                      {floaters.map((r) => {
                        // a repeating window's ends are this occurrence's, not the row's
                        const occ = occurrenceOn(r, key)!;
                        return (
                          <span
                            key={r.id}
                            className="bar"
                            data-span={
                              key === occ.start && key === occ.end
                                ? "solo"
                                : key === occ.start
                                  ? "start"
                                  : key === occ.end
                                    ? "end"
                                    : "mid"
                            }
                            data-done={r.done}
                            style={{ "--tone": kindInfo(r.kind).tone } as React.CSSProperties}
                          />
                        );
                      })}

                      {anchors.slice(0, 2).map((r) => (
                        <span
                          className="day-chip"
                          key={r.id}
                          data-done={r.done}
                          style={{ "--tone": kindInfo(r.kind).tone } as React.CSSProperties}
                        >
                          <i />
                          {r.time && <b>{fmtTime(r.time)}</b>}
                          {r.title}
                        </span>
                      ))}

                      {anchors.length > 2 && <span className="day-more">+{anchors.length - 2} more</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="cal-scroll" ref={scrollRef} style={{ "--cols": days.length } as React.CSSProperties}>
            <div className="col-heads">
              <span className="gutter-cell" />
              {days.map((key) => {
                const d = parseKey(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="col-head"
                    data-today={key === today}
                    data-selected={key === selected}
                    onClick={() => onSelect(key === selected ? null : key)}
                  >
                    <span className="col-dow">{DOW[d.getDay()]}</span>
                    <span className="col-num">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>

            <div className="band">
              <span className="gutter-cell">all-day</span>
              <div className="band-lanes">
                {banded.length === 0 && <span className="band-empty" />}
                {bandChips.map(({ r, row, occ, from, to }) => {
                  return (
                    <button
                      key={`${r.id}@${occ.start}`}
                      type="button"
                      className="band-chip"
                      data-done={r.done}
                      data-open-left={occ.start < days[0]}
                      data-open-right={occ.end > days[days.length - 1]}
                      style={{
                        "--tone": kindInfo(r.kind).tone,
                        gridColumn: `${from + 1} / ${to + 2}`,
                        gridRow: row + 1,
                      } as React.CSSProperties}
                      onClick={() => onSelect(days[from] === selected ? null : days[from])}
                    >
                      {r.title}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="cols" style={{ "--hour": `${HOUR_H}px` } as React.CSSProperties}>
              <div className="day-axis">
                {HOURS.map((h) => (
                  <span className="hour-label" key={h}>
                    {h > 0 && hourLabel(h)}
                  </span>
                ))}
              </div>

              {days.map((key) => {
                const timed = reminders.filter((r) => r.kind === "anchor" && r.time && occurrenceOn(r, key));
                const { placed, lanes } = place(timed, lengthOf);

                return (
                  <div className="col" key={key} data-today={key === today} data-selected={key === selected}>
                    <div className="day-timeline" onPointerDown={(e) => startSketch(e, key)}>
                      {HOURS.map((h) => (
                        <span className="hour-line" key={h} />
                      ))}

                      {placed.map(({ r, start, lane }) => {
                        // clipped at midnight — an anchor is one day
                        const length = Math.min(lengthOf(r), DAY_MIN - start);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className="event"
                            data-done={r.done}
                            data-stretching={stretch?.id === r.id}
                            style={{
                              "--tone": kindInfo(r.kind).tone,
                              top: `${(start / 60) * HOUR_H}px`,
                              height: `${(length / 60) * HOUR_H - 2}px`,
                              left: `calc(${(lane / lanes) * 100}% + 2px)`,
                              width: `calc(${100 / lanes}% - 4px)`,
                            } as React.CSSProperties}
                            onClick={() => {
                              if (justStretched.current) return;
                              onSelect(key === selected ? null : key);
                            }}
                          >
                            <span className="event-title">{r.title}</span>
                            <span className="event-time">
                              {fmtTime(r.time!)} – {fmtTime(endTime(r.time!, lengthOf(r)))}
                              {r.place && ` · ${r.place}`}
                            </span>
                            {/* grab the bottom edge and pull to make it last longer (or shorter) */}
                            <span
                              className="event-stretch"
                              aria-hidden
                              onPointerDown={(e) => startStretch(e, r, start)}
                            />
                          </button>
                        );
                      })}

                      {sketch?.key === key && (
                        <span
                          className="event event-sketch"
                          aria-hidden
                          style={{
                            "--tone": kindInfo("anchor").tone,
                            top: `${(sketch.start / 60) * HOUR_H}px`,
                            height: `${(sketch.minutes / 60) * HOUR_H - 2}px`,
                            left: "2px",
                            width: "calc(100% - 4px)",
                          } as React.CSSProperties}
                        >
                          <span className="event-title">new reminder</span>
                          <span className="event-time">
                            {fmtTime(timeOf(sketch.start))} – {fmtTime(timeOf(sketch.start + sketch.minutes))}
                          </span>
                        </span>
                      )}

                      {key === nowKey && <span className="now" style={{ top: `${nowOffset}px` }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
