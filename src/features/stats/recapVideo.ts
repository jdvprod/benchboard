/** A vertical (1080×1920) recap video of a match for Reels, TikTok, Shorts and stories: the result, set scores, top performers
 * and team numbers, animated. Drawn on a canvas and recorded in the browser; no film needed.
 * drawRecap() paints the frame for any moment, so the preview and the recording are the same picture. */
import { Match } from "../../data/model";
import { eventsOf, player, team } from "../../data/store";
import { ACTIONS } from "../../sports/volleyball/actions";
import { clipsFrom, filmTiming, highlightPick, LOCAL, playName, videoKind } from "../../film/clips";
import { localVideo } from "../../film/localVideos";
import { aggregate, Replay, Stat } from "../../sports/volleyball/engine";
import { teamBlocks, blocks, teamMetrics } from "../../sports/volleyball/metrics";
import { canvasImage, drawLogo } from "../../lib/image";
import { reelMime } from "../../film/reel";

export const RW = 1080, RH = 1920;
export interface RecapData {
  us: string; them: string; wonUs: number; wonThem: number; final: boolean; date: string; event: string;
  sets: { n: number; us: number; them: number; won: boolean; /** a row label in place of "SET n" (season recaps list matches) */ label?: string }[];
  /** A season recap rather than one match: the record, recent results and the season's leaders. */
  season?: { name: string; matches: number };
  leaders: { name: string; num: string; v: number; label: string }[];
  nums: { v: string; label: string }[];
  /** Plays cut from the match film (kills, aces, blocks), when the film is a file the browser can read. */
  plays: RecapPlay[];
  logoUs: HTMLImageElement | null; logoThem: HTMLImageElement | null;
  disp: string;
}
export interface RecapPlay { src: string; start: number; end: number; label: string; who: string; sub: string }
/** Scene lengths in seconds: result, sets, each leader, each play from the film, team numbers, outro. */
const T_RESULT = 3.2, T_SETS = 2.8, T_LEAD = 1.7, T_NUMS = 3, T_OUT = 2.3;
export const T_PLAY = 5;
/** When each scene starts, so the recorder can line the film up with the cards. */
export const recapPlaysAt = (d: RecapData) => T_RESULT + T_SETS + d.leaders.length * T_LEAD;

/** Up to four of the match's best plays, if its film is a video file on this device or a direct link (YouTube and Vimeo can't be cut here). */
export function recapPlays(m: Match, R: Replay): RecapPlay[] {
  if (!m.video) return []; const k = videoKind(m.video); if (k !== "file" && k !== "local") return [];
  const src = m.video.startsWith(LOCAL) ? localVideo(m.id) : m.video; if (!src) return [];
  const shown = (id?: string) => { const p = id ? player(id) : null; return !!p && !p.hidePublic; };
  const cs = clipsFrom(m, filmTiming(m, R, eventsOf(m.id)), R.log, (l) => l.kind === "stat" && ["K", "SA", "BS", "BA"].includes((l as any).t) && shown((l as any).p), (l) => playName((l as any).t, (ACTIONS as any)[(l as any).t]?.long));
  return highlightPick(cs, 4).map((c) => { const p = player(c.p!)!; return { src, start: Math.max(0, c.end - T_PLAY), end: c.end, label: c.label.toUpperCase(), who: `${p.first} ${p.last}`.trim() || "#" + p.num, sub: [c.set ? "Set " + c.set : "", c.score || ""].filter(Boolean).join("  ·  ") }; });
}
export const recapLength = (d: RecapData) => T_RESULT + T_SETS + d.leaders.length * T_LEAD + d.plays.length * T_PLAY + (d.nums.length ? T_NUMS : 0) + T_OUT;
export const canMakeRecap = () => typeof MediaRecorder !== "undefined" && typeof (HTMLCanvasElement.prototype as any).captureStream === "function" && !!reelMime();

