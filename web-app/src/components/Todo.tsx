import { useEffect, useState } from "react";
import AddReminder from "./AddReminder";
import Calendar from "./Calendar";
import { useAuth } from "../lib/auth";
import {
  covers,
  DEFAULT_CATEGORIES,
  fmtDay,
  fmtDuration,
  fmtTime,
  kindInfo,
  kindOrder,
  shiftKey,
  sortReminders,
  todayKey,
  type Category,
  type Kind,
  type Reminder,
  type SortMode,
} from "../lib/todos";
import {
  createCategory,
  createReminder,
  deleteReminder,
  editReminder,
  loadTodos,
  setReminderDone,
} from "../lib/todosApi";
import { alertLabel, askPermission, usePermission } from "../lib/notify";
import { KEYS } from "../lib/pageData";
import { forget, peek, preload, remember } from "../lib/preload";

type Todos = Awaited<ReturnType<typeof loadTodos>>;

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
    const at = r.time && (r.duration ? `${fmtTime(r.time)} for ${fmtDuration(r.duration)}` : fmtTime(r.time));
    return [dayLabel(r.start), at, r.place].filter(Boolean).join(" · ");
  }
  if (r.kind === "floater" && r.start) {
    return `${dayLabel(r.start)} — ${dayLabel(r.end ?? r.start)}`;
  }
  return null;
}

function BellIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2.2 2.2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {off && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  );
}

const COLLAPSED_KEY = "willo:reminders-collapsed";

type RowProps = {
  r: Reminder;
  category: Category | undefined;
  /** in one merged list the section headings are gone, so each row names its own kind */
  showKind: boolean;
  onToggle: (id: string) => void;
  onEdit: (r: Reminder) => void;
  onDrop: (id: string) => void;
};

function Row({ r, category, showKind, onToggle, onEdit, onDrop }: RowProps) {
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

      <button className="reminder-body" type="button" onClick={() => onEdit(r)} aria-label={`edit ${r.title}`}>
        <span className="reminder-title">
          {category && (
            <span className="reminder-cat" title={category.name}>
              {category.icon}
            </span>
          )}
          {r.title}
          {r.kind === "anchor" && r.alert != null && (
            <span className="reminder-alert" title={`alert ${alertLabel(r.alert)}`}>
              <BellIcon />
            </span>
          )}
        </span>
        {(showKind || detail) && (
          <span className="reminder-meta">
            {showKind && <em className="reminder-kind">{r.kind}</em>}
            {showKind && detail ? " · " : null}
            {detail}
          </span>
        )}
      </button>

      <button className="reminder-edit" type="button" onClick={() => onEdit(r)} aria-label="edit">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button className="reminder-drop" type="button" onClick={() => onDrop(r.id)} aria-label="delete">
        ×
      </button>
    </li>
  );
}

