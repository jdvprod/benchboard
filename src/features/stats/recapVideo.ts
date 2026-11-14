/** A vertical (1080×1920) recap video of a match for Reels, TikTok, Shorts and stories: the result, set scores, top performers
 * and team numbers, animated. Drawn on a canvas and recorded in the browser; no film needed.
 * drawRecap() paints the frame for any moment, so the preview and the recording are the same picture. */
import { Match } from "../../data/model";
import { player, team } from "../../data/store";
import { aggregate, Replay, Stat } from "../../sports/volleyball/engine";
import { blocks, teamMetrics } from "../../sports/volleyball/metrics";
import { canvasImage, drawLogo } from "../../lib/image";
import { reelMime } from "../../film/reel";

export const RW = 1080, RH = 1920;
export interface RecapData {
  us: string; them: string; wonUs: number; wonThem: number; final: boolean; date: string; event: string;
  sets: { n: number; us: number; them: number; won: boolean }[];
  leaders: { name: string; num: string; v: number; label: string }[];
  nums: { v: string; label: string }[];
  logoUs: HTMLImageElement | null; logoThem: HTMLImageElement | null;
  disp: string;
}
/** Scene lengths in seconds: result, sets, each leader, team numbers, outro. */
const T_RESULT = 3.2, T_SETS = 2.8, T_LEAD = 1.7, T_NUMS = 3, T_OUT = 2.3;
export const recapLength = (d: RecapData) => T_RESULT + T_SETS + d.leaders.length * T_LEAD + (d.nums.length ? T_NUMS : 0) + T_OUT;
export const canMakeRecap = () => typeof MediaRecorder !== "undefined" && typeof (HTMLCanvasElement.prototype as any).captureStream === "function" && !!reelMime();

export async function recapData(m: Match, R: Replay): Promise<RecapData> {
  const t = team()!, A = aggregate(R.sets), M = teamMetrics(A);
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  // players whose families asked to stay off public pages are left out
  const lead = (f: (s: Stat) => number, label: string, min: number) => { const e = Object.entries(A.ps).filter(([id]) => player(id) && !player(id)!.hidePublic).map(([id, s]) => [id, f(s)] as [string, number]).sort((a, b) => b[1] - a[1])[0]; return e && e[1] >= min ? { id: e[0], v: +e[1].toFixed(1), label } : null; };
  const seen = new Set<string>(), leaders: RecapData["leaders"] = [];
  for (const l of [lead((s) => s.K, "KILLS", 3), lead((s) => s.AST, "ASSISTS", 8), lead((s) => s.D, "DIGS", 5), lead((s) => s.SA, "ACES", 2), lead((s) => blocks(s), "BLOCKS", 2)]) {
    if (!l || seen.has(l.id) || leaders.length >= 3) continue; seen.add(l.id);
    const p = player(l.id)!; leaders.push({ name: `${p.first} ${p.last}`.trim() || "#" + p.num, num: p.num, v: l.v, label: l.label });
  }
  const hit = M.hitting, nums: RecapData["nums"] = [];
  if (A.T.K) nums.push({ v: String(A.T.K), label: "KILLS" });
  if (hit !== null && A.T.K) nums.push({ v: (hit < 0 ? "-" : "") + Math.abs(hit).toFixed(3).replace(/^0/, ""), label: "HITTING" });
  if (A.T.SA) nums.push({ v: String(A.T.SA), label: "ACES" });
  if (blocks(A.T)) nums.push({ v: String(+blocks(A.T).toFixed(1)), label: "BLOCKS" });
  if (A.T.D) nums.push({ v: String(A.T.D), label: "DIGS" });
  if (M.sideOut !== null) nums.push({ v: Math.round(M.sideOut * 100) + "%", label: "SIDE-OUT" });
  const dt = new Date(m.date + "T12:00:00");
  const [logoUs, logoThem] = await Promise.all([canvasImage(t.logo), canvasImage(m.oppLogo)]);
  return {
    us: t.name, them: m.opp || "Opponent", wonUs: R.wonUs, wonThem: R.wonThem, final: R.matchOver || m.status === "done",
    date: isNaN(+dt) ? m.date : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), event: m.event || "",
    sets: R.sets.filter((s) => s.us + s.them > 0).map((s) => ({ n: s.n, us: s.us, them: s.them, won: s.us > s.them })),
    leaders, nums: nums.slice(0, 6), logoUs, logoThem,
    disp: getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui",
  };
}

const BLUE = "#9BD3F2", GREY = "#8A9099", BODY = "'Source Sans 3', system-ui, sans-serif";
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

