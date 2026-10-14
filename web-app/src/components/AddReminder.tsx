import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_DURATION,
  KINDS,
  kindInfo,
  LABEL_TAG,
  MAX_DURATION,
  MIN_DURATION,
  shiftKey,
  todayKey,
  type Category,
  type Kind,
  type Reminder,
} from "../lib/todos";

type Props = {
  categories: Category[];
  /** when set, the dialog edits this reminder instead of making a new one */
  initial?: Reminder;
  onAdd: (r: Reminder) => void;
  onCreateCategory: (c: Category) => void;
  onClose: () => void;
};

export default function AddReminder({ categories, initial, onAdd, onCreateCategory, onClose }: Props) {
  const editing = initial !== undefined;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<Kind | null>(initial?.kind ?? null);
  const [category, setCategory] = useState<string | null>(initial?.categoryId ?? null);
  const [start, setStart] = useState(initial?.start ?? todayKey());
  const [end, setEnd] = useState(initial?.end ?? shiftKey(initial?.start ?? todayKey(), 7));
  const [time, setTime] = useState(initial?.time ?? "09:00");
  const startLength = initial?.duration ?? DEFAULT_DURATION;
  const [hours, setHours] = useState(String(Math.floor(startLength / 60)));
  const [mins, setMins] = useState(String(startLength % 60));
  const [place, setPlace] = useState(initial?.place ?? "");
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
      onAdd({ ...base, start: a, end: b });
    } else if (k === "anchor") {
      const length = Math.min(
        MAX_DURATION,
        Math.max(MIN_DURATION, (Number(hours) || 0) * 60 + (Number(mins) || 0)),
      );
      // the default hour stays unset, so it's never stored unless asked for — but
      // one that already had a length keeps sending it, so going back to 1h saves
      const duration = length !== DEFAULT_DURATION || initial?.duration !== undefined ? length : undefined;
      onAdd({ ...base, start, time, duration, place: place.trim() || undefined });
    } else {
      onAdd(base);
    }
    onClose();
  }

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
              <input id="from" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="to">to</label>
              <input id="to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}

        {kind === "anchor" && (
          <div className="add-detail">
            <div className="field">
              <label htmlFor="day">day</label>
              <input id="day" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="at">at</label>
              <input id="at" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="lasts">lasts</label>
              <span className="length">
                <input
                  id="lasts"
                  type="number"
                  min={0}
                  max={24}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  aria-label="hours"
                />
                <span>h</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={mins}
                  onChange={(e) => setMins(e.target.value)}
                  aria-label="minutes"
                />
                <span>m</span>
              </span>
            </div>
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
