/** Highlight video maker: turns a player's clips into one finished video, broadcast style, right in the browser.
 *   intro card (photo, name, number, class, team) → each play with a lower-third ("KILL · vs Central · Set 2 · 14–12")
 *   and a player bug → outro card (season numbers, "verified by the coaching staff", the profile link).
 * Frames are drawn on a canvas from the match video and recorded with MediaRecorder; sound comes from the video through
 * Web Audio (recorded, not played out loud). Works with video files on this device or links that allow it (same site or CORS). */
import type { Clip } from "./clips";

export interface ReelPlayer { first: string; last: string; num: string; pos: string; grad: number | null; height: string; photo?: string | null }
export interface ReelInfo { player: ReelPlayer; team: { name: string; logo?: string | null; level?: string }; stats: { label: string; value: string }[]; link?: string; accent?: string; /** false for reels an athlete makes from their own clips: no "recorded by the staff" line */ verified?: boolean; /** contact lines for the closing card (email, club team, GPA) */ lines?: string[] }
export interface ReelOptions { width?: number; height?: number; fps?: number; intro?: number; outro?: number; onProgress?: (text: string, frac: number) => void; preview?: HTMLCanvasElement | null; signal?: AbortSignal }

export const reelMime = () => (typeof MediaRecorder === "undefined" ? "" : ["video/mp4;codecs=avc1,mp4a", "video/mp4;codecs=avc1", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || "");
export const canMakeReel = () => typeof MediaRecorder !== "undefined" && typeof (HTMLCanvasElement.prototype as any).captureStream === "function" && !!reelMime();
/** Seconds of video the reel will run: cards plus each clip. */
export const reelLength = (clips: Clip[], intro = 3, outro = 4) => intro + outro + clips.reduce((a, c) => a + Math.max(0, c.end - c.start), 0);

const loadImg = (src?: string | null) => new Promise<HTMLImageElement | null>((ok) => { if (!src) return ok(null); const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; setTimeout(() => ok(null), 6000); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export async function renderReel(clips: Clip[], resolve: (c: Clip) => string | null, info: ReelInfo, o: ReelOptions = {}): Promise<Blob> {
  const W = o.width || 1280, H = o.height || 720, FPS = o.fps || 30, INTRO = o.intro ?? 3, OUTRO = o.outro ?? 4, BLUE = info.accent || "#9BD3F2";
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!; g.imageSmoothingQuality = "high";
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const disp = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui", body = "'Source Sans 3', system-ui, sans-serif";
  const [photo, logo] = await Promise.all([loadImg(info.player.photo), loadImg(info.team.logo)]);
  const name = `${info.player.first} ${info.player.last}`.trim().toUpperCase() || "#" + info.player.num;
  const meta = [info.player.grad ? "Class of " + info.player.grad : "", info.player.pos, info.player.height].filter(Boolean).join("  ·  ");
  const text = (s: string, x: number, y: number, size: number, color: string, f: { font?: string; weight?: number; align?: CanvasTextAlign; spacing?: number; alpha?: number } = {}) => {
    g.save(); g.globalAlpha = f.alpha ?? 1; g.font = `${f.weight || 700} ${size}px ${f.font || disp}`; g.fillStyle = color; g.textAlign = f.align || "left";
    try { (g as any).letterSpacing = (f.spacing || 0) + "px"; } catch { /* older browsers */ } g.fillText(s, x, y); g.restore();
  };
  const fit = (s: string, max: number, size: number, weight = 700) => { let z = size; g.font = `${weight} ${z}px ${disp}`; while (z > 18 && g.measureText(s).width > max) { z -= 2; g.font = `${weight} ${z}px ${disp}`; } return z; };
  const rr = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  const tile = (img: HTMLImageElement, x: number, y: number, s: number, round = 0.18, cover = false) => {
    g.save(); rr(x, y, s, s, s * round); g.clip();
    if (cover) { const k = Math.max(s / img.naturalWidth, s / img.naturalHeight); g.drawImage(img, x + (s - img.naturalWidth * k) / 2, y + (s - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
    else { g.fillStyle = "#fff"; g.fillRect(x, y, s, s); const k = Math.min((s * 0.82) / img.naturalWidth, (s * 0.82) / img.naturalHeight); g.drawImage(img, x + (s - img.naturalWidth * k) / 2, y + (s - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
    g.restore();
  };
  const backdrop = () => { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 3; for (let x = -H; x < W; x += 70) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); } g.fillStyle = BLUE; g.fillRect(0, H - 10, W, 10); };

  // ---- cards
  const intro = (t: number) => {
    backdrop(); const a = ease(t / 0.6), s = H * 0.42;
    if (photo) tile(photo, W * 0.08, H * 0.29 + (1 - a) * 30, s, 0.12, true);
    const x = photo ? W * 0.08 + s + 50 : W * 0.08;
    text("#" + info.player.num, x, H * 0.36, 52, BLUE, { alpha: a });
    text(name, x, H * 0.36 + 92, fit(name, W - x - 60, 92), "#fff", { alpha: a });
    text(meta, x, H * 0.36 + 150, 32, "#C7CCD3", { font: body, weight: 600, alpha: ease((t - 0.3) / 0.6) });
    text([info.team.name, info.team.level].filter(Boolean).join("  ·  ").toUpperCase(), x, H * 0.36 + 200, 26, "#8A9099", { spacing: 4, alpha: ease((t - 0.5) / 0.6) });
    if (logo) tile(logo, W - 70 - 96, 50, 96);
    text("HIGHLIGHTS", W * 0.08, 80, 26, BLUE, { spacing: 8 });
  };
  const outro = (t: number) => {
    backdrop(); const a = ease(t / 0.6);
    text(name, W / 2, 150, fit(name, W - 160, 70), "#fff", { align: "center", alpha: a });
    const st = info.stats.slice(0, 4), cw = Math.min(250, (W - 160) / Math.max(1, st.length)), x0 = W / 2 - (cw * st.length) / 2;
    st.forEach((s, i) => { const x = x0 + cw * i + cw / 2, al = ease((t - 0.2 - i * 0.12) / 0.5); text(s.value, x, 330, 84, "#fff", { align: "center", alpha: al }); text(s.label.toUpperCase(), x, 375, 22, "#8A9099", { align: "center", spacing: 4, alpha: al }); });
    const lines = (info.lines || []).filter(Boolean).slice(0, 4);
    lines.forEach((l, i) => text(l, W / 2, (st.length ? 430 : 270) + i * 46, fit(l, W - 220, 32, 600), i ? "#C7CCD3" : "#fff", { align: "center", font: body, weight: 600, alpha: ease((t - 0.4 - i * 0.12) / 0.5) }));
    if (info.verified !== false) text("✓ Stats recorded live by " + info.team.name + "'s coaching staff", W / 2, 480, 26, BLUE, { align: "center", font: body, weight: 700, alpha: ease((t - 0.8) / 0.6) });
    if (info.link) text(info.link, W / 2, 540, fit(info.link, W - 200, 26, 600), "#C7CCD3", { align: "center", font: body, weight: 600, alpha: ease((t - 1) / 0.6) });
    text("JUMPSET", W / 2, H - 50, 20, "#8A9099", { align: "center", spacing: 8 });
  };
  // ---- a play: the video, a player bug top-left, the lower third sliding in
  const lowerThird = (c: Clip, t: number) => {
    const a = ease((t - 0.3) / 0.5), y = H - 150 + (1 - a) * 40, label = c.label.toUpperCase(), sub = [c.opp ? "vs " + c.opp : "", c.set ? "Set " + c.set : "", c.score || ""].filter(Boolean).join("  ·  ");
    g.save(); g.globalAlpha = a;
    g.font = `700 44px ${disp}`; const lw = g.measureText(label).width; g.font = `600 24px ${body}`; const sw = g.measureText(sub).width, w = Math.max(lw, sw) + 70;
    g.fillStyle = "rgba(0,0,0,.82)"; rr(50, y, w, 100, 10); g.fill(); g.fillStyle = BLUE; g.fillRect(50, y, 8, 100);
    g.restore();
    text(label, 80, y + 50, 44, "#fff", { alpha: a }); text(sub, 80, y + 84, 24, "#C7CCD3", { font: body, weight: 600, alpha: a });
  };
  const bug = () => {
    const label = info.player.num ? `#${info.player.num} ${name}` : name; g.font = `700 26px ${disp}`; const w = g.measureText(label).width + (photo ? 76 : 36);
    g.fillStyle = "rgba(0,0,0,.72)"; rr(40, 36, w, 52, 26); g.fill();
    if (photo) { g.save(); g.beginPath(); g.arc(66, 62, 20, 0, Math.PI * 2); g.clip(); const k = Math.max(40 / photo.naturalWidth, 40 / photo.naturalHeight); g.drawImage(photo, 66 - (photo.naturalWidth * k) / 2, 62 - (photo.naturalHeight * k) / 2, photo.naturalWidth * k, photo.naturalHeight * k); g.restore(); }
    text(label, photo ? 96 : 58, 71, 26, "#fff");
    if (logo) tile(logo, W - 40 - 56, 34, 56);
  };
  const frameOf = (v: HTMLVideoElement) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    const k = Math.min(W / v.videoWidth, H / v.videoHeight) || 1, w = v.videoWidth * k, h = v.videoHeight * k;
    if (v.videoWidth) g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
  };
  const blit = () => { if (o.preview) { const pg = o.preview.getContext("2d"); pg?.drawImage(cv, 0, 0, o.preview.width, o.preview.height); } };

  // ---- recording
  const video = document.createElement("video"); video.playsInline = true; video.preload = "auto"; video.crossOrigin = "anonymous";
  const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ac = AC ? new AC() : null, dest = ac?.createMediaStreamDestination();
  try { if (ac && dest) { ac.createMediaElementSource(video).connect(dest); await ac.resume().catch(() => {}); } } catch { /* no sound in the reel */ }
  const stream = (cv as any).captureStream(FPS) as MediaStream; dest?.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  const mime = reelMime(), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 }), parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise((r) => (rec.onstop = r));
  const total = reelLength(clips, INTRO, OUTRO); let done = 0;
  const progress = (txt: string) => o.onProgress?.(txt, Math.min(1, done / total));
  const card = async (draw: (t: number) => void, secs: number, label: string) => {
    const t0 = performance.now();
    while (true) { if (o.signal?.aborted) throw new DOMException("cancelled", "AbortError"); const t = (performance.now() - t0) / 1000; if (t >= secs) break; draw(t); blit(); progress(label); await wait(1000 / FPS); }
    done += secs;
  };
  try {
    rec.start(500);
    await card(intro, INTRO, "Title card");
    for (let k = 0; k < clips.length; k++) {
      const c = clips[k], src = resolve(c); if (!src) continue;
      if (video.src !== new URL(src, location.href).href) { video.src = src; await new Promise<void>((ok, bad) => { video.onloadedmetadata = () => ok(); video.onerror = () => bad(new Error("The video for this play couldn't be opened.")); }); }
      rec.pause(); video.pause(); video.currentTime = c.start; await new Promise((r) => video.addEventListener("seeked", r, { once: true })); rec.resume();
      await video.play();
      const t0 = video.currentTime;
      while (video.currentTime < c.end && !video.ended) {
        if (o.signal?.aborted) throw new DOMException("cancelled", "AbortError");
        const t = video.currentTime - t0; frameOf(video); bug(); lowerThird(c, t);
        const left = c.end - video.currentTime; if (left < 0.3) { g.fillStyle = `rgba(0,0,0,${1 - left / 0.3})`; g.fillRect(0, 0, W, H); }
        blit(); progress(`Play ${k + 1} of ${clips.length}: ${c.label}`); await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      video.pause(); done += c.end - c.start;
    }
    await card(outro, OUTRO, "Closing card");
    rec.stop(); await stopped;
  } catch (e) { try { if (rec.state !== "inactive") rec.stop(); } catch { /* ignore */ } video.pause(); ac?.close().catch(() => {}); throw e; }
  video.pause(); video.removeAttribute("src"); ac?.close().catch(() => {});
  return new Blob(parts, { type: mime.split(";")[0] });
}
