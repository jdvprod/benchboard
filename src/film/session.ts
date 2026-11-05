/** Film sessions: a coach's set of clips for the team, each with a note and a drawing on a frozen frame
 * (arrows, circles, lines, freehand, like a TV telestrator). Each clip is recorded as a small video to share. */
import type { Clip } from "./clips";

export type Tool = "arrow" | "circle" | "line" | "pen";
export interface Stroke { tool: Tool; color: string; pts: [number, number][] } // points 0..1 across the frame
export interface FilmItem { id: string; start: number; end: number; label: string; note?: string; freeze?: { at: number; strokes: Stroke[] } }
export interface FilmSession { id: string; title: string; note?: string; items: FilmItem[]; code?: string; sharedAt?: number }
export const PENS = ["#9BD3F2", "#FFFFFF", "#F07167", "#FFD166"];

/** Draw strokes on a canvas; `p` (0..1) draws them in progressively, one after another. */
export function drawStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], W: number, H: number, p = 1) {
  const n = strokes.length; if (!n) return;
  const lw = Math.max(3, Math.round(W / 220));
  strokes.forEach((s, i) => {
    const local = Math.max(0, Math.min(1, p * n - i)); if (local <= 0 || s.pts.length < 2) return;
    const pts = s.pts.map(([x, y]) => [x * W, y * H] as [number, number]);
    g.save(); g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = lw; g.lineCap = "round"; g.lineJoin = "round";
    g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = lw * 1.5;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (s.tool === "circle") {
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
      g.beginPath(); g.ellipse(cx, cy, Math.max(4, rx), Math.max(4, ry), 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * local); g.stroke();
    } else if (s.tool === "pen") {
      const k = Math.max(2, Math.ceil(pts.length * local)); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let j = 1; j < k; j++) g.lineTo(pts[j][0], pts[j][1]); g.stroke();
    } else {
      const ex = a[0] + (b[0] - a[0]) * local, ey = a[1] + (b[1] - a[1]) * local;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(ex, ey); g.stroke();
      if (s.tool === "arrow" && local > 0.9) {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = lw * 5;
        g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)); g.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); g.closePath(); g.fill();
      }
    }
    g.restore();
  });
}

/** Length of an item's video in seconds (the freeze holds for FREEZE seconds). */
export const FREEZE = 4;
export const itemLength = (it: FilmItem) => Math.max(0, it.end - it.start) + (it.freeze?.strokes.length || it.freeze && it.note ? FREEZE : 0);
export const sessionLength = (s: FilmSession) => s.items.reduce((a, it) => a + itemLength(it), 0);

/** An item from a found clip. */
export const itemFrom = (c: Clip): FilmItem => ({ id: "i" + Math.random().toString(36).slice(2, 9), start: c.start, end: c.end, label: c.label });

