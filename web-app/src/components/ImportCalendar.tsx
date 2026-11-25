import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { translate, type ImportDraft } from "../lib/calendarImport";
import {
  listCalendars,
  loadGoogle,
  readCalendar,
  requestAccess,
  revokeAccess,
  type GoogleCalendar,
} from "../lib/googleCalendar";
import { LABEL_TAG, nextColor, todayKey, type Category } from "../lib/todos";
import { createCategory, deleteCategory, importReminders, undoImport } from "../lib/todosApi";

type Props = {
  categories: Category[];
  /** reminders or categories were added or taken away — the tab should re-read them */
  onChanged: () => void;
  onClose: () => void;
};

/** where a calendar's reminders go: an existing category's id, or one of these */
const NO_CATEGORY = "";
const NEW_CATEGORY = "new";

/** one of the account's calendars, read and ready, with the choices made for it */
type Source = {
  calendar: GoogleCalendar;
  drafts: ImportDraft[];
  /** series that came in as single events, and events that lost their times */
  flattened: number;
  untimed: number;
  on: boolean;
  category: string;
};

/** an import that went through, with what's needed to take it back */
type Done = { importId: string; added: number; skipped: number; categories: Category[] };

type Step = "start" | "reading" | "review" | "saving" | "done";

const CATEGORY_NAME_MAX = 24;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** every calendar on the account, translated. the ones ticked in Google's own
 * sidebar start switched on; all but the account's own start with a category
 * of their own, so they keep their colours */
async function readSources(access: string): Promise<Source[]> {
  const today = todayKey();
  const calendars = await listCalendars(access);
  return Promise.all(
    calendars.map(async (calendar) => {
      const { events, flattened } = await readCalendar(access, calendar.id, today);
      const { drafts, untimed } = translate(events, today);
      return {
        calendar,
        drafts,
        flattened,
        untimed,
        on: calendar.shown && drafts.length > 0,
        category: calendar.primary ? NO_CATEGORY : NEW_CATEGORY,
      };
    }),
  );
}

/** a category named and coloured after a Google calendar */
const categoryFor = (calendar: GoogleCalendar, taken: Category[]): Category => ({
  id: crypto.randomUUID(),
  name: calendar.name.slice(0, CATEGORY_NAME_MAX),
  icon: LABEL_TAG,
  color: HEX_COLOR.test(calendar.color) ? calendar.color.toUpperCase() : nextColor(taken),
});

/** the chosen calendars' drafts, each filed under its calendar's category, and
 * the categories that have to be made for them */
function plan(sources: Source[], categories: Category[]): { drafts: ImportDraft[]; fresh: Category[] } {
  const fresh: Category[] = [];
  const drafts = sources
    .filter((s) => s.on)
    .flatMap((s) => {
      let categoryId: string | undefined = s.category || undefined;
      if (s.category === NEW_CATEGORY) {
        const made = categoryFor(s.calendar, [...categories, ...fresh]);
        fresh.push(made);
        categoryId = made.id;
      }
      return s.drafts.map((draft) => ({ ...draft, categoryId }));
    });
  return { drafts, fresh };
}

/** A one-time import: read a Google account's calendars, pick which come over
 * and into which category, and file their upcoming events as reminders. */
