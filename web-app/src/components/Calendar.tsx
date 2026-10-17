import { useEffect, useRef, useState } from "react";
import {
  covers,
  DEFAULT_DURATION,
  endTime,
  fmtDay,
  fmtTime,
  keyOf,
  kindInfo,
  monthGrid,
  monthName,
  parseKey,
  shiftKey,
  todayKey,
  type Reminder,
} from "../lib/todos";

type Props = {
  reminders: Reminder[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** an anchor's bottom edge was dragged to a new length, in minutes */
  onResize: (r: Reminder, minutes: number) => void;
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

const minutesInto = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

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
      const start = minutesInto(r.time!);
      let lane = ends.findIndex((end) => end <= start);
      if (lane === -1) lane = ends.length;
      ends[lane] = start + lengthOf(r);
      return { r, start, lane };
    });
  return { placed, lanes: Math.max(1, ends.length) };
}

export default function Calendar({ reminders, selected, onSelect, onResize }: Props) {
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
                      {floaters.map((r) => (
                        <span
                          key={r.id}
                          className="bar"
                          data-span={
                            key === r.start && key === (r.end ?? r.start)
                              ? "solo"
                              : key === r.start
                                ? "start"
                                : key === (r.end ?? r.start)
                                  ? "end"
                                  : "mid"
                          }
                          data-done={r.done}
                          style={{ "--tone": kindInfo(r.kind).tone } as React.CSSProperties}
                        />
                      ))}

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
                {banded.map((r, row) => {
                  const hit = days.map((k, i) => (covers(r, k) ? i : -1)).filter((i) => i >= 0);
                  const from = hit[0];
                  const to = hit[hit.length - 1];
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="band-chip"
                      data-done={r.done}
                      data-open-left={r.start! < days[0]}
                      data-open-right={(r.end ?? r.start)! > days[days.length - 1]}
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
                const timed = reminders.filter((r) => r.kind === "anchor" && r.start === key && r.time);
                const { placed, lanes } = place(timed, lengthOf);

                return (
                  <div className="col" key={key} data-today={key === today} data-selected={key === selected}>
                    <div className="day-timeline">
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