/** Paint the recap at time t (seconds). */
export function drawRecap(g: CanvasRenderingContext2D, d: RecapData, t: number) {
  const W = RW, H = RH, total = recapLength(d), won = d.wonUs > d.wonThem;
  const text = (s: string, x: number, y: number, size: number, color: string, o: { font?: string; weight?: number; align?: CanvasTextAlign; spacing?: number; alpha?: number } = {}) => {
    g.save(); g.globalAlpha *= o.alpha ?? 1; g.font = `${o.weight || 700} ${size}px ${o.font || d.disp}`; g.fillStyle = color; g.textAlign = o.align || "left";
    try { (g as any).letterSpacing = (o.spacing || 0) + "px"; } catch { /* older browsers */ }
    g.fillText(s, x, y); g.restore();
  };
  const fit = (s: string, max: number, size: number, font = d.disp) => { let z = size; g.font = `700 ${z}px ${font}`; while (z > 30 && g.measureText(s).width > max) { z -= 4; g.font = `700 ${z}px ${font}`; } return z; };
  /** Fade and slide in over the first 0.5 s of a scene, out over the last 0.3 s. a = seconds into the scene, len = scene length. */
  const scene = (a: number, len: number, paint: (k: number) => void) => { if (a < 0 || a >= len) return; const k = ease(a / 0.5), out = clamp((len - a) / 0.3); g.save(); g.globalAlpha = Math.min(k, out); g.translate(0, (1 - k) * 60); paint(a); g.restore(); };

  // background: black, a slow drift of court lines, the blue floor line
  g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,255,255,.055)"; g.lineWidth = 3; const drift = (t * 18) % 110;
  for (let x = -H; x < W; x += 110) { g.beginPath(); g.moveTo(x + drift, H); g.lineTo(x + drift + H, 0); g.stroke(); }
  g.fillStyle = BLUE; g.fillRect(0, H - 22, W, 22);
  // story-style progress segments
  const segs = [T_RESULT, T_SETS, ...d.leaders.map(() => T_LEAD), ...(d.nums.length ? [T_NUMS] : []), T_OUT]; let acc = 0;
  const sw = (W - 120 - (segs.length - 1) * 10) / segs.length;
  segs.forEach((len, i) => { const x = 60 + i * (sw + 10); g.fillStyle = "rgba(255,255,255,.22)"; g.fillRect(x, 70, sw, 6); g.fillStyle = "#fff"; g.fillRect(x, 70, sw * clamp((t - acc) / len), 6); acc += len; });
  text("FLOORCALL", W - 60, 130, 26, GREY, { align: "right", spacing: 7 });
  text(d.date.toUpperCase(), 60, 130, 26, GREY, { spacing: 3 });

  let at = 0;
  // 1. the result
  scene(t - at, T_RESULT, (a) => {
    text(d.final ? (won ? "WIN" : "FINAL") : "IN PROGRESS", 80, 520, 64, BLUE, { spacing: 10 });
    if (d.event) text(d.event, 80, 580, 36, GREY, { font: BODY, weight: 600 });
    const k = ease((a - 0.4) / 0.9), nu = Math.round(d.wonUs * k), nt = Math.round(d.wonThem * k);
    const lx = d.logoUs || d.logoThem ? 230 : 80, lw = W - lx - 300;
    if (d.logoUs) drawLogo(g, d.logoUs, 80, 700, 120); if (d.logoThem) drawLogo(g, d.logoThem, 80, 980, 120);
    text(d.us.toUpperCase(), lx, 800, fit(d.us.toUpperCase(), lw, 104), "#fff");
    text(String(nu), W - 80, 830, 260, won ? BLUE : "#fff", { align: "right" });
    g.fillStyle = "rgba(255,255,255,.16)"; g.fillRect(80, 900, W - 160, 3);
    text(d.them.toUpperCase(), lx, 1080, fit(d.them.toUpperCase(), lw, 104), GREY);
    text(String(nt), W - 80, 1110, 260, won ? GREY : "#fff", { align: "right" });
  });
  at += T_RESULT;
  // 2. set by set
  scene(t - at, T_SETS, (a) => {
    text("SET BY SET", 80, 520, 52, BLUE, { spacing: 8 });
    const rh = Math.min(210, 1040 / Math.max(1, d.sets.length));
    d.sets.forEach((s, i) => {
      const k = ease((a - 0.15 - i * 0.18) / 0.45), y = 640 + i * rh;
      g.save(); g.globalAlpha *= k; g.translate((1 - k) * 80, 0);
      g.fillStyle = s.won ? "rgba(155,211,242,.16)" : "rgba(255,255,255,.07)"; g.fillRect(80, y, W - 160, rh - 24);
      if (s.won) { g.fillStyle = BLUE; g.fillRect(80, y, 10, rh - 24); }
      const my = y + (rh - 24) / 2 + 34;
      text("SET " + s.n, 130, my - 6, 44, GREY, { spacing: 4 });
      text(`${s.us}`, W / 2 + 150, my, 104, s.won ? BLUE : "#fff", { align: "right" });
      text("–", W / 2 + 200, my - 8, 80, GREY, { align: "center" });
      text(`${s.them}`, W / 2 + 250, my, 104, s.won ? GREY : "#fff");
      g.restore();
    });
  });
  at += T_SETS;
  // 3. top performers, one at a time
  d.leaders.forEach((l, i) => scene(t - at - i * T_LEAD, T_LEAD, (a) => {
    text("TOP PERFORMER", 80, 520, 52, BLUE, { spacing: 8 });
    const v = l.v * ease((a - 0.1) / 0.7), shown = Number.isInteger(l.v) ? String(Math.round(v)) : v.toFixed(1);
    text(shown, 70, 1010, 460, "#fff");
    text(l.label, 84, 1110, 84, BLUE, { spacing: 10 });
    g.fillStyle = "rgba(255,255,255,.16)"; g.fillRect(80, 1180, W - 160, 3);
    text(l.name, 80, 1300, fit(l.name, W - 160, 96, BODY), "#fff", { font: BODY });
    text("#" + l.num, 80, 1380, 56, GREY);
  }));
  at += d.leaders.length * T_LEAD;
  // 4. team numbers
  if (d.nums.length) {
    scene(t - at, T_NUMS, (a) => {
      text(d.us.toUpperCase(), 80, 520, fit(d.us.toUpperCase(), W - 160, 52), BLUE, { spacing: 8 });
      text("BY THE NUMBERS", 80, 590, 40, GREY, { spacing: 6 });
      d.nums.forEach((n, i) => {
        const col = i % 2, row = Math.floor(i / 2), x = 80 + col * (W - 160) / 2, y = 700 + row * 330, k = ease((a - 0.15 - i * 0.12) / 0.45);
        g.save(); g.globalAlpha *= k; g.translate(0, (1 - k) * 40);
        g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect(x, y, (W - 160) / 2 - 24, 300);
        text(n.v, x + 36, y + 180, 150, "#fff"); text(n.label, x + 38, y + 250, 40, BLUE, { spacing: 5 });
        g.restore();
      });
    });
    at += T_NUMS;
  }
  // 5. outro
  scene(t - at, T_OUT + 1, () => {
    if (d.logoUs) drawLogo(g, d.logoUs, W / 2 - 110, 560, 220);
    text(d.us.toUpperCase(), W / 2, 920, fit(d.us.toUpperCase(), W - 160, 120), "#fff", { align: "center" });
    text(`${d.wonUs}–${d.wonThem} vs ${d.them}`, W / 2, 1010, fit(`${d.wonUs}–${d.wonThem} vs ${d.them}`, W - 200, 60, BODY), GREY, { align: "center", font: BODY, weight: 600 });
    g.fillStyle = BLUE; g.fillRect(W / 2 - 60, 1090, 120, 6);
    text("STATS BY FLOORCALL", W / 2, 1200, 40, BLUE, { align: "center", spacing: 8 });
    text("getfloorcall.com", W / 2, 1260, 36, GREY, { align: "center", font: BODY, weight: 600 });
  });
  void total;
}

/** Record the recap to a video file. Takes as long as the video runs. */
export async function renderRecapVideo(d: RecapData, o: { onProgress?: (frac: number) => void; signal?: AbortSignal } = {}): Promise<Blob> {
  const cv = document.createElement("canvas"); cv.width = RW; cv.height = RH;
  const g = cv.getContext("2d")!, mime = reelMime(), len = recapLength(d);
  drawRecap(g, d, 0);
  const stream: MediaStream = (cv as any).captureStream(30), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const parts: Blob[] = []; rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((res, rej) => {
    const step = () => {
      if (o.signal?.aborted) return rej(new DOMException("Stopped", "AbortError"));
      const t = (performance.now() - t0) / 1000; drawRecap(g, d, Math.min(t, len - 0.01)); o.onProgress?.(Math.min(1, t / len));
      if (t >= len) return res();
      // setTimeout keeps recording when the tab is in the background, where animation frames stop
      setTimeout(step, 1000 / 30);
    };
    step();
  }).finally(() => { try { rec.stop(); } catch { /* already stopped */ } stream.getTracks().forEach((x) => x.stop()); });
  await done;
  return new Blob(parts, { type: mime.split(";")[0] });
}
