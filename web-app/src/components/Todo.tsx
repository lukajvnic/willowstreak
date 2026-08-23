import { useState } from "react";
import AddReminder from "./AddReminder";
import Calendar from "./Calendar";
import {
  covers,
  DEFAULT_CATEGORIES,
  fmtDay,
  fmtTime,
  kindInfo,
  kindOrder,
  seedReminders,
  shiftKey,
  sortReminders,
  todayKey,
  type Category,
  type Kind,
  type Reminder,
  type SortMode,
} from "../lib/todos";

const SECTION: Record<Kind, string> = {
  anchor: "anchored",
  floater: "floating",
  refile: "refile",
  backlog: "backlog",
};

/** filter sentinel — reminders with no categoryId at all, distinct from "no filter" */
const UNCATEGORIZED = "__none__";

/** near days read better as words */
function dayLabel(key: string): string {
  const t = todayKey();
  if (key === t) return "today";
  if (key === shiftKey(t, 1)) return "tomorrow";
  if (key === shiftKey(t, -1)) return "yesterday";
  return fmtDay(key);
}

function meta(r: Reminder): string | null {
  if (r.kind === "anchor" && r.start) {
    return [dayLabel(r.start), r.time && fmtTime(r.time), r.place].filter(Boolean).join(" · ");
  }
  if (r.kind === "floater" && r.start) {
    return `${dayLabel(r.start)} — ${dayLabel(r.end ?? r.start)}`;
  }
  return null;
}

type RowProps = {
  r: Reminder;
  category: Category | undefined;
  /** in one merged list the section headings are gone, so each row names its own kind */
  showKind: boolean;
  onToggle: (id: string) => void;
  onDrop: (id: string) => void;
};

function Row({ r, category, showKind, onToggle, onDrop }: RowProps) {
  const detail = meta(r);

  return (
    <li
      className="reminder"
      data-done={r.done}
      style={{ "--tone": kindInfo(r.kind).tone } as React.CSSProperties}
    >
      <button
        className="check"
        type="button"
        onClick={() => onToggle(r.id)}
        aria-label={r.done ? "mark undone" : "mark done"}
        aria-pressed={r.done}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <span className="reminder-body">
        <span className="reminder-title">
          {category && (
            <span className="reminder-cat" title={category.name}>
              {category.icon}
            </span>
          )}
          {r.title}
        </span>
        {(showKind || detail) && (
          <span className="reminder-meta">
            {showKind && <em className="reminder-kind">{r.kind}</em>}
            {showKind && detail ? " · " : null}
            {detail}
          </span>
        )}
      </span>

      <button className="reminder-drop" type="button" onClick={() => onDrop(r.id)} aria-label="delete">
        ×
      </button>
    </li>
  );
}

export default function Todo() {
  const [reminders, setReminders] = useState<Reminder[]>(seedReminders);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [selected, setSelected] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [split, setSplit] = useState(true);
  const [sort, setSort] = useState<SortMode>("priority");

  let shown = selected ? reminders.filter((r) => covers(r, selected)) : reminders;
  if (catFilter === UNCATEGORIZED) shown = shown.filter((r) => !r.categoryId);
  else if (catFilter) shown = shown.filter((r) => r.categoryId === catFilter);
  const open = shown.filter((r) => !r.done).length;

  const catOf = (r: Reminder) => categories.find((c) => c.id === r.categoryId);

  const toggle = (id: string) =>
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));

  const drop = (id: string) => setReminders((prev) => prev.filter((r) => r.id !== id));

  return (
    <div className="todo">
      <section className="reminders">
        <header className="reminders-head">
          <h2 className="reminders-title">reminders</h2>
          <span className="reminders-count">{open} open</span>
          <button className="add-btn" type="button" onClick={() => setAdding(true)} aria-label="add reminder">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="tools">
          <button
            className="tool"
            type="button"
            onClick={() => setSplit((s) => !s)}
            aria-label={split ? "join into one list" : "split by kind"}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              {split ? (
                <path d="M4 5h16M4 9h16M4 15h16M4 19h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              )}
            </svg>
            {split ? "split" : "together"}
          </button>

          <button
            className="tool"
            type="button"
            onClick={() => setSort((s) => (s === "priority" ? "due" : "priority"))}
            aria-label={sort === "priority" ? "sort by due date" : "sort by priority"}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              {sort === "priority" ? (
                <path d="M4 6h15M4 12h10M4 18h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </>
              )}
            </svg>
            {sort === "priority" ? "priority" : "due date"}
          </button>

          {selected && (
            <button className="filter-chip" type="button" onClick={() => setSelected(null)}>
              {dayLabel(selected)} <span>×</span>
            </button>
          )}
        </div>

        <div className="cat-filter" role="group" aria-label="filter by category">
          <button
            type="button"
            className="cat-chip"
            data-active={catFilter === null}
            onClick={() => setCatFilter(null)}
          >
            all
          </button>

          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cat-chip"
              data-active={catFilter === c.id}
              onClick={() => setCatFilter((cur) => (cur === c.id ? null : c.id))}
            >
              <span className="cat-chip-icon">{c.icon}</span>
              {c.name}
            </button>
          ))}

          <button
            type="button"
            className="cat-chip"
            data-active={catFilter === UNCATEGORIZED}
            onClick={() => setCatFilter((cur) => (cur === UNCATEGORIZED ? null : UNCATEGORIZED))}
          >
            uncategorized
          </button>
        </div>

        <div className="reminder-scroll">
          {shown.length === 0 && (
            <p className="reminders-empty">
              {selected || catFilter ? "nothing here" : "nothing yet — hit + to add one"}
            </p>
          )}

          {split ? (
            kindOrder(shown, sort).map((kind) => {
              const group = sortReminders(shown.filter((r) => r.kind === kind), sort);
              if (group.length === 0) return null;

              return (
                <div className="group" key={kind}>
                  <div className="group-head">
                    <span className="group-name" style={{ "--tone": kindInfo(kind).tone } as React.CSSProperties}>
                      {SECTION[kind]}
                    </span>
                    <span className="group-count">{group.length}</span>
                  </div>

                  <ul className="reminder-list">
                    {group.map((r) => (
                      <Row key={r.id} r={r} category={catOf(r)} showKind={false} onToggle={toggle} onDrop={drop} />
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <ul className="reminder-list">
              {sortReminders(shown, sort).map((r) => (
                <Row key={r.id} r={r} category={catOf(r)} showKind onToggle={toggle} onDrop={drop} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <Calendar reminders={reminders} selected={selected} onSelect={setSelected} />

      {adding && (
        <AddReminder
          categories={categories}
          onAdd={(r) => setReminders((prev) => [...prev, r])}
          onCreateCategory={(c) => setCategories((prev) => [...prev, c])}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
