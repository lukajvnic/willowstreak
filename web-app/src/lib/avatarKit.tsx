import type { ReactNode } from "react";
import { HEAD_ASSETS, SHIRT_ASSETS, type RasterAsset } from "./avatarAssets";

/** the whole avatar is drawn in this one coordinate space, so every item lines up */
export const VIEW = { w: 300, h: 450 };

export type Category = "head" | "shirt";

export type Item = {
  id: string;
  name: string;
  /** most items ignore the skin tone; the bare "nothing" states use it to match the body */
  paint: (base: string) => ReactNode;
};

export type Kit = {
  key: Category;
  label: string;
  /** slice of the 420-unit body this category owns — drives arrow alignment */
  span: number;
  /** y range lit up when the row is hovered */
  band: [number, number];
  items: Item[];
};

/** flat body/head colours — the reference's warm tan by default, then any flat accent */
export const BASE_COLORS = ["#F4B06F", "#4A90E2", "#7C4A9E", "#3EAE6B", "#E2574A", "#2E2C2A"];

/** the marker-drawn outline every body part is inked with */
const INK = "#211F1B";
const OUTLINE = { stroke: INK, strokeWidth: 4, strokeLinejoin: "round" as const };

/**
 * Proportions below are lifted straight from the reference sketch: an oversized round head
 * (~1.8x the torso width) sitting almost directly on a short, boxy torso, thin stick limbs,
 * and small foot flicks — permanent, bare, no swappable clothing.
 */
const HEAD = { cx: 150, cy: 112, r: 92 };
/** head accessories (drawn for r=60 at cy=92) scaled uniformly onto the bigger head */
const ACCESSORY_XFORM = "translate(150,112) scale(1.5333) translate(-150,-92)";

/* ---------- body ---------- */

/** the body is symmetric about x=150, so every limb is drawn once and mirrored */
function pair(art: ReactNode) {
  return (
    <>
      {art}
      <g transform="translate(300,0) scale(-1,1)">{art}</g>
    </>
  );
}

function torsoRect(fill: string) {
  return <rect x={98} y={200} width={104} height={90} rx={14} fill={fill} {...OUTLINE} />;
}

/** the bare figure — big flat head, short block torso, thin stick limbs, small foot flicks.
 * shirt is a swappable item; everything else is permanent. */
export function drawBody(base: string, shirt: Item): ReactNode {
  return (
    <g>
      {/* soft ground-contact shadow under the feet, straight out of the reference */}
      <ellipse cx={150} cy={360} rx={58} ry={9} fill="rgba(0,0,0,0.14)" />
      {/* thin black stick arms, gently curved and hanging close to the torso */}
      {pair(<path d="M94 214Q78 228 74 250T68 268" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />)}
      {shirt.paint(base)}
      {/* thin black stick legs — planted at the abdomen's bottom corners, shorter, reaching the ground */}
      {pair(<path d="M104 290L100 350" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />)}
      {/* small foot flicks — short, roughly perpendicular to the leg, pointing outward away from the midline */}
      {pair(<path d="M100 350Q90 350 82 349" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />)}
    </g>
  );
}

