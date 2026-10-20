import { useEffect, useRef, useState } from "react";
import { alertLabel, ALERT_OPTIONS, askPermission, usePermission } from "../lib/notify";
import {
  DEFAULT_DURATION,
  fmtDuration,
  fmtTime,
  keyOf,
  KINDS,
  kindInfo,
  LABEL_TAG,
  MIN_DURATION,
  minutesOf,
  monthName,
  parseKey,
  repeatsFor,
  shiftKey,
  timeOf,
  todayKey,
  WEEKDAYS,
  type Category,
  type Kind,
  type Reminder,
  type Repeat,
} from "../lib/todos";
import { DateField, MenuSelect, TimeSelect, type MenuOption, type TimeOption } from "./WhenFields";

/** an anchor can't run past the end of its day */
const DAY_MIN = 24 * 60;
/** the time lists move in quarter hours */
const STEP = 15;
const START_OPTIONS: TimeOption[] = Array.from({ length: DAY_MIN / STEP }, (_, i) => ({ value: timeOf(i * STEP) }));
const LENGTHS = [15, 30, 45, 60, 90, 120, 180];

/** where a slot dragged out on the week grid starts the dialog */
export type Preset = { start: string; time: string; duration: number };

type Props = {
  categories: Category[];
  /** when set, the dialog edits this reminder instead of making a new one */
  initial?: Reminder;
  /** a new anchor already placed on the calendar */
  preset?: Preset;
  onAdd: (r: Reminder) => void;
  onCreateCategory: (c: Category) => void;
  onClose: () => void;
};

