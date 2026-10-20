import { useEffect, useRef, useState } from "react";
import {
  fmtLongDay,
  fmtTime,
  keyOf,
  monthGrid,
  monthName,
  monthOf,
  parseDate,
  parseKey,
  parseTime,
  relDay,
  shiftKey,
  todayKey,
} from "../lib/todos";

const DOW = ["s", "m", "t", "w", "t", "f", "s"];

type DateProps = {
  id?: string;
  /** a day key, or "" when `onClear` lets it be empty */
  value: string;
  /** days before this can't be picked */
  min?: string;
  /** a window being picked — its days are shaded in the month */
  range?: [string, string];
  /** which edge the popover lines up with — "end" for a field in the right column */
  align?: "start" | "end";
  /** what an empty field says */
  placeholder?: string;
  onChange: (key: string) => void;
  /** offers a "clear" in the popover, for a date that's allowed to be empty */
  onClear?: () => void;
};

/** a day, shown as "tue, oct 21 · tomorrow" — opens a small month to pick from,
 *  or type into ("fri", "oct 22", "in 3 days"), the way notion calendar's does */
export function DateField({ id, value, min, range, align = "start", placeholder, onChange, onClear }: DateProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // a press anywhere outside closes it, like a menu
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <span className="date-field" ref={wrap}>
      <button
        id={id}
        type="button"
        className="date-face"
        data-open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value ? (
          <>
            <span>{fmtLongDay(value)}</span>
            <span className="date-rel">{relDay(value)}</span>
          </>
        ) : (
          <span className="date-empty">{placeholder}</span>
        )}
      </button>
      {open && (
        <DatePopover
          value={value}
          min={min}
          range={range}
          align={align}
          onPick={(k) => {
            onChange(k);
            setOpen(false);
          }}
          onClear={
            onClear &&
            (() => {
              onClear();
              setOpen(false);
            })
          }
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

function DatePopover({
  value,
  min,
  range,
  align,
  onPick,
  onClear,
  onClose,
}: {
  value: string;
  min?: string;
  range?: [string, string];
  align: "start" | "end";
  onPick: (key: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const today = todayKey();
  const [text, setText] = useState("");
  // the day the arrow keys are on, and the month on show
  const [focus, setFocus] = useState(value || today);
  const [month, setMonth] = useState(monthOf(value || today));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const typed = text.trim() ? parseDate(text) : null;
  const allowed = (k: string) => !min || k >= min;

  const goTo = (k: string) => {
    setFocus(k);
    setMonth(monthOf(k));
  };

  const stepMonth = (by: number) => {
    const d = parseKey(month);
    setMonth(keyOf(new Date(d.getFullYear(), d.getMonth() + by, 1)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    // left/right belong to the text once something's typed
    const move = { ArrowUp: -7, ArrowDown: 7, ArrowLeft: text ? 0 : -1, ArrowRight: text ? 0 : 1 }[e.key];
    if (move) {
      e.preventDefault();
      setText("");
      goTo(shiftKey(focus, move));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = text.trim() ? typed : focus;
      if (pick && allowed(pick)) onPick(pick);
    } else if (e.key === "Escape") {
      // closes the popover, not the whole dialog
      e.stopPropagation();
      onClose();
    }
  };

  const m = parseKey(month);
  const days = monthGrid(m.getFullYear(), m.getMonth());
  // the typed day, while it reads as one, is what the month points at
  const pointed = typed ?? focus;
  const spans = range && range[0] < range[1];

  return (
    <div className="date-pop" data-align={align} role="dialog" aria-label="pick a day">
      <input
        ref={input}
        className="date-pop-input"
        value={text}
        placeholder="type a date — fri, oct 22, in 3 days"
        onChange={(e) => {
          setText(e.target.value);
          const k = e.target.value.trim() ? parseDate(e.target.value) : null;
          if (k) setMonth(monthOf(k));
        }}
        onKeyDown={onKey}
        aria-label="type a date"
      />
      <p className="date-pop-hint" data-bad={!!text.trim() && !typed}>
        {text.trim()
          ? typed
            ? allowed(typed)
              ? `↵ ${fmtLongDay(typed)}${relDay(typed) && ` · ${relDay(typed)}`}`
              : "that's before the start"
            : "no date matches that"
          : "↑ ↓ ← → to move · ↵ to pick"}
      </p>

      <div className="date-pop-head">
        <span className="date-pop-title">
          {monthName(m.getMonth())} <span>{m.getFullYear()}</span>
        </span>
        <span className="date-pop-nav">
          <button type="button" onClick={() => goTo(today)}>
            today
          </button>
          <button type="button" onClick={() => stepMonth(-1)} aria-label="previous month">
            ‹
          </button>
          <button type="button" onClick={() => stepMonth(1)} aria-label="next month">
            ›
          </button>
        </span>
      </div>

      <div className="date-pop-dow">
        {DOW.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="date-pop-grid">
        {days.map((k) => (
          <button
            key={k}
            type="button"
            disabled={!allowed(k)}
            data-out={parseKey(k).getMonth() !== m.getMonth()}
            data-today={k === today}
            data-selected={k === value}
            data-pointed={k === pointed && k !== value}
            data-in-range={spans && k > range![0] && k < range![1]}
            data-range-start={spans && k === range![0]}
            data-range-end={spans && k === range![1]}
            onClick={() => onPick(k)}
            aria-label={fmtLongDay(k)}
          >
            <span>{parseKey(k).getDate()}</span>
          </button>
        ))}
      </div>

      {onClear && (
        <button type="button" className="date-pop-clear" onClick={onClear}>
          clear
        </button>
      )}
    </div>
  );
}

export type TimeOption = { value: string; hint?: string };

/** scrolls the list alone — scrollIntoView would drag the dialog and page along too */
function reveal(list: HTMLUListElement | null, index: number, center = false) {
  const row = list?.children[index] as HTMLElement | undefined;
  if (!list || !row) return;
  if (center) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
  else if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
  else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
}

/** a time you can type ("930pm", "14:15") or pick from a list, like a calendar app's */
export function TimeSelect({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id?: string;
  value: string;
  options: TimeOption[];
  label: string;
  /** may be ignored by the parent (an end before the start); the field then shows `value` again */
  onChange: (time: string) => void;
}) {
  const [text, setText] = useState(fmtTime(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setText(fmtTime(value)), [value]);

  // the list opens on the current time, not at the top of the day
  useEffect(() => {
    if (!open) return;
    const at = options.findIndex((o) => o.value === value);
    setActive(at);
    reveal(listRef.current, Math.max(0, at), true);
    // only on opening — scrolling while the list is browsed would fight the user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (time: string) => {
    setText(fmtTime(value));
    onChange(time);
    setOpen(false);
  };

  const commit = () => {
    const typed = parseTime(text);
    if (typed) choose(typed);
    else {
      setText(fmtTime(value));
      setOpen(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const next = Math.min(options.length - 1, Math.max(0, active + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      reveal(listRef.current, next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // a highlighted row wins only if nothing new was typed over the shown time
      if (open && active >= 0 && text === fmtTime(value)) choose(options[active].value);
      else commit();
    } else if (e.key === "Escape" && open) {
      // closes the list, not the whole dialog
      e.stopPropagation();
      setText(fmtTime(value));
      setOpen(false);
    }
  };

  return (
    <span className="time-select">
      <input
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          const typed = parseTime(e.target.value);
          const at = typed ? options.findIndex((o) => o.value === typed) : -1;
          setActive(at);
          if (at >= 0) reveal(listRef.current, at, true);
        }}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={commit}
        onKeyDown={onKey}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
      />
      {open && (
        <ul className="time-list" ref={listRef} role="listbox">
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              // mousedown, not click, so the input's blur doesn't land first
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.value);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{fmtTime(o.value)}</span>
              {o.hint && <span className="time-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export type MenuOption<T> = {
  value: T;
  label: string;
  /** greyed detail on the right — "9:50am", "on thu" */
  hint?: string;
  /** starts a new group, with a rule above it */
  group?: boolean;
};

/** a dropdown that says what each choice means for this reminder, in place of a bare <select> */
export function MenuSelect<T extends string | number | null>({
  id,
  value,
  options,
  align = "start",
  onChange,
}: {
  id?: string;
  value: T;
  options: MenuOption<T>[];
  align?: "start" | "end";
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const show = () => {
    setActive(Math.max(0, options.indexOf(current)));
    setOpen(true);
  };

  const choose = (o: MenuOption<T>) => {
    onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, Math.max(0, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" || e.key === " ") {
      // the button's own click would toggle it shut without choosing
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      // closes the menu, not the whole dialog
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <span className="menu-field" ref={wrap}>
      <button
        id={id}
        type="button"
        className="date-face"
        data-open={open}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span>{current.label}</span>
        <span className="date-rel">
          {current.hint}
          <svg className="menu-chev" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <ul className="menu-pop" data-align={align} role="listbox">
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              data-group={o.group && i > 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="menu-check" aria-hidden>
                {o.value === value ? "✓" : ""}
              </span>
              <span className="menu-label">{o.label}</span>
              {o.hint && <span className="time-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
