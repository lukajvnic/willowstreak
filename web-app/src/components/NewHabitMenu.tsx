import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Mode } from "./NewHabit";

/** the three ways to start a habit — each opens the dialog straight on its own pane */
const OPTIONS: { id: Mode; label: string; icon: ReactNode }[] = [
  {
    id: "custom",
    label: "custom",
    icon: (
      <>
        <path d="M5 19l.8-3.6L16.6 4.6a2 2 0 0 1 2.8 2.8L8.6 18.2 5 19z" />
        <path d="M14.6 6.6l2.8 2.8" />
      </>
    ),
  },
  {
    id: "presets",
    label: "preset",
    // four cells off the grid
    icon: (
      <>
        <rect x="4.5" y="4.5" width="6" height="6" rx="1.6" />
        <rect x="13.5" y="4.5" width="6" height="6" rx="1.6" />
        <rect x="4.5" y="13.5" width="6" height="6" rx="1.6" />
        <rect x="13.5" y="13.5" width="6" height="6" rx="1.6" />
      </>
    ),
  },
  {
    id: "copy",
    label: "join a friend",
    icon: (
      <>
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5" />
        <path d="M15.8 5.6a3.2 3.2 0 0 1 0 5.8" />
        <path d="M17.4 14.4c1.8.7 2.8 2.3 3.1 4.6" />
      </>
    ),
  },
];

type Props = {
  onPick: (mode: Mode) => void;
};

export default function NewHabitMenu({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="add-wrap" ref={wrapRef}>
      <button
        className="add-habit"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        new habit
      </button>

      {open && (
        <div className="add-menu" role="menu">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(o.id);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {o.icon}
              </svg>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