export default function ImportCalendar({ categories, onChanged, onClose }: Props) {
  const token = useAuth().session?.access_token;
  const [step, setStep] = useState<Step>("start");
  const [sources, setSources] = useState<Source[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  // google's token, kept only until the dialog closes
  const access = useRef<string | null>(null);

  useEffect(() => {
    // fetched ahead of the click that opens google's window
    loadGoogle().catch(() => {});
    return () => {
      if (access.current) revokeAccess(access.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** runs one step of the import; if it fails, says why and goes back to `fallback` */
  const attempt = async (fallback: Step, work: () => Promise<void>) => {
    setError("");
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
      setStep(fallback);
    }
  };

  const read = () =>
    attempt("start", async () => {
      access.current = await requestAccess();
      setStep("reading");
      setSources(await readSources(access.current));
      setStep("review");
    });

  const save = () =>
    attempt("review", async () => {
      if (!token) return;
      setStep("saving");
      const { drafts, fresh } = plan(sources, categories);
      const importId = crypto.randomUUID();
      const { added, skipped } = await importReminders(token, importId, drafts);
      await Promise.all(fresh.map((c) => createCategory(token, c)));
      setDone({ importId, added, skipped, categories: fresh });
      setStep("done");
      onChanged();
    });

  const undo = () =>
    attempt("done", async () => {
      if (!token || !done) return;
      setStep("saving");
      await undoImport(token, done.importId);
      await Promise.all(done.categories.map((c) => deleteCategory(token, c.id)));
      onChanged();
      onClose();
    });

  const change = (id: string, patch: Partial<Source>) =>
    setSources((prev) => prev.map((s) => (s.calendar.id === id ? { ...s, ...patch } : s)));

  const chosen = sources.filter((s) => s.on);
  const total = chosen.reduce((n, s) => n + s.drafts.length, 0);
  const flattened = chosen.reduce((n, s) => n + s.flattened, 0);
  const untimed = chosen.reduce((n, s) => n + s.untimed, 0);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal imp" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="import from google calendar">
        <button className="modal-close" type="button" onClick={onClose} aria-label="close">
          ×
        </button>

        <h3 className="add-title">import from google calendar</h3>

        {step === "start" && (
          <>
            <p className="imp-blurb">
              copies your upcoming events in as reminders, once. willowstreak reads your calendar now and keeps no
              access to it afterwards.
            </p>
            <button className="add-save" type="button" onClick={read}>
              choose a google account
            </button>
          </>
        )}

        {step === "reading" && <p className="imp-blurb">reading your calendars…</p>}
        {step === "saving" && <p className="imp-blurb">working…</p>}

        {step === "review" && (
          <>
            <p className="imp-blurb">pick what comes over, and the category each calendar's reminders go into.</p>

            <ul className="imp-list">
              {sources.map((s) => (
                <SourceRow key={s.calendar.id} source={s} categories={categories} onChange={(patch) => change(s.calendar.id, patch)} />
              ))}
            </ul>

            {flattened > 0 && (
              <p className="imp-note">
                {count(flattened, "repeating event repeats", "repeating events repeat")} in a way willowstreak can't.{" "}
                {flattened === 1 ? "it comes" : "they come"} in as single events for the next 3 months.
              </p>
            )}
            {untimed > 0 && (
              <p className="imp-note">
                {count(untimed, "event runs", "events run")} longer than a day, and {untimed === 1 ? "comes" : "come"} in
                without {untimed === 1 ? "its" : "their"} times.
              </p>
            )}

            <button className="add-save" type="button" onClick={save} disabled={total === 0}>
              {total === 0 ? "nothing picked" : `import ${count(total, "reminder")}`}
            </button>
          </>
        )}

        {step === "done" && done && (
          <>
            <p className="imp-blurb">
              {done.added > 0 ? `${count(done.added, "reminder")} imported.` : "nothing new to import."}
              {done.skipped > 0 && ` ${done.skipped} ${done.skipped === 1 ? "was" : "were"} already here.`}
            </p>
            <div className="imp-actions">
              {done.added > 0 && (
                <button className="imp-undo" type="button" onClick={undo}>
                  undo
                </button>
              )}
              <button className="add-save" type="button" onClick={onClose}>
                done
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="imp-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

type RowProps = {
  source: Source;
  categories: Category[];
  onChange: (patch: Partial<Source>) => void;
};

function SourceRow({ source, categories, onChange }: RowProps) {
  const { calendar, drafts, on, category } = source;
  const empty = drafts.length === 0;

  return (
    <li className="imp-row" data-on={on} style={{ "--cat": calendar.color } as React.CSSProperties}>
      <label className="imp-pick">
        <input type="checkbox" checked={on} disabled={empty} onChange={(e) => onChange({ on: e.target.checked })} />
        <i className="cat-dot" />
        <span className="imp-name">{calendar.name}</span>
      </label>

      <span className="imp-count">{empty ? "nothing upcoming" : count(drafts.length, "reminder")}</span>

      <select
        className="imp-category"
        value={category}
        disabled={!on}
        onChange={(e) => onChange({ category: e.target.value })}
        aria-label={`category for ${calendar.name}`}
      >
        <option value={NO_CATEGORY}>no category</option>
        <option value={NEW_CATEGORY}>new: {calendar.name.slice(0, CATEGORY_NAME_MAX)}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon} {c.name}
          </option>
        ))}
      </select>
    </li>
  );
}