/** Up to three different players who led the team, each in a different stat; `scale` raises the bar for a whole season. */
function leadersOf(A: ReturnType<typeof aggregate>, scale = 1): RecapData["leaders"] {
  // players whose families asked to stay off public pages are left out
  const lead = (f: (s: Stat) => number, label: string, min: number) => { const e = Object.entries(A.ps).filter(([id]) => player(id) && !player(id)!.hidePublic).map(([id, s]) => [id, f(s)] as [string, number]).sort((a, b) => b[1] - a[1])[0]; return e && e[1] >= min ? { id: e[0], v: +e[1].toFixed(1), label } : null; };
  const seen = new Set<string>(), leaders: RecapData["leaders"] = [];
  for (const l of [lead((s) => s.K, "KILLS", 3 * scale), lead((s) => s.AST, "ASSISTS", 8 * scale), lead((s) => s.D, "DIGS", 5 * scale), lead((s) => s.SA, "ACES", 2 * scale), lead((s) => blocks(s), "BLOCKS", 2 * scale)]) {
    if (!l || seen.has(l.id) || leaders.length >= 3) continue; seen.add(l.id);
    const p = player(l.id)!; leaders.push({ name: `${p.first} ${p.last}`.trim() || "#" + p.num, num: p.num, v: l.v, label: l.label });
  }
  return leaders;
}
function numbersOf(A: ReturnType<typeof aggregate>): RecapData["nums"] {
  const M = teamMetrics(A), hit = M.hitting, nums: RecapData["nums"] = [];
  if (A.T.K) nums.push({ v: String(A.T.K), label: "KILLS" });
  if (hit !== null && A.T.K) nums.push({ v: (hit < 0 ? "-" : "") + Math.abs(hit).toFixed(3).replace(/^0/, ""), label: "HITTING" });
  if (A.T.SA) nums.push({ v: String(A.T.SA), label: "ACES" });
  if (teamBlocks(A)) nums.push({ v: String(teamBlocks(A)), label: "BLOCKS" });
  if (A.T.D) nums.push({ v: String(A.T.D), label: "DIGS" });
  if (M.sideOut !== null) nums.push({ v: Math.round(M.sideOut * 100) + "%", label: "SIDE-OUT" });
  return nums.slice(0, 6);
}
const dispFont = () => getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui";

export async function recapData(m: Match, R: Replay, withPlays = true): Promise<RecapData> {
  const t = team()!, A = aggregate(R.sets);
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const leaders = leadersOf(A), nums = numbersOf(A);
  const dt = new Date(m.date + "T12:00:00");
  const [logoUs, logoThem] = await Promise.all([canvasImage(t.logo), canvasImage(m.oppLogo)]);
  return {
    us: t.name, them: m.opp || "Opponent", wonUs: R.wonUs, wonThem: R.wonThem, final: R.matchOver || m.status === "done",
    date: isNaN(+dt) ? m.date : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), event: m.event || "",
    sets: R.sets.filter((s) => s.us + s.them > 0).map((s) => ({ n: s.n, us: s.us, them: s.them, won: s.us > s.them })),
    leaders, nums, plays: withPlays ? recapPlays(m, R) : [], logoUs, logoThem, disp: dispFont(),
  };
}

/** A season recap: the record, the last few results, the season's leaders and the team's numbers. `items` newest first. */
export async function seasonRecapData(items: { m: Match; R: Replay }[], seasonName: string): Promise<RecapData> {
  const t = team()!, done = items.filter((x) => x.R.matchOver || x.m.status === "done"), A = aggregate(done.flatMap((x) => x.R.sets));
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const W = done.filter((x) => x.R.wonUs > x.R.wonThem).length, L = done.filter((x) => x.R.wonThem > x.R.wonUs).length;
  return {
    us: t.name, them: "", wonUs: W, wonThem: L, final: true, date: seasonName || "Season", event: "",
    sets: done.slice(0, 6).map((x, i) => ({ n: i + 1, us: x.R.wonUs, them: x.R.wonThem, won: x.R.wonUs > x.R.wonThem, label: (x.m.site === "away" ? "at " : "vs ") + (x.m.opp || "Opponent") })),
    season: { name: seasonName || "Season", matches: done.length },
    leaders: leadersOf(A, Math.max(3, Math.round(done.length * 1.5))), nums: numbersOf(A), plays: [], logoUs: await canvasImage(t.logo), logoThem: null, disp: dispFont(),
  };
}

const BLUE = "#9BD3F2", GREY = "#8A9099", BODY = "'Source Sans 3', system-ui, sans-serif";
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

