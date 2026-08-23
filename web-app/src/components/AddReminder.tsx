import { useEffect, useRef, useState } from "react";
import {
  categoryUid,
  KINDS,
  kindInfo,
  LABEL_TAG,
  shiftKey,
  todayKey,
  uid,
  type Category,
  type Kind,
  type Reminder,
} from "../lib/todos";

type Props = {
  categories: Category[];
  onAdd: (r: Reminder) => void;
  onCreateCategory: (c: Category) => void;
  onClose: () => void;
};

export default function AddReminder({ categories, onAdd, onCreateCategory, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [start, setStart] = useState(todayKey());
  const [end, setEnd] = useState(shiftKey(todayKey(), 7));
  const [time, setTime] = useState("09:00");
  const [place, setPlace] = useState("");
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
    const base = { id: uid(), title: title.trim(), kind: k, done: false, categoryId: category ?? undefined };
    if (k === "floater") {
      const [a, b] = start <= end ? [start, end] : [end, start];
      onAdd({ ...base, start: a, end: b });
    } else if (k === "anchor") {
      onAdd({ ...base, start, time, place: place.trim() || undefined });
    } else {
      onAdd(base);
    }
    onClose();
  }

  // refile and backlog need nothing else — they file straight away
  function pick(k: Kind) {
    if (!named) return titleRef.current?.focus();
    if (kindInfo(k).needs === "nothing") return save(k);
    setKind(k);
  }

  function commitCategory() {
    const name = newName.trim();
    if (!name) return newNameRef.current?.focus();
    const c: Category = { id: categoryUid(), name, icon: newIcon.trim() || LABEL_TAG };
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

        <h3 className="add-title">new reminder</h3>

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
          <button className="add-save" type="button" onClick={() => save(kind)}>
            add {kind}
          </button>
        )}
      </div>
    </div>
  );
}
