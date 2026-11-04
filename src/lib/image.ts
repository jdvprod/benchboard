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
