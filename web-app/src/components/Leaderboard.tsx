import { useEffect, useId, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../lib/auth";
import { loadBoards, type Board } from "../lib/leaderboards";

const PODIUM_ORDER = [1, 0, 2]; // silver, gold, bronze
const SLIDE_MS = 460;

const LINE = "rgba(18, 17, 16, 0.32)";
const LIP = "rgba(255, 255, 255, 0.20)";

const CAPITAL_H = 47;
const COLUMN_H: Record<number, number> = { 1: 244, 2: 196, 3: 168 };
// gold catches the most light
const SPARKLE_COUNT: Record<number, number> = { 1: 15, 2: 8, 3: 5 };

const FLUTES = Array.from({ length: 11 }, (_, i) => 25 + i * 7);

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === "left" ? "M15 4 L7 12 L15 20" : "M9 4 L17 12 L9 20"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* spiral built from shrinking half-circles — the volute scroll */
function scroll(cx: number, cy: number, r0: number) {
  let r = r0;
  let side = 1;
  let d = `M ${(cx + r).toFixed(2)} ${cy}`;
  for (let i = 0; i < 5; i++) {
    const nr = r * 0.62;
    const x = cx - side * nr;
    const rad = ((r + nr) / 2).toFixed(2);
    d += ` A ${rad} ${rad} 0 0 1 ${x.toFixed(2)} ${cy}`;
    r = nr;
    side = -side;
  }
  return d;
}

function Volute({ cx }: { cx: number }) {
  return (
    <g>
      <circle cx={cx} cy="21.5" r="12.5" fill="currentColor" stroke={LINE} strokeWidth="1" />
      <path d={scroll(cx, 21.5, 9.5)} fill="none" stroke={LINE} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx={cx} cy="21.5" r="1.5" fill={LINE} />
    </g>
  );
}

/* four-pointed sparkle with concave sides */
function star(cx: number, cy: number, r: number) {
  const k = r * 0.24;
  return [
    `M ${cx} ${cy - r}`,
    `Q ${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `Q ${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `Q ${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `Q ${cx - k} ${cy - k} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

/* right-hand profile of the column, top to bottom — mirrored for the left edge */
function profile(h: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [60, 1],
    [120, 1],
    [120, 9],
  ];
  for (let a = -78; a <= 52; a += 10) {
    const t = (a * Math.PI) / 180;
    pts.push([98 + 12.5 * Math.cos(t), 21.5 + 12.5 * Math.sin(t)]);
  }
  pts.push([110, 33], [102, 44], [104, 44], [104, 47], [102, 47], [102, h - 62]);
  return pts;
}

/* sparkles walk the outline, alternating edges — seeded so they stay put
   across re-renders */
function sparkles(count: number, h: number, seed: number) {
  let s = seed * 7919 + 104729;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  const pts = profile(h);
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = segs.reduce((a, b) => a + b, 0);

  const at = (t: number) => {
    let d = t * total;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i]) {
        const f = segs[i] === 0 ? 0 : d / segs[i];
        return [
          pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
          pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
        ];
      }
      d -= segs[i];
    }
    return pts[pts.length - 1];
  };

  return Array.from({ length: count }, (_, i) => {
    const [x, y] = at(Math.min((i + 0.3 + rnd() * 0.4) / count, 0.999));
    return {
      x: i % 2 ? 120 - x : x,
      y,
      r: 2.2 + rnd() * 3,
      delay: rnd() * 4.2,
    };
  });
}

/* the whole column is one SVG, so the shine and sparkles can be clipped
   to its silhouette and never spill onto the background */
