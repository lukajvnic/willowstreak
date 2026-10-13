import { useCallback, useEffect, useRef, useState } from "react";

const BOX = 260;
const OUT = 480;
const MAX_ZOOM = 3;

type Props = {
  src: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

/** Lets you pan/zoom an uploaded photo before it becomes the avatar head, so framing is your call, not an auto-crop's. */
export default function PhotoCropper({ src, onCancel, onConfirm }: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const baseScale = natural ? Math.max(BOX / natural.w, BOX / natural.h) : 1;
  const scale = baseScale * zoom;

  const clamp = useCallback(
    (p: { x: number; y: number }, s: number) => {
      if (!natural) return p;
      const dispW = natural.w * s;
      const dispH = natural.h * s;
      const minX = Math.min(0, BOX - dispW);
      const minY = Math.min(0, BOX - dispH);
      return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
    },
    [natural],
  );

  // whenever the image first loads, or gets swapped, center it and reset zoom
  useEffect(() => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setNatural(null);
  }, [src]);

  const onLoad = useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    const s = Math.max(BOX / w, BOX / h);
    setNatural({ w, h });
    setPos({ x: (BOX - w * s) / 2, y: (BOX - h * s) / 2 });
  }, []);

  // a data: URL can finish decoding before React finishes attaching the <img>'s onLoad
  // handler, so the load event fires and gets missed — catch that case once mounted
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth) onLoad();
  }, [src, onLoad]);

  const rezoom = (nextZoom: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
    if (!natural) return setZoom(z);
    // keep whatever image point sits at the box centre fixed while the slider moves
    const oldScale = baseScale * zoom;
    const newScale = baseScale * z;
    const cx = (BOX / 2 - pos.x) / oldScale;
    const cy = (BOX / 2 - pos.y) / oldScale;
    setZoom(z);
    setPos(clamp({ x: BOX / 2 - cx * newScale, y: BOX / 2 - cy * newScale }, newScale));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setPos(clamp({ x: drag.current.px + dx, y: drag.current.py + dy }, scale));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const confirm = () => {
    const el = imgRef.current;
    if (!el || !natural) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const sw = BOX / scale;
    const sh = BOX / scale;
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, OUT, OUT);
    // webp keeps a cutout's transparency at a fraction of a png's size — this
    // is the file that gets stored. a browser that can't encode it hands back png
    onConfirm(canvas.toDataURL("image/webp", 0.86));
  };

  return (
    <div className="ac-crop-veil" role="dialog" aria-label="frame your photo">
      <div className="ac-crop-card">
        <p className="ac-crop-title">frame your photo</p>
        <div
          className="ac-crop-box"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={onLoad}
            style={
              natural
                ? {
                    width: natural.w * scale,
                    height: natural.h * scale,
                    transform: `translate(${pos.x}px,${pos.y}px)`,
                  }
                : { opacity: 0 }
            }
          />
          <div className="ac-crop-ring" />
        </div>
        <input
          type="range"
          className="ac-crop-zoom"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => rezoom(Number(e.target.value))}
          aria-label="zoom"
        />
        <div className="ac-crop-actions">
          <button type="button" className="ac-btn" onClick={onCancel}>
            cancel
          </button>
          <button type="button" className="ac-btn" data-key onClick={confirm} disabled={!natural}>
            use this
          </button>
        </div>
      </div>
    </div>
  );
}
