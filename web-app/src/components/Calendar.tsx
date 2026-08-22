import { useEffect, useState } from "react";
import {
  covers,
  dated,
  fmtDay,
  fmtTime,
  keyOf,
  KINDS,
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
};

type View = "week" | "month";

const VIEWS: View[] = ["week", "month"];
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** one hour of grid, in px — the whole time column is laid out off this */
const HOUR_H = 46;
/** anchors are a point in time, so every block gets the same nominal length */
const BLOCK_MIN = 60;

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
function place(list: Reminder[]): { placed: Placed[]; lanes: number } {
  const ends: number[] = [];
  const placed = [...list]
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
    .map((r) => {
      const start = minutesInto(r.time!);
      let lane = ends.findIndex((end) => end <= start);
      if (lane === -1) lane = ends.length;
      ends[lane] = start + BLOCK_MIN;
      return { r, start, lane };
    });
  return { placed, lanes: Math.max(1, ends.length) };
}

export default function Calendar({ reminders, selected, onSelect }: Props) {
  const today = todayKey();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(today);
  const [now, setNow] = useState(() => new Date());

  // the current-time line only has to be honest to the minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  // the popped-out day is fixed-position, planted from the real screen
  // coordinates of the column it grew out of — that's what lets it overlap
  // past the calendar panel's own edge for the first/last day of the week
  // instead of getting clipped by it, and it opens scrolled to the working
  // hours (not midnight) since it carries its own hour axis now
  const openDay = (e: React.MouseEvent<HTMLDivElement>) => {
    const detail = e.currentTarget.querySelector<HTMLDivElement>(".day-detail");
    if (!detail) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const reach = 62; // how far past the column's own edges it's allowed to spread
    const margin = 10; // stay clear of the browser window's own edge
    const width = rect.width + reach * 2;
    const left = Math.max(margin, Math.min(rect.left - reach, window.innerWidth - margin - width));

    detail.style.left = `${left}px`;
    detail.style.top = `${rect.top}px`;
    detail.style.width = `${width}px`;

    const hour = Math.max(0, Math.min(new Date().getHours() - 2, 15));
    detail.scrollTop = hour * HOUR_H;
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
  // days they span, so they stay up here; anchors get their own per-day list
  const banded = reminders.filter((r) => r.kind === "floater" && days.some((k) => covers(r, k)));

  const nowKey = keyOf(now);
  const nowOffset = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;

  // the week's stats strip — dateless kinds (refile, backlog) never belong
  // to a specific week, so they naturally sit at zero here
  const weekItems = view === "week" ? reminders.filter((r) => dated(r) && days.some((k) => covers(r, k))) : [];
  const doneCount = weekItems.filter((r) => r.done).length;
  const completionRate = weekItems.length ? Math.round((doneCount / weekItems.length) * 100) : 0;
  const dayCounts = days.map((key) => ({
    key,
    count: weekItems.filter((r) => covers(r, key)).length,
  }));
  const busiest = dayCounts.reduce((a, b) => (b.count > a.count ? b : a), dayCounts[0]);
  const kindCounts = Object.fromEntries(
    KINDS.map((k) => [k.id, weekItems.filter((r) => r.kind === k.id).length]),
  );

  return (
    <section className="cal panel" data-view={view}>
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
        <div className="cal-scroll" style={{ "--cols": days.length } as React.CSSProperties}>
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
            {days.map((key) => {
              const anchors = reminders
                .filter((r) => r.kind === "anchor" && r.start === key)
                // untimed first, then chronological
                .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
              const timed = anchors.filter((r) => r.time);
              const { placed, lanes } = place(timed);
              const preview = anchors.slice(0, 3);

              return (
                <div
                  className="col"
                  key={key}
                  data-today={key === today}
                  data-selected={key === selected}
                  onMouseEnter={openDay}
                >
                  {/* the compact, always-on glance at the day — swapped out
                      for the full hour-by-hour breakdown on hover */}
                  <ul className="day-preview">
                    {preview.length === 0 && <li className="day-preview-empty">—</li>}
                    {preview.map((r) => (
                      <li className="day-preview-item" key={r.id} data-done={r.done}>
                        <i style={{ "--tone": kindInfo(r.kind).tone } as React.CSSProperties} />
                        {r.time && <b>{fmtTime(r.time)}</b>}
                        <span>{r.title}</span>
                      </li>
                    ))}
                    {anchors.length > preview.length && (
                      <li className="day-preview-more">+{anchors.length - preview.length} more</li>
                    )}
                  </ul>

                  {/* the popped-out day carries its own hour axis and scrolls
                      independently, so it never depends on where the page
                      itself happens to be scrolled */}
                  <div className="day-detail">
                    <div className="day-axis">
                      {HOURS.map((h) => (
                        <span className="hour-label" key={h}>
                          {h > 0 && hourLabel(h)}
                        </span>
                      ))}
                    </div>

                    <div className="day-timeline">
                      {HOURS.map((h) => (
                        <span className="hour-line" key={h} />
                      ))}

                      {placed.map(({ r, start, lane }) => (
                        <button
                          key={r.id}
                          type="button"
                          className="event"
                          data-done={r.done}
                          style={{
                            "--tone": kindInfo(r.kind).tone,
                            top: `${(start / 60) * HOUR_H}px`,
                            height: `${(BLOCK_MIN / 60) * HOUR_H - 2}px`,
                            left: `calc(${(lane / lanes) * 100}% + 2px)`,
                            width: `calc(${100 / lanes}% - 4px)`,
                          } as React.CSSProperties}
                          onClick={() => onSelect(key === selected ? null : key)}
                        >
                          <span className="event-title">{r.title}</span>
                          <span className="event-time">
                            {fmtTime(r.time!)}
                            {r.place && ` · ${r.place}`}
                          </span>
                        </button>
                      ))}

                      {key === nowKey && <span className="now" style={{ top: `${nowOffset}px` }} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="week-stats">
          <div className="week-stat">
            <span className="week-stat-value">{weekItems.length}</span>
            <span className="week-stat-label">total tasks</span>
          </div>

          <div className="week-stat">
            <span className="week-stat-value">{weekItems.length ? `${completionRate}%` : "—"}</span>
            <span className="week-stat-label">completion rate</span>
          </div>

          <div className="week-stat">
            <span className="week-stat-value">
              {busiest.count > 0 ? DOW[parseKey(busiest.key).getDay()] : "—"}
            </span>
            <span className="week-stat-label">
              busiest day{busiest.count > 0 && ` · ${busiest.count}`}
            </span>
          </div>

          <div className="week-stat week-stat-kinds">
            <span className="week-stat-label">by priority</span>
            <ul className="week-kinds">
              {KINDS.map((k) => (
                <li className="week-kind" key={k.id} style={{ "--tone": k.tone } as React.CSSProperties}>
                  <i />
                  <span>{k.label}</span>
                  <b>{kindCounts[k.id]}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
