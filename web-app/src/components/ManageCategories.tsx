import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLORS, isBuiltin, LABEL_TAG, nextColor, type Category } from "../lib/todos";

type Props = {
  categories: Category[];
  /** how many reminders each category is on, by id */
  counts: Record<string, number>;
  onCreate: (c: Category) => void;
  onEdit: (c: Category) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

/** the swatch row, plus a native picker for any other colour */
function Swatches({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const custom = !CATEGORY_COLORS.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="swatches" role="radiogroup" aria-label="colour">
      {CATEGORY_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={c}
          className="swatch"
          style={{ "--swatch": c } as React.CSSProperties}
          onClick={() => onPick(c)}
        />
      ))}
      <label
        className="swatch swatch-custom"
        data-on={custom}
        style={custom ? ({ "--swatch": value } as React.CSSProperties) : undefined}
        title="any colour"
      >
        <input type="color" value={value} onChange={(e) => onPick(e.target.value.toUpperCase())} aria-label="custom colour" />
      </label>
    </div>
  );
}

/** one category: icon and name save when you leave the field (or press enter),
 * a colour the moment it's picked */
function CategoryRow({
  c,
  count,
  onEdit,
  onDelete,
}: {
  c: Category;
  count: number;
  onEdit: (c: Category) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(c.name);
  const [icon, setIcon] = useState(c.icon);
  const [confirming, setConfirming] = useState(false);

  // a blank name goes back to what it was; nothing changed, nothing saved
  const commit = () => {
    const n = name.trim();
    const i = icon.trim() || LABEL_TAG;
    if (!n) return setName(c.name);
    setIcon(i);
    if (n !== c.name || i !== c.icon) onEdit({ ...c, name: n, icon: i });
  };

  return (
    <li className="catm-row" style={{ "--cat": c.color } as React.CSSProperties}>
      <div className="catm-line">
        <input
          className="cat-new-icon"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={4}
          aria-label={`${c.name} icon — paste any emoji`}
        />
        <input
          className="catm-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={24}
          aria-label={`${c.name} name`}
        />
        <span className="catm-count">
          {count} {count === 1 ? "reminder" : "reminders"}
        </span>
        {confirming ? (
          <span className="catm-confirm">
            <button type="button" className="catm-delete" data-armed onClick={() => onDelete(c.id)}>
              remove
            </button>
            <button type="button" className="catm-keep" onClick={() => setConfirming(false)}>
              keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="catm-delete"
            onClick={() => setConfirming(true)}
            aria-label={`remove ${c.name}`}
            title={isBuiltin(c.id) ? "remove this built-in category" : "remove"}
          >
            ×
          </button>
        )}
      </div>
      {confirming && count > 0 && (
        <p className="catm-note">its {count} {count === 1 ? "reminder stays" : "reminders stay"}, just uncategorized</p>
      )}
      <Swatches value={c.color} onPick={(color) => color !== c.color && onEdit({ ...c, color })} />
    </li>
  );
}

export default function ManageCategories({ categories, counts, onCreate, onEdit, onDelete, onClose }: Props) {
  const [newIcon, setNewIcon] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(() => nextColor(categories));
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function add() {
    const name = newName.trim();
    if (!name) return newNameRef.current?.focus();
    const c: Category = { id: crypto.randomUUID(), name, icon: newIcon.trim() || LABEL_TAG, color: newColor };
    onCreate(c);
    setNewIcon("");
    setNewName("");
    setNewColor(nextColor([...categories, c]));
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal catm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="categories">
        <button className="modal-close" type="button" onClick={onClose} aria-label="close">
          ×
        </button>

        <h3 className="add-title">categories</h3>
        <p className="catm-blurb">the calendar draws each reminder in its category's colour</p>

        {categories.length === 0 ? (
          <p className="catm-empty">no categories — add one below</p>
        ) : (
          <ul className="catm-list">
            {categories.map((c) => (
              // keyed by what it says too, so a reload's changes reach the fields
              <CategoryRow key={`${c.id}:${c.name}:${c.icon}`} c={c} count={counts[c.id] ?? 0} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </ul>
        )}

        <p className="add-label">new category</p>
        <div className="catm-row catm-add" style={{ "--cat": newColor } as React.CSSProperties}>
          <div className="catm-line">
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
              className="catm-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="name it"
              maxLength={24}
              aria-label="new category name"
            />
            <button type="button" className="catm-addbtn" onClick={add} disabled={!newName.trim()}>
              add
            </button>
          </div>
          <Swatches value={newColor} onPick={setNewColor} />
        </div>
      </div>
    </div>
  );
}