function Column({ rank, delay }: { rank: number; delay: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clip = `clip-${uid}`;
  const grad = `shine-${uid}`;
  const h = COLUMN_H[rank];
  const shaftH = h - CAPITAL_H;

  const silhouette = (
    <>
      <rect width="120" height="9" />
      <rect x="22" y="9" width="76" height="24" />
      <circle cx="22" cy="21.5" r="12.5" />
      <circle cx="98" cy="21.5" r="12.5" />
      <path d="M10 33 H110 L102 44 H18 Z" />
      <rect x="16" y="43" width="88" height="4" />
      <rect x="18" y={CAPITAL_H} width="84" height={shaftH} />
    </>
  );

  return (
    <svg className="column" viewBox={`0 0 120 ${h}`} width="120" height={h} aria-hidden>
      <defs>
        <clipPath id={clip}>{silhouette}</clipPath>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.42" stopColor="#fff" stopOpacity="0.10" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.38" />
          <stop offset="0.58" stopColor="#fff" stopOpacity="0.10" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* fluted shaft */}
      <rect x="18" y={CAPITAL_H} width="84" height={shaftH} fill="currentColor" />
      {FLUTES.map((x) => (
        <g key={x}>
          <rect x={x - 0.7} y={CAPITAL_H} width="1.4" height={shaftH} fill={LINE} />
          <rect x={x + 0.7} y={CAPITAL_H} width="0.7" height={shaftH} fill={LIP} />
        </g>
      ))}
      <rect x="18" y={CAPITAL_H} width="3.5" height={shaftH} fill="rgba(18, 17, 16, 0.16)" />
      <rect x="98.5" y={CAPITAL_H} width="3.5" height={shaftH} fill="rgba(18, 17, 16, 0.22)" />
      <text className="shaft-rank" x="60" y={CAPITAL_H + 36}>
        {rank}
      </text>

      {/* ionic capital — echinus, volutes, abacus */}
      <path d="M10 33 H110 L102 44 H18 Z" fill="currentColor" />
      <rect x="16" y="43" width="88" height="4" fill="currentColor" />
      <rect x="22" y="9" width="76" height="24" fill="currentColor" />
      <Volute cx={22} />
      <Volute cx={98} />
      <rect width="120" height="9" fill="currentColor" />
      <rect width="120" height="2" fill={LIP} />
      <rect y="9" width="120" height="1" fill={LINE} />
      <rect x="10" y="33" width="100" height="1" fill={LINE} />
      <rect x="16" y="43" width="88" height="1" fill={LINE} />

      <g clipPath={`url(#${clip})`}>
        <g className="shine" style={{ animationDelay: `${delay}s` }}>
          <rect
            x="6"
            y={-h}
            width="108"
            height={h * 3}
            fill={`url(#${grad})`}
            transform={`rotate(28 60 ${h / 2})`}
          />
        </g>
      </g>

      {sparkles(SPARKLE_COUNT[rank], h, rank).map((s, i) => (
        <path
          className="sparkle"
          key={i}
          d={star(s.x, s.y, s.r)}
          style={{ animationDelay: `${(s.delay + delay).toFixed(2)}s` }}
        />
      ))}
    </svg>
  );
}

function Podium({ board }: { board: Board }) {
  const top3 = board.entries.slice(0, 3);

  return (
    <div className="podium">
      {/* a board can have fewer than three people on it — only the taken steps are built */}
      {PODIUM_ORDER.filter((entryIdx) => top3[entryIdx]).map((entryIdx, slot) => {
        const rank = entryIdx + 1;
        const e = top3[entryIdx];
        return (
          <div className="plinth" data-rank={rank} key={e.person.id}>
            <div className="plinth-top">
              <span className="plinth-figure">
                <UserAvatar user={e.person} size={rank === 1 ? 78 : 62} full />
              </span>
              <span className="plinth-name">{e.person.name}</span>
              <span className="plinth-value">
                {e.value.toLocaleString()} {board.unit}
              </span>
            </div>

            <Column rank={rank} delay={slot * 0.35} />
          </div>
        );
      })}
    </div>
  );
}

