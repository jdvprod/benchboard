/** Pictures picked on the device, made small before they're stored or uploaded. */
const load = (src: string | Blob) => new Promise<HTMLImageElement>((ok, bad) => {
  const img = new Image(), url = typeof src === "string" ? src : URL.createObjectURL(src);
  img.onload = () => { ok(img); if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 0); }; img.onerror = () => bad(new Error("That file isn't a picture this browser can open."));
  img.src = url;
});
const blobOf = (cv: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't save the picture."))), type, q));

/** A square head shot: centered crop (biased up, where faces are), JPEG. */
export async function headShot(file: Blob, size = 360): Promise<Blob> {
  const img = await load(file), s = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - s) / 2, sy = img.naturalHeight > img.naturalWidth ? Math.max(0, (img.naturalHeight - s) * 0.25) : 0;
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const g = cv.getContext("2d")!; g.fillStyle = "#1C1E22"; g.fillRect(0, 0, size, size);
  g.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return blobOf(cv, "image/jpeg", 0.84);
}

/** A logo fitted inside a square with its transparency kept (PNG). */
export async function logoImage(src: Blob | string, size = 256): Promise<Blob> {
  const img = await load(src), k = Math.min(size / img.naturalWidth, size / img.naturalHeight, 4);
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  cv.getContext("2d")!.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return blobOf(cv, "image/png");
}

export const dataUrl = (b: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(b); });
export const blobFromDataUrl = async (u: string) => (await fetch(u)).blob();

/** An image for drawing on a canvas that will be saved: only if its server allows it (otherwise null, and the graphic goes without). */
export function canvasImage(src?: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((ok) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => ok(img); img.onerror = () => ok(null); img.src = src; setTimeout(() => ok(null), 6000); });
}
/** Draw `img` to fill a w×h box (cover) with rounded corners. */
export function drawCover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r = 24) {
  const s = Math.min(img.naturalWidth / w, img.naturalHeight / h), sw = w * s, sh = h * s;
  g.save(); g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.clip();
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h); g.restore();
}
/** Draw a logo inside a box (contain) on a white rounded tile. */
export function drawLogo(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number) {
  g.save(); g.fillStyle = "#fff"; g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, y, size, size, size * 0.16) : g.rect(x, y, size, size); g.fill();
  const pad = size * 0.1, k = Math.min((size - 2 * pad) / img.naturalWidth, (size - 2 * pad) / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h); g.restore();
}

/** The part of a photo shown in the square frame, from the editor: zoom ≥ 1 and an offset in frame pixels. */
export interface Frame { zoom: number; dx: number; dy: number; frame: number }
export function cropGeometry(w: number, h: number, f: Frame) {
  const scale = (f.frame / Math.min(w, h)) * f.zoom, sw = w * scale, sh = h * scale;
  const maxX = (sw - f.frame) / 2, maxY = (sh - f.frame) / 2;
  const dx = Math.max(-maxX, Math.min(maxX, f.dx)), dy = Math.max(-maxY, Math.min(maxY, f.dy));
  return { scale, dx, dy, sx: (maxX - dx) / scale, sy: (maxY - dy) / scale, size: f.frame / scale };
}
/** Crop a photo to the framed square (JPEG, `out` pixels). */
export async function framedPhoto(src: Blob, f: Frame, out = 400): Promise<Blob> {
  const img = await load(src), c = cropGeometry(img.naturalWidth, img.naturalHeight, f);
  const cv = document.createElement("canvas"); cv.width = cv.height = out;
  const g = cv.getContext("2d")!; g.imageSmoothingQuality = "high";
  g.drawImage(img, c.sx, c.sy, c.size, c.size, 0, 0, out, out);
  return blobOf(cv, "image/jpeg", 0.86);
}

/** Box around a logo's artwork: ignores transparent edges, and a plain white or near-white background. */
export function artBox(px: Uint8ClampedArray, w: number, h: number) {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corner = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const whiteBg = corner.every((i) => px[i + 3] > 240 && px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235);
  const ink = (i: number) => px[i + 3] > 24 && !(whiteBg && px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(at(x, y))) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? { x: 0, y: 0, w, h, whiteBg } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, whiteBg };
}
/** A logo made consistent: artwork trimmed to its edges and centered with even padding on a transparent square. */
export async function cleanLogo(src: Blob | HTMLImageElement, size = 320, pad = 0.06): Promise<Blob> {
  const img = src instanceof Blob ? await load(src) : src;
  const k0 = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k0)), h = Math.max(1, Math.round(img.naturalHeight * k0));
  const a = document.createElement("canvas"); a.width = w; a.height = h; const ga = a.getContext("2d", { willReadFrequently: true })!; ga.drawImage(img, 0, 0, w, h);
  const px = ga.getImageData(0, 0, w, h).data, b = artBox(px, w, h);
  if (b.whiteBg) { for (let i = 0; i < px.length; i += 4) if (px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245) px[i + 3] = 0; ga.putImageData(new ImageData(px, w, h), 0, 0); }
  const inner = size * (1 - 2 * pad), k = Math.min(inner / b.w, inner / b.h), dw = b.w * k, dh = b.h * k;
  const cv = document.createElement("canvas"); cv.width = cv.height = size; const g = cv.getContext("2d")!; g.imageSmoothingQuality = "high";
  g.drawImage(a, b.x, b.y, b.w, b.h, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return blobOf(cv, "image/png");
}
export const imageSize = async (src: Blob) => { const i = await load(src); return { w: i.naturalWidth, h: i.naturalHeight }; };