function face(base: string): ReactNode {
  const n = parseInt(base.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.38);
  const ink = `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  return (
    <>
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={base} />
      {/* two small round dot eyes, traced from the reference */}
      <circle cx={121} cy={102} r={7} fill={ink} />
      <circle cx={179} cy={102} r={7} fill={ink} />
      {/* one simple curved smile band, no teeth */}
      <path d="M98 141Q150 173 202 141Q150 155 98 141Z" fill={ink} />
    </>
  );
}

/** the big round head — flat colour by default, swappable for an uploaded photo */
export function drawHead(photo: string | null, base: string): ReactNode {
  return (
    <g>
      <ellipse cx={HEAD.cx} cy={200} rx={28} ry={11} fill="rgba(0,0,0,0.22)" />
      {photo ? (
        <>
          <clipPath id="ac-head-clip">
            <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} />
          </clipPath>
          <image
            href={photo}
            x={HEAD.cx - HEAD.r}
            y={HEAD.cy - HEAD.r}
            width={HEAD.r * 2}
            height={HEAD.r * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#ac-head-clip)"
          />
        </>
      ) : (
        face(base)
      )}
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill="none" stroke={INK} strokeWidth={4} />
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
    </g>
  );
}

/** head-space content, r=60 at cy=92 — wrap any accessory art in this */
const onHead = (art: ReactNode) => <g transform={ACCESSORY_XFORM}>{art}</g>;

/** the whole figure sits this far down from the top of the canvas — gives tall
 * accessories (top hats, wide brims) headroom instead of clipping at y=0 */
export const FIGURE_SHIFT = 70;

/* ---------- head accessories & shirts ----------
 * real cutouts (background already removed) — nothing redrawn. Each one is
 * fit into a hand-placed box and centred there, aspect intact. */

type Box = { x: number; y: number; w: number; h: number };

/** fit (contain) an image into a box, centred */
function fitInBox(asset: RasterAsset, box: Box): ReactNode {
  const scale = Math.min(box.w / asset.w, box.h / asset.h);
  const w = asset.w * scale;
  const h = asset.h * scale;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  return <image href={asset.src} x={x} y={y} width={w} height={h} />;
}

/** fit (contain) an image into a box, centred horizontally. The box's natural
 * (unstretched) bottom edge is always box.y + contain-fit height, regardless of
 * `stretchY` — so growing `stretchY` past 1 stretches the image upward from that
 * fixed hem instead of pushing the hem further down, letting the collar reach
 * higher without disturbing where the hem was already tuned to sit. */
function fitInBoxTop(asset: RasterAsset, box: Box, stretchY = 1): ReactNode {
  const scale = Math.min(box.w / asset.w, box.h / asset.h);
  const w = asset.w * scale;
  const naturalH = asset.h * scale;
  const h = naturalH * stretchY;
  const bottom = box.y + naturalH;
  const x = box.x + (box.w - w) / 2;
  return (
    <image
      href={asset.src}
      x={x}
      y={bottom - h}
      width={w}
      height={h}
      preserveAspectRatio={stretchY === 1 ? undefined : "none"}
    />
  );
}

const HEAD_BOXES: Record<string, Box> = {
  cap: { x: 72, y: 14, w: 140, h: 65 },
  cat_ears: { x: 103, y: 11, w: 94, h: 47 },
  top_hat: { x: 95, y: -20, w: 110, h: 88 },
  straw_hat: { x: 65, y: -20, w: 170, h: 90 },
};

const HEAD_ITEMS: Item[] = [
  { id: "bare", name: "nothing", paint: () => null },
  ...Object.entries(HEAD_ASSETS).map(
    ([id, asset]): Item => ({
      id,
      name: id.replace(/_/g, " "),
      paint: () => onHead(fitInBox(asset, HEAD_BOXES[id])),
    }),
  ),
];

/** shirts sit directly in body-space (no head-scale wrapper needed). Sized from a
 * real reference photo of how the tee should sit on this figure: width ~0.79x the
 * head's diameter, top just inside the head circle so the collar tucks under the
 * chin. That reference shows a normal-looking tee — its hem doesn't reach all the
 * way to where the legs start, there's a small gap with just the arms crossing it,
 * same as a real t-shirt — and at this width, height comes out naturally close to
 * that gap too, so no stretching is needed to make it read as "worn" rather than
 * "printed on". */
const SHIRT_BOX: Box = { x: 78, y: 200, w: 144, h: 100 };

const SHIRT_ITEMS: Item[] = [
  { id: "bare", name: "nothing", paint: (base) => torsoRect(base) },
  ...Object.entries(SHIRT_ASSETS).map(
    ([id, asset]): Item => ({
      id,
      name: id.replace(/_/g, " "),
      // the bare torso is drawn underneath every shirt too — the shirt art is worn
      // over the body, not a replacement for it, so any gap at its edges still
      // shows skin instead of the canvas background poking through
      paint: (base) => (
        <>
          {torsoRect(base)}
          {fitInBoxTop(asset, SHIRT_BOX, 1.22)}
        </>
      ),
    }),
  ),
];

/** a square crop tight on the head — full canvas width for headroom (so tall hats
 * still fit) but cut short below the chin, for spots too small to read a full body */
const FACE_CROP: Box = { x: 40, y: 0, w: 220, h: 220 };

/** a small stand-alone render of the fully customized figure — tone, uploaded head
 * photo, and worn items — for spots that only hold the shared avatar state, like
 * the nav-bar "me" button and the profile header. `crop` swaps the full-body frame
 * for a square headshot, better suited to a tiny circular icon. */
export function AvatarPreview({
  tone,
  photo,
  head,
  shirt,
  size,
  crop = false,
}: {
  tone: string;
  photo: string | null;
  head: Item;
  shirt: Item;
  size: number;
  crop?: boolean;
}) {
  const box = crop ? FACE_CROP : { x: 0, y: 0, w: VIEW.w, h: VIEW.h };
  const h = size;
  const w = crop ? size : Math.round((VIEW.w / VIEW.h) * h);
  return (
    <svg width={w} height={h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} aria-hidden>
      <g transform={`translate(0,${FIGURE_SHIFT})`}>
        {drawBody(tone, shirt)}
        {drawHead(photo, tone)}
        {head.paint(tone)}
      </g>
    </svg>
  );
}

/* ---------- the kit ---------- */

export const KITS: Kit[] = [
  { key: "head", label: "head", span: 204, band: [10, 204], items: HEAD_ITEMS },
  { key: "shirt", label: "shirt", span: 110, band: [192, 298], items: SHIRT_ITEMS },
];

/* ---------- a saved look ---------- */

/** what `users.avatar` holds — items by id, so reordering a kit never changes
 * what anyone is wearing */
export type AvatarLook = { skin: string; head: string; shirt: string };

/** anyone with an avatar: yourself, a search hit, a leaderboard row */
export type AvatarOwner = { avatar: AvatarLook | null; avatar_path: string | null };

function itemOf(category: Category, id: string | undefined): Item {
  const items = KITS.find((k) => k.key === category)!.items;
  return items.find((i) => i.id === id) ?? items[0];
}

/** a stored look as drawable parts. no look yet, or an item that has since
 * left the kit, falls back to the bare default */
export function resolveLook(look: AvatarLook | null | undefined) {
  return {
    tone: look?.skin ?? BASE_COLORS[0],
    head: itemOf("head", look?.head),
    shirt: itemOf("shirt", look?.shirt),
  };
}