/* every entry on the board, scrolling inside the stage frame */
function RankList({ board, view }: { board: Board; view: "podium" | "list" }) {
  const { profile } = useAuth();
  const myId = profile !== null && profile !== "none" ? profile.id : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<HTMLLIElement>(null);
  const leader = board.entries[0]?.value ?? 0;

  // centre the signed-in user whenever the list comes into view
  useEffect(() => {
    if (view !== "list") return;
    const box = scrollRef.current;
    const row = meRef.current;
    if (!box || !row) return;
    box.scrollTop = row.offsetTop - (box.clientHeight - row.offsetHeight) / 2;
  }, [view, board]);

  return (
    <div className="ranks-frame">
      <div className="ranks-head">
        <span className="ranks-head-label">all ranks</span>
        <span className="ranks-head-count">
          {board.entries.length} {board.entries.length === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="ranks-scroll" ref={scrollRef}>
        <ol className="ranks">
          {board.entries.map((e, i) => {
            const mine = e.person.id === myId;
            // bar length is the entry's share of the leader's value
            const pct = leader ? Math.max(4, (e.value / leader) * 100) : 4;

            return (
              <li
                className="rank"
                data-rank={i + 1}
                data-me={mine ? "" : undefined}
                ref={mine ? meRef : undefined}
                key={e.person.id}
              >
                <span className="rank-bar" style={{ width: `${pct}%` }} />
                <span className="rank-num">{i + 1}</span>
                <UserAvatar user={e.person} size={26} />
                <span className="rank-name">
                  {e.person.name}
                  {mine && <span className="rank-you">you</span>}
                </span>
                <span className="rank-value">{e.value.toLocaleString()}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function BoardStage({ board, view }: { board: Board; view: "podium" | "list" }) {
  return (
    <div className="slide-inner" data-view={view}>
      <div className="stage-layer podium-layer">
        <Podium board={board} />
      </div>

      <div className="stage-layer list-layer">
        <RankList board={board} view={view} />
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const token = useAuth().session?.access_token;
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!token) return;
    let stale = false;
    loadBoards(token)
      .then((list) => !stale && setBoards(list))
      .catch((err) => !stale && setLoadError(String(err.message ?? err)));
    return () => {
      stale = true;
    };
  }, [token]);

  if (boards === null) {
    return <p className="foot">{loadError ? `couldn't load leaderboards — ${loadError}` : "loading…"}</p>;
  }
  // a board exists for each habit you track, so no habits means nothing to rank
  if (boards.length === 0) return <p className="foot">no leaderboards yet — add a habit to get on one</p>;

  return <Boards boards={boards} />;
}

function Boards({ boards }: { boards: Board[] }) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"podium" | "list">("podium");
  // the board being slid away, plus which way it is going
  const [leaving, setLeaving] = useState<{ index: number; view: typeof view; dir: number } | null>(null);

  const board = boards[index];
  // with a single board there's nowhere to step to
  const alone = boards.length < 2;

  const step = (delta: number) => {
    if (leaving) return;
    setLeaving({ index, view, dir: delta });
    setIndex((i) => (i + delta + boards.length) % boards.length);
    setView("podium");
  };

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), SLIDE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  return (
    <div className="board">
      <header className="board-head" data-dir={leaving?.dir ?? 0} key={index}>
        <h2 className="board-title">{board.title}</h2>
        <p className="board-metric">
          {board.metric} · {board.unit}
        </p>
      </header>

      <div className="board-row">
        <button
          className="arrow"
          type="button"
          disabled={alone}
          onClick={() => step(-1)}
          aria-label="previous leaderboard"
        >
          <Chevron dir="left" />
        </button>

        <div className="stage">
          {leaving && (
            <div className="slide" data-role="out" data-dir={leaving.dir} key={`out-${leaving.index}`}>
              <BoardStage board={boards[leaving.index]} view={leaving.view} />
            </div>
          )}

          <div className="slide" data-role="in" data-dir={leaving?.dir ?? 0} key={`in-${index}`}>
            <BoardStage board={board} view={view} />
          </div>
        </div>

        <button
          className="arrow"
          type="button"
          disabled={alone}
          onClick={() => step(1)}
          aria-label="next leaderboard"
        >
          <Chevron dir="right" />
        </button>
      </div>

      <button
        className="runners"
        type="button"
        onClick={() => setView((v) => (v === "podium" ? "list" : "podium"))}
      >
        {view === "podium" ? "runner ups" : "back to podium"}
      </button>
    </div>
  );
}
