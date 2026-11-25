/**
 * What a tab shows while its data is on the way: the page's own shapes in
 * grey, with one band of light sweeping across them (`.sk` in index.css).
 *
 * The habits one is also written out by hand in index.html, so it is on
 * screen before any script has run — keep the two the same.
 */

type Size = number | string;

function Sk({ w, h, round }: { w: Size; h: Size; round?: boolean }) {
  return <span className="sk" data-round={round || undefined} style={{ width: w, height: h }} />;
}

/** one line for a screen reader in place of the grey shapes */
function Busy({ what }: { what: string }) {
  return (
    <span className="sk-label" role="status">
      loading {what}…
    </span>
  );
}

const TITLES = [132, 96, 154];

export function HabitsSkeleton() {
  return (
    <div className="stack sk-habits">
      {TITLES.map((w) => (
        <section className="panel" aria-hidden key={w}>
          <div className="sk-habit">
            <div className="panel-head">
              <Sk w={w} h={18} />
              <Sk w={84} h={12} />
            </div>
            <div className="sk-grid" />
            <div className="panel-foot">
              <Sk w={190} h={13} />
              <Sk w={120} h={13} />
            </div>
          </div>
        </section>
      ))}
      {/* last, so the first panel is still the stack's first child */}
      <Busy what="habits" />
    </div>
  );
}

/** second, first, third — the order the podium stands in */
const PLINTHS = [
  { figure: 62, column: 196 },
  { figure: 78, column: 246 },
  { figure: 62, column: 158 },
];

export function BoardSkeleton() {
  return (
    <div className="board sk-board">
      <Busy what="leaderboards" />
      <header className="board-head" aria-hidden>
        <Sk w={190} h={34} />
        <Sk w={130} h={13} />
      </header>
      <div className="stage" aria-hidden>
        <div className="podium">
          {PLINTHS.map((p) => (
            <div className="plinth" key={p.column}>
              <div className="plinth-top">
                <Sk w={p.figure} h={p.figure} round />
                <Sk w={84} h={13} />
                <Sk w={52} h={11} />
              </div>
              <span className="sk sk-column" style={{ height: p.column }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const REMINDERS = ["62%", "44%", "71%", "53%", "38%", "66%"];

/** the reminders list, inside `.reminder-scroll` */
export function RemindersSkeleton() {
  return (
    <div className="group">
      <Busy what="reminders" />
      <div className="group-head" aria-hidden>
        <Sk w={72} h={11} />
      </div>
      <ul className="reminder-list" aria-hidden>
        {REMINDERS.map((w) => (
          <li className="sk-reminder" key={w}>
            <Sk w={19} h={19} />
            <span className="sk-lines">
              <Sk w={w} h={13} />
              <Sk w="30%" h={10} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FEED = ["58%", "46%", "64%", "52%", "41%", "60%"];

/** the social feed's card of rows */
export function FeedSkeleton() {
  return (
    <ul className="feed-list sk-feed">
      <li className="sk-label" role="status">
        loading activity…
      </li>
      {FEED.map((w) => (
        <li aria-hidden key={w}>
          <div className="feed-row">
            <Sk w={40} h={40} round />
            <span className="sk-lines">
              <Sk w={w} h={15} />
              <Sk w="28%" h={12} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const PEOPLE = ["56%", "44%", "62%"];

/** rows for a side card's `<ul>` */
export function PeopleSkeleton() {
  return (
    <>
      {PEOPLE.map((w) => (
        <li className="person" aria-hidden key={w}>
          <Sk w={40} h={40} round />
          <span className="sk-lines">
            <Sk w={w} h={14} />
            <Sk w="40%" h={12} />
          </span>
          <Sk w={58} h={32} round />
        </li>
      ))}
    </>
  );
}

/** blocks on the week, as [top %, height %] per day */
const WEEK: [number, number][][] = [
  [[18, 14]],
  [[34, 10], [58, 16]],
  [[12, 9]],
  [[26, 20]],
  [[44, 11], [70, 9]],
  [[20, 13]],
  [[52, 15]],
];

/** the whole to-do tab, for before there's a session to load it with */
export function TodoSkeleton() {
  return (
    <div className="todo sk-todo">
      <section className="reminders">
        <div className="reminders-head" aria-hidden>
          <Sk w={150} h={27} />
        </div>
        <div className="reminder-scroll">
          <RemindersSkeleton />
        </div>
      </section>
      <section className="cal" aria-hidden>
        <div className="cal-head">
          <Sk w={210} h={24} />
        </div>
        <div className="cal-body">
          <div className="sk-week">
            {WEEK.map((blocks, day) => (
              <div className="sk-day" key={day}>
                <Sk w={38} h={12} />
                {blocks.map(([top, height]) => (
                  <span className="sk sk-event" key={top} style={{ top: `${top}%`, height: `${height}%` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/** the whole social tab, for before there's a session to load it with */
export function SocialSkeleton() {
  return (
    <div className="social">
      <div className="social-search" aria-hidden>
        <div className="search">
          <Sk w={160} h={15} />
        </div>
      </div>
      <div className="social-cols">
        <aside className="social-side" aria-hidden>
          <section className="side-card">
            <div className="side-card-head">
              <Sk w={150} h={21} />
            </div>
            <ul>
              <PeopleSkeleton />
            </ul>
          </section>
        </aside>
        <section className="social-feed">
          <div className="social-feed-head" aria-hidden>
            <Sk w={120} h={21} />
          </div>
          <FeedSkeleton />
        </section>
      </div>
    </div>
  );
}

export function TabSkeleton({ tab }: { tab: string }) {
  if (tab === "leaderboard") return <BoardSkeleton />;
  if (tab === "to-do") return <TodoSkeleton />;
  if (tab === "social") return <SocialSkeleton />;
  return <HabitsSkeleton />;
}