// MP4 first: it plays on every phone (iPhones included) and can be scrubbed; WebM where the browser can't record MP4
const mimeOf = () => ["video/mp4;codecs=avc1,mp4a", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || "";

/** Record one item: the clip with its caption, holding on the frozen frame with the drawing and the note. */
export async function recordItem(src: string, it: FilmItem, o: { width?: number; signal?: AbortSignal; onTime?: (sec: number) => void } = {}): Promise<Blob> {
  const W = o.width || 960, H = Math.round(W * 9 / 16), FPS = 30;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d")!;
  const disp = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui";
  const v = document.createElement("video"); v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.src = src;
  await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error("The video couldn't be opened.")); });
  const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ac = AC ? new AC() : null, dest = ac?.createMediaStreamDestination();
  try { if (ac && dest) { ac.createMediaElementSource(v).connect(dest); await ac.resume().catch(() => {}); } } catch { /* silent clip */ }
  const stream = (cv as any).captureStream(FPS) as MediaStream; dest?.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = mimeOf(), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_400_000 }), parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); }; const stopped = new Promise((r) => (rec.onstop = r));
  const frame = () => { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); const k = Math.min(W / v.videoWidth, H / v.videoHeight) || 1, w = v.videoWidth * k, h = v.videoHeight * k; if (v.videoWidth) g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h); };
  const caption = () => {
    if (!it.label) return; g.save(); g.font = `700 ${Math.round(H / 22)}px ${disp}`; const tw = g.measureText(it.label.toUpperCase()).width;
    g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(W * 0.04, H * 0.86, tw + 36, H / 15); g.fillStyle = "#9BD3F2"; g.fillRect(W * 0.04, H * 0.86, 5, H / 15);
    g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(it.label.toUpperCase(), W * 0.04 + 20, H * 0.86 + H / 30); g.restore();
  };
  const noteBar = (a: number) => {
    if (!it.note) return; g.save(); g.globalAlpha = a; const size = Math.round(H / 24); g.font = `600 ${size}px 'Source Sans 3', system-ui, sans-serif`;
    const words = it.note.split(/\s+/), lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > W * 0.84 && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line);
    const shown = lines.slice(0, 3), bh = shown.length * size * 1.3 + size;
    g.fillStyle = "rgba(0,0,0,.78)"; g.fillRect(W * 0.04, H * 0.05, W * 0.92, bh); g.fillStyle = "#9BD3F2"; g.fillRect(W * 0.04, H * 0.05, 6, bh);
    g.fillStyle = "#fff"; g.textBaseline = "top"; shown.forEach((l, i) => g.fillText(l, W * 0.04 + 24, H * 0.05 + size * 0.5 + i * size * 1.3)); g.restore();
  };
  const seek = (t: number) => new Promise((r) => { v.addEventListener("seeked", r, { once: true }); v.currentTime = t; });
  const tick = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const check = () => { if (o.signal?.aborted) throw new DOMException("stopped", "AbortError"); };
  let started = performance.now();
  const fz = it.freeze && (it.freeze.strokes.length || it.note) ? Math.min(Math.max(it.freeze.at, it.start), it.end) : null;
  try {
    await seek(it.start); rec.start(500); started = performance.now(); await v.play();
    const playTo = async (until: number) => { while (v.currentTime < until && !v.ended) { check(); frame(); caption(); o.onTime?.(v.currentTime - it.start); await tick(); } };
    if (fz != null) {
      await playTo(fz); v.pause(); frame();
      const still = g.getImageData(0, 0, W, H), t0 = performance.now();
      while (true) { check(); const t = (performance.now() - t0) / 1000; if (t >= FREEZE) break; g.putImageData(still, 0, 0); g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0, 0, W, H); drawStrokes(g, it.freeze!.strokes, W, H, Math.min(1, t / 1.4)); noteBar(Math.min(1, t / 0.4)); caption(); await new Promise((r) => setTimeout(r, 1000 / FPS)); }
      await v.play();
    }
    await playTo(it.end);
    v.pause(); rec.stop(); await stopped;
  } catch (e) { try { if (rec.state !== "inactive") rec.stop(); } catch { /* ignore */ } v.pause(); ac?.close().catch(() => {}); throw e; }
  ac?.close().catch(() => {}); v.removeAttribute("src");
  const type = mime.split(";")[0] || "video/webm", blob = new Blob(parts, { type });
  if (!type.includes("mp4")) return blob;
  try { return new Blob([fixMp4Duration(new Uint8Array(await blob.arrayBuffer()), (performance.now() - started) / 1000) as Uint8Array<ArrayBuffer>], { type }); } catch { return blob; }
}

/** MediaRecorder's MP4 is fragmented and often says it's only a few seconds long, so players show the wrong length and
 * can't scrub. Write the real length into the movie header (mvhd) and add a movie-extends header (mehd). Pure on bytes. */
export function fixMp4Duration(buf: Uint8Array, seconds: number): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), type = (o: number) => String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
  const find = (from: number, to: number, t: string): number => { for (let o = from; o + 8 <= to; ) { const sz = dv.getUint32(o); if (sz < 8) return -1; if (type(o) === t) return o; o += sz; } return -1; };
  const moov = find(0, buf.length, "moov"); if (moov < 0) return buf;
  const moovEnd = moov + dv.getUint32(moov), mvhd = find(moov + 8, moovEnd, "mvhd"); if (mvhd < 0) return buf;
  const v = buf[mvhd + 8], ts = dv.getUint32(mvhd + (v ? 28 : 20)), d = Math.round(seconds * ts);
  if (v) { dv.setUint32(mvhd + 32, Math.floor(d / 2 ** 32)); dv.setUint32(mvhd + 36, d >>> 0); } else dv.setUint32(mvhd + 24, d >>> 0);
  const mvex = find(moov + 8, moovEnd, "mvex"); if (mvex < 0 || find(mvex + 8, mvex + dv.getUint32(mvex), "mehd") >= 0) return buf;
  // insert mehd (16 bytes) at the start of mvex and grow moov and mvex
  const out = new Uint8Array(buf.length + 16); out.set(buf.subarray(0, mvex + 8), 0);
  const od = new DataView(out.buffer); od.setUint32(mvex + 8, 16); out.set([109, 101, 104, 100], mvex + 12); od.setUint32(mvex + 16, 0); od.setUint32(mvex + 20, d >>> 0);
  out.set(buf.subarray(mvex + 8), mvex + 24);
  od.setUint32(moov, dv.getUint32(moov) + 16); od.setUint32(mvex, dv.getUint32(mvex) + 16);
  return out;
}