/** "1st", "22nd", "13th" */
function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${tail}`;
}

const daysBetween = (a: string, b: string) =>
  Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000);

export default function AddReminder({ categories, initial, preset, onAdd, onCreateCategory, onClose }: Props) {
  const editing = initial !== undefined;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<Kind | null>(initial?.kind ?? (preset ? "anchor" : null));
  const [category, setCategory] = useState<string | null>(initial?.categoryId ?? null);
  const firstDay = initial?.start ?? preset?.start ?? todayKey();
  const [start, setStart] = useState(firstDay);
  const [end, setEnd] = useState(initial?.end ?? shiftKey(firstDay, 7));
  const [time, setTime] = useState(initial?.time ?? preset?.time ?? "09:00");
  const [length, setLength] = useState(initial?.duration ?? preset?.duration ?? DEFAULT_DURATION);
  const [place, setPlace] = useState(initial?.place ?? "");
  const [alert, setAlert] = useState<number | null>(initial?.alert ?? null);
  const [repeat, setRepeat] = useState<Repeat | null>(initial?.repeat ?? null);
  // empty = repeats forever
  const [until, setUntil] = useState(initial?.repeatUntil ?? "");
  const permission = usePermission();
  const [creatingCat, setCreatingCat] = useState(false);
  const [newIcon, setNewIcon] = useState("");
  const [newName, setNewName] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (creatingCat) newNameRef.current?.focus();
  }, [creatingCat]);

  const named = title.trim().length > 0;

  function save(k: Kind) {
    // the id is made here and kept by the server, so the row is real from the first paint.
    // an edit keeps the original's id and done state
    const base = {
      id: initial?.id ?? crypto.randomUUID(),
      title: title.trim(),
      kind: k,
      done: initial?.done ?? false,
      categoryId: category ?? undefined,
    };
    if (k === "floater") {
      const [a, b] = start <= end ? [start, end] : [end, start];
      onAdd({ ...base, start: a, end: b, ...repeatToSave(k, a) });
    } else if (k === "anchor") {
      // the default hour stays unset, so it's never stored unless asked for — but
      // one that already had a length keeps sending it, so going back to 1h saves
      const duration = length !== DEFAULT_DURATION || initial?.duration !== undefined ? length : undefined;
      onAdd({
        ...base,
        start,
        time,
        duration,
        alert: alertToSave(alert),
        ...repeatToSave(k, start),
        place: place.trim() || undefined,
      });
    } else {
      // only an anchor has a moment to alert at, and an undated pile has nothing
      // to repeat — a reminder that stops being dated drops both
      onAdd({ ...base, alert: alertToSave(null), ...repeatToSave(k, "") });
    }
    onClose();
  }

  // null only goes out to clear an alert that was saved; "none" on a reminder
  // that never had one stays unset, so it's never written
  function alertToSave(value: number | null): number | null | undefined {
    if (value !== null) return value;
    return initial?.alert != null ? null : undefined;
  }

  // same rule as the alert: null only goes out to clear a saved repeat. a rule
  // the kind can't use (daily on a window) is dropped, and so is an end before the start
  function repeatToSave(k: Kind, from: string): Pick<Reminder, "repeat" | "repeatUntil"> {
    const rule = repeat && repeatsFor(k).some((x) => x.id === repeat) ? repeat : null;
    if (rule) return { repeat: rule, repeatUntil: until && until >= from ? until : null };
    return initial?.repeat != null ? { repeat: null, repeatUntil: null } : {};
  }

  // the start moves and the length rides along, the way a calendar app does —
  // cut short only where it would run past midnight
  const startMin = minutesOf(time);
  const moveStart = (t: string) => {
    setTime(t);
    setLength((l) => Math.max(MIN_DURATION, Math.min(l, DAY_MIN - minutesOf(t))));
  };
  // "12:00am" as an end is midnight tonight; an end at or before the start is ignored
  const moveEnd = (t: string) => {
    const at = minutesOf(t) || DAY_MIN;
    if (at - startMin >= MIN_DURATION) setLength(at - startMin);
  };
  // each alert says the time it'll go off, so "15m before" reads as "9:45am"
  const alertMenu: MenuOption<number | null>[] = ALERT_OPTIONS.map((m) => {
    if (m === null) return { value: m, label: alertLabel(m) };
    const at = startMin - m;
    return {
      value: m,
      label: alertLabel(m),
      hint: at < 0 ? `${fmtTime(timeOf(at))} the day before` : fmtTime(timeOf(at)),
      // none · at start … 30m · 1h, 2h · a day
      group: m === 0 || m === 60 || m === 1440,
    };
  });
  const endOptions: TimeOption[] = [];
  for (let m = startMin + STEP; m <= DAY_MIN; m += STEP) {
    endOptions.push({ value: timeOf(m), hint: fmtDuration(m - startMin) });
  }

  // one-tap days and windows, counted from today
  const today = todayKey();
  const dow = parseKey(today).getDay();
  const thisSat = shiftKey(today, 6 - dow);
  const monthEnd = (() => {
    const d = parseKey(today);
    return keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  })();
  const DAYS = [
    { label: "today", key: today },
    { label: "tomorrow", key: shiftKey(today, 1) },
    // the coming monday — a week out when today is one
    { label: "next mon", key: shiftKey(today, (8 - dow) % 7 || 7) },
  ];
  const WINDOWS = [
    { label: "this week", from: today, to: thisSat },
    { label: "next week", from: shiftKey(thisSat, 1), to: shiftKey(thisSat, 7) },
    { label: "next 2 weeks", from: today, to: shiftKey(today, 13) },
    { label: "this month", from: today, to: monthEnd },
  ];

  // the repeat row, shared by both dated kinds
  const repeatFields = (k: Kind) => {
    const options = repeatsFor(k);
    const value = repeat && options.some((x) => x.id === repeat) ? repeat : null;
    // each rule says where it lands, counted from the day picked above
    const day = parseKey(start);
    const from = k === "floater" ? "from" : "on";
    const hints: Record<Repeat, string> = {
      daily: "",
      weekdays: "mon – fri",
      weekly: `${from} ${WEEKDAYS[day.getDay()]}`,
      biweekly: `${from} ${WEEKDAYS[day.getDay()]}`,
      monthly: `${from} the ${ordinal(day.getDate())}`,
      yearly: `${from} ${monthName(day.getMonth()).slice(0, 3)} ${day.getDate()}`,
    };
    const menu: MenuOption<Repeat | null>[] = [
      { value: null, label: "never" },
      ...options.map((o, i) => ({
        value: o.id,
        label: o.id === "weekdays" ? "every weekday" : o.label,
        hint: hints[o.id] || undefined,
        group: i === 0,
      })),
    ];
    return (
      <>
        <div className="field">
          <label htmlFor="repeat">repeat</label>
          <MenuSelect id="repeat" value={value} options={menu} align={k === "floater" ? "start" : "end"} onChange={setRepeat} />
        </div>
        {value && (
          <div className="field">
            <label htmlFor="until">end repeat</label>
            <DateField
              id="until"
              value={until}
              min={start}
              // it lands in the right column next to a floater's repeat, the left one for an anchor's
              align={k === "floater" ? "end" : "start"}
              placeholder="never — repeats forever"
              onChange={setUntil}
              onClear={() => setUntil("")}
            />
          </div>
        )}
      </>
    );
  };

  // refile and backlog need nothing else — a new one files straight away. an edit
  // always waits for save, since the title or category may still be changing
  function pick(k: Kind) {
    if (!named) return titleRef.current?.focus();
    if (!editing && kindInfo(k).needs === "nothing") return save(k);
    setKind(k);
  }

  function commitCategory() {
    const name = newName.trim();
    if (!name) return newNameRef.current?.focus();
    const c: Category = { id: crypto.randomUUID(), name, icon: newIcon.trim() || LABEL_TAG };
    onCreateCategory(c);
    setCategory(c.id);
    setNewIcon("");
    setNewName("");
    setCreatingCat(false);
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal add" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <button className="modal-close" type="button" onClick={onClose} aria-label="close">
          ×
        </button>

        <h3 className="add-title">{editing ? "edit reminder" : "new reminder"}</h3>

        <input
          ref={titleRef}
          className="add-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          // once it knows how to hold it (a slot dragged on the calendar), enter files it
          onKeyDown={(e) => e.key === "Enter" && kind && named && save(kind)}
          placeholder="what is it?"
          aria-label="title"
        />

        <p className="add-label">category — optional</p>

        <div className="cats" role="group" aria-label="category">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cat-pick"
              data-picked={c.id === category}
              onClick={() => setCategory((cur) => (cur === c.id ? null : c.id))}
            >
              <span className="cat-pick-icon">{c.icon}</span>
              {c.name}
            </button>
          ))}

          {creatingCat ? (
            <span className="cat-new">
              <input
                className="cat-new-icon"
                value={newIcon}
                onChange={(e) => setNewIcon(e.target.value)}
                placeholder={LABEL_TAG}
                maxLength={4}
                aria-label="new category icon — paste any emoji"
              />
              <input
                ref={newNameRef}
                className="cat-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitCategory()}
                placeholder="name it"
                aria-label="new category name"
              />
              <button type="button" className="cat-new-save" onClick={commitCategory} aria-label="save category">
                ✓
              </button>
              <button
                type="button"
                className="cat-new-cancel"
                onClick={() => {
                  setCreatingCat(false);
                  setNewIcon("");
                  setNewName("");
                }}
                aria-label="cancel new category"
              >
                ×
              </button>
            </span>
          ) : (
            <button type="button" className="cat-pick cat-pick-new" onClick={() => setCreatingCat(true)}>
              + new
            </button>
          )}
        </div>

        <p className="add-label">how do you want to hold it?</p>

        <div className="kinds">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="kind"
              style={{ "--tone": k.tone } as React.CSSProperties}
              data-picked={k.id === kind}
              data-ready={named}
              onClick={() => pick(k.id)}
            >
              <span className="kind-dot" />
              <span className="kind-label">{k.label}</span>
              <span className="kind-blurb">{k.blurb}</span>
            </button>
          ))}
        </div>

        {kind === "floater" && (
          <div className="add-detail">
            <div className="field">
              <label htmlFor="from">from</label>
              <DateField
                id="from"
                value={start}
                range={[start, end]}
                onChange={(k) => {
                  // moving the first day past the last carries the window along
                  if (k > end) setEnd(shiftKey(end, daysBetween(start, k)));
                  setStart(k);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="to">to</label>
              <DateField id="to" value={end} min={start} range={[start, end]} align="end" onChange={setEnd} />
            </div>
            <div className="quick wide" role="group" aria-label="window">
              {WINDOWS.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  data-picked={start === w.from && end === w.to}
                  onClick={() => {
                    setStart(w.from);
                    setEnd(w.to);
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {repeatFields("floater")}
          </div>
        )}

        {kind === "anchor" && (
          <div className="add-detail">
            <div className="field wide">
              <label htmlFor="day">day</label>
              <DateField id="day" value={start} onChange={setStart} />
            </div>
            <div className="quick wide" role="group" aria-label="day">
              {DAYS.map((d) => (
                <button key={d.label} type="button" data-picked={start === d.key} onClick={() => setStart(d.key)}>
                  {d.label}
                </button>
              ))}
            </div>
            <div className="field wide">
              <label htmlFor="at">time</label>
              <span className="time-range">
                <TimeSelect id="at" label="starts" value={time} options={START_OPTIONS} onChange={moveStart} />
                <span className="time-dash">–</span>
                <TimeSelect label="ends" value={timeOf(startMin + length)} options={endOptions} onChange={moveEnd} />
              </span>
            </div>
            <div className="quick wide" role="group" aria-label="length">
              {LENGTHS.map((m) => (
                <button
                  key={m}
                  type="button"
                  data-picked={length === m}
                  disabled={startMin + m > DAY_MIN}
                  onClick={() => setLength(m)}
                >
                  {fmtDuration(m)}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="alert">alert</label>
              <MenuSelect
                id="alert"
                value={alert}
                options={alertMenu}
                onChange={(next) => {
                  setAlert(next);
                  // asked here, while there's a click to ask from — browsers ignore it otherwise
                  if (next !== null) void askPermission();
                }}
              />
            </div>
            {alert !== null && permission === "denied" && (
              <p className="field-note wide">
                notifications are blocked for this site — allow them in your browser's site settings
              </p>
            )}
            {alert !== null && permission === "unsupported" && (
              <p className="field-note wide">this browser can't show desktop notifications</p>
            )}
            {repeatFields("anchor")}
            <div className="field wide">
              <label htmlFor="where">where</label>
              <input
                id="where"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
        )}

        {kind && (
          <button className="add-save" type="button" onClick={() => named && save(kind)} disabled={!named}>
            {editing ? "save changes" : `add ${kind}`}
          </button>
        )}
      </div>
    </div>
  );
}