/** Paint the recap at time t (seconds). `film` is the match video, already at the right moment, for the plays. */
export function drawRecap(g: CanvasRenderingContext2D, d: RecapData, t: number, film?: HTMLVideoElement | null) {
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
  const segs = [T_RESULT, T_SETS, ...d.leaders.map(() => T_LEAD), ...d.plays.map(() => T_PLAY), ...(d.nums.length ? [T_NUMS] : []), T_OUT]; let acc = 0;
  const sw = (W - 120 - (segs.length - 1) * 10) / segs.length;
  segs.forEach((len, i) => { const x = 60 + i * (sw + 10); g.fillStyle = "rgba(255,255,255,.22)"; g.fillRect(x, 70, sw, 6); g.fillStyle = "#fff"; g.fillRect(x, 70, sw * clamp((t - acc) / len), 6); acc += len; });
  text("FLOORCALL", W - 60, 130, 26, GREY, { align: "right", spacing: 7 });
  text(d.date.toUpperCase(), 60, 130, 26, GREY, { spacing: 3 });

  let at = 0;
  // 1. the result
  scene(t - at, T_RESULT, (a) => {
    if (d.season) {
      text(d.season.name.toUpperCase(), 80, 520, fit(d.season.name.toUpperCase(), W - 160, 64), BLUE, { spacing: 10 });
      text(`${d.season.matches} ${d.season.matches === 1 ? "match" : "matches"}`, 80, 580, 36, GREY, { font: BODY, weight: 600 });
      const k = ease((a - 0.4) / 0.9);
      if (d.logoUs) drawLogo(g, d.logoUs, 80, 650, 120);
      text(d.us.toUpperCase(), d.logoUs ? 230 : 80, 740, fit(d.us.toUpperCase(), W - (d.logoUs ? 310 : 160), 96), "#fff");
      text(String(Math.round(d.wonUs * k)), 80, 1110, 300, BLUE); text("WINS", 84, 1190, 52, GREY, { spacing: 8 });
      text(String(Math.round(d.wonThem * k)), W - 80, 1110, 300, "#fff", { align: "right" }); text("LOSSES", W - 84, 1190, 52, GREY, { align: "right", spacing: 8 });
      return;
    }
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
    text(d.season ? "LATEST RESULTS" : "SET BY SET", 80, 520, 52, BLUE, { spacing: 8 });
    const rh = Math.min(210, 1040 / Math.max(1, d.sets.length));
    d.sets.forEach((s, i) => {
      const k = ease((a - 0.15 - i * 0.18) / 0.45), y = 640 + i * rh;
      g.save(); g.globalAlpha *= k; g.translate((1 - k) * 80, 0);
      g.fillStyle = s.won ? "rgba(155,211,242,.16)" : "rgba(255,255,255,.07)"; g.fillRect(80, y, W - 160, rh - 24);
      if (s.won) { g.fillStyle = BLUE; g.fillRect(80, y, 10, rh - 24); }
      const my = y + (rh - 24) / 2 + 34;
      if (s.label) {
        const big = Math.min(96, rh * 0.5), lab = s.label.toUpperCase();
        text(lab, 130, my - 6, fit(lab, W - 560, 44), "#fff", { spacing: 2 });
        text(s.won ? "W" : s.us === s.them ? "T" : "L", W - 340, my, big, s.won ? BLUE : GREY, { align: "center" });
        text(`${s.us}–${s.them}`, W - 120, my, big, s.won ? BLUE : "#fff", { align: "right" });
      } else {
        text("SET " + s.n, 130, my - 6, 44, GREY, { spacing: 4 });
        text(`${s.us}`, W / 2 + 150, my, 104, s.won ? BLUE : "#fff", { align: "right" });
        text("–", W / 2 + 200, my - 8, 80, GREY, { align: "center" });
        text(`${s.them}`, W / 2 + 250, my, 104, s.won ? GREY : "#fff");
      }
      g.restore();
    });
  });
  at += T_SETS;
  // 3. top performers, one at a time
  d.leaders.forEach((l, i) => scene(t - at - i * T_LEAD, T_LEAD, (a) => {
    text(d.season ? "SEASON LEADER" : "TOP PERFORMER", 80, 520, 52, BLUE, { spacing: 8 });
    const v = l.v * ease((a - 0.1) / 0.7), shown = Number.isInteger(l.v) ? String(Math.round(v)) : v.toFixed(1);
    text(shown, 70, 1010, 460, "#fff");
    text(l.label, 84, 1110, 84, BLUE, { spacing: 10 });
    g.fillStyle = "rgba(255,255,255,.16)"; g.fillRect(80, 1180, W - 160, 3);
    text(l.name, 80, 1300, fit(l.name, W - 160, 96, BODY), "#fff", { font: BODY });
    text("#" + l.num, 80, 1380, 56, GREY);
  }));
  at += d.leaders.length * T_LEAD;
  // 4. plays from the film: the video fills a tall frame (cropped to fit), the call underneath
  d.plays.forEach((pl, i) => scene(t - at - i * T_PLAY, T_PLAY, (a) => {
    const x = 60, y = 230, w = W - 120, h = 1120;
    g.save(); g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, y, w, h, 28) : g.rect(x, y, w, h); g.clip();
    g.fillStyle = "#14171B"; g.fillRect(x, y, w, h);
    if (film && film.videoWidth) { const k = Math.max(w / film.videoWidth, h / film.videoHeight), vw = film.videoWidth * k, vh = film.videoHeight * k; g.drawImage(film, x + (w - vw) / 2, y + (h - vh) / 2, vw, vh); }
    g.restore();
    const k = ease((a - 0.25) / 0.5);
    g.save(); g.globalAlpha *= k; g.translate(0, (1 - k) * 30);
    g.fillStyle = BLUE; g.fillRect(60, 1400, 10, 190);
    text(pl.label, 100, 1470, 88, BLUE, { spacing: 8 });
    text(pl.who, 100, 1548, fit(pl.who, W - 200, 60, BODY), "#fff", { font: BODY });
    if (pl.sub) text(pl.sub, 100, 1596, 36, GREY, { font: BODY, weight: 600 });
    g.restore();
  }));
  at += d.plays.length * T_PLAY;
  // 5. team numbers
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
  // 6. outro
  scene(t - at, T_OUT + 1, () => {
    if (d.logoUs) drawLogo(g, d.logoUs, W / 2 - 110, 560, 220);
    text(d.us.toUpperCase(), W / 2, 920, fit(d.us.toUpperCase(), W - 160, 120), "#fff", { align: "center" });
    const line = d.season ? `${d.wonUs}–${d.wonThem} · ${d.season.name}` : `${d.wonUs}–${d.wonThem} vs ${d.them}`;
    text(line, W / 2, 1010, fit(line, W - 200, 60, BODY), GREY, { align: "center", font: BODY, weight: 600 });
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
  const film = d.plays.length ? document.createElement("video") : null;
  if (film) { film.muted = true; film.playsInline = true; film.preload = "auto"; film.crossOrigin = "anonymous"; }
  const stopIf = () => { if (o.signal?.aborted) throw new DOMException("Stopped", "AbortError"); };
  const tick = () => new Promise((r) => setTimeout(r, 1000 / 30)); // setTimeout keeps recording in a background tab, where animation frames stop
  /** Cards between `from` and `to` on the recap's clock. */
  const cards = async (from: number, to: number) => { const t0 = performance.now(); for (;;) { stopIf(); const t = from + (performance.now() - t0) / 1000; if (t >= to) break; drawRecap(g, d, t, film); o.onProgress?.(t / len); await tick(); } };
  try {
    const p0 = recapPlaysAt(d);
    await cards(0, p0);
    for (let i = 0; film && i < d.plays.length; i++) {
      const pl = d.plays[i], base = p0 + i * T_PLAY;
      rec.pause(); // don't record the wait while the film loads and finds the play
      try {
        if (film.src !== new URL(pl.src, location.href).href) { film.src = pl.src; await new Promise<void>((ok, bad) => { film.onloadedmetadata = () => ok(); film.onerror = () => bad(new Error("film")); }); }
        film.currentTime = pl.start; await new Promise((r) => film.addEventListener("seeked", r, { once: true }));
        await film.play();
      } catch { rec.resume(); await cards(base, base + T_PLAY); continue; } // the film wouldn't open: hold the frame empty rather than fail the whole video
      rec.resume();
      while (film.currentTime < pl.end && !film.ended) { stopIf(); const t = base + Math.min(T_PLAY - 0.02, film.currentTime - pl.start); drawRecap(g, d, t, film); o.onProgress?.(t / len); await tick(); }
      film.pause();
    }
    await cards(p0 + d.plays.length * T_PLAY, len - 0.01);
  } finally { try { rec.stop(); } catch { /* already stopped */ } stream.getTracks().forEach((x) => x.stop()); if (film) { film.pause(); film.removeAttribute("src"); } }
  await done;
  return new Blob(parts, { type: mime.split(";")[0] });
}