export default function Todo() {
  const token = useAuth().session?.access_token;
  // usually preloaded before the tab opened (see `pageData`); null only if not
  const cached = peek<Todos>(KEYS.todos);
  const [loaded, setLoaded] = useState<Reminder[] | null>(cached?.reminders ?? null);
  const [loadError, setLoadError] = useState("");
  const [categories, setCategories] = useState<Category[]>([
    ...DEFAULT_CATEGORIES,
    ...(cached?.categories ?? []),
  ]);
  const reminders = loaded ?? [];
  const setReminders = (change: (prev: Reminder[]) => Reminder[]) =>
    setLoaded((prev) => change(prev ?? []));

  const reload = (fresh: boolean) => {
    if (!token) return;
    // after a failed save the cached copy is the thing in doubt — skip it
    if (fresh) forget(KEYS.todos);
    preload(KEYS.todos, () => loadTodos(token))
      .then((todos) => {
        setLoaded(todos.reminders);
        setCategories([...DEFAULT_CATEGORIES, ...todos.categories]);
      })
      .catch((err) => setLoadError(String(err.message ?? err)));
  };

  // reload is rebuilt every render; the token is what actually decides the load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => reload(false), [token]);

  // edits here are made locally first, so hand them back to the cache — coming
  // back to the tab then shows them, not the copy from before they were made
  useEffect(() => {
    if (loaded === null) return;
    const own = categories.filter((c) => !DEFAULT_CATEGORIES.some((d) => d.id === c.id));
    remember<Todos>(KEYS.todos, { reminders: loaded, categories: own });
  }, [loaded, categories]);

  // every change shows straight away and saves behind it. if a save fails, the
  // list is re-read so the tab goes back to what's actually stored
  const save = (write: (token: string) => Promise<void>) => {
    if (!token) return;
    write(token).catch((err) => {
      console.error("reminder save failed", err);
      reload(true);
    });
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [split, setSplit] = useState(true);
  const [sort, setSort] = useState<SortMode>("priority");
  // folded away to give the calendar the full width — remembered per browser
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const fold = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // private window — it just won't be remembered
    }
  };
  const permission = usePermission();
  // alerts set (maybe on another device) that this browser can't show yet
  const wantsAlerts = reminders.some((r) => r.kind === "anchor" && !r.done && r.alert != null);

  let shown = selected ? reminders.filter((r) => covers(r, selected)) : reminders;
  if (catFilter === UNCATEGORIZED) shown = shown.filter((r) => !r.categoryId);
  else if (catFilter) shown = shown.filter((r) => r.categoryId === catFilter);
  const open = shown.filter((r) => !r.done).length;

  const catOf = (r: Reminder) => categories.find((c) => c.id === r.categoryId);

  const toggle = (id: string) => {
    const done = !reminders.find((r) => r.id === id)?.done;
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, done } : r)));
    save((t) => setReminderDone(t, id, done));
  };

  const edit = (next: Reminder) => {
    setReminders((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    save((t) => editReminder(t, next));
  };

  const drop = (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    save((t) => deleteReminder(t, id));
  };

  return (
    <div className="todo" data-collapsed={collapsed}>
      {/* what's left of the list once it's folded: a full-height strip that
          names itself and shows what's waiting, so it reads as "open me" */}
      {collapsed && (
        <button className="reminders-rail" type="button" onClick={() => fold(false)} aria-label="show reminders">
          <svg className="rail-chev" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="rail-label">reminders</span>
          <span className="rail-count">{reminders.filter((r) => !r.done).length}</span>
        </button>
      )}

      <section className="reminders" hidden={collapsed}>
        <header className="reminders-head">
          <h2 className="reminders-title">reminders</h2>
          <span className="reminders-count">{open} open</span>
          <button className="add-btn" type="button" onClick={() => setAdding(true)} aria-label="add reminder">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button className="fold-btn" type="button" onClick={() => fold(true)} aria-label="hide reminders" title="hide reminders">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

          {wantsAlerts && permission === "default" && (
            <button className="tool" type="button" onClick={() => void askPermission()}>
              <BellIcon />
              enable alerts
            </button>
          )}
          {wantsAlerts && permission === "denied" && (
            <span className="tool" title="allow notifications for this site in your browser's settings">
              <BellIcon off />
              alerts blocked
            </span>
          )}

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
          {loaded === null ? (
            <p className="reminders-empty">
              {loadError ? `couldn't load reminders — ${loadError}` : "loading…"}
            </p>
          ) : (
            shown.length === 0 && (
              <p className="reminders-empty">
                {selected || catFilter ? "nothing here" : "nothing yet — hit + to add one"}
              </p>
            )
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
                      <Row key={r.id} r={r} category={catOf(r)} showKind={false} onToggle={toggle} onEdit={setEditing} onDrop={drop} />
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <ul className="reminder-list">
              {sortReminders(shown, sort).map((r) => (
                <Row key={r.id} r={r} category={catOf(r)} showKind onToggle={toggle} onEdit={setEditing} onDrop={drop} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <Calendar
        reminders={reminders}
        selected={selected}
        onSelect={setSelected}
        onResize={(r, minutes) => edit({ ...r, duration: minutes })}
      />

      {(adding || editing) && (
        <AddReminder
          // a fresh dialog per reminder, so its fields start from that one
          key={editing?.id ?? "new"}
          categories={categories}
          initial={editing ?? undefined}
          onAdd={(r) => {
            if (editing) return edit(r);
            setReminders((prev) => [...prev, r]);
            save((t) => createReminder(t, r));
          }}
          onCreateCategory={(c) => {
            setCategories((prev) => [...prev, c]);
            save((t) => createCategory(t, c));
          }}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
