/** Finds rallies in game film from the referee's whistle: a whistle is a loud, pure tone around 2–4 kHz that lasts
 * a quarter second or more (cheering is noisy, shoe squeaks are short). The first whistle is the serve, the next
 * one ends the rally. Pure: works on frames from a decoded file or from the live audio while the video plays. */

export interface Frame { t: number; peak: number; band: number; level: number; loud?: number; hz?: number } // t seconds; peak = strongest band bin / all; band = band share; level = band power; loud = power outside the whistle band (crowd, bench)
/** h: how big the moment was, 0–1, from the crowd's reaction and the rally's length (see hypeScores). */
export interface Rally { start: number; end: number; h?: number }

const LO = 1900, HI = 4300;

/** In-place radix-2 FFT (re, im of length 2^k). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Frame features from power per FFT bin (bin i is i*sr/size Hz). */
export function frameFrom(t: number, power: ArrayLike<number>, sr: number, size: number): Frame {
  let all = 0, band = 0, peak = 0, at = 0;
  const lo = Math.ceil((LO * size) / sr), hi = Math.min(power.length - 1, Math.floor((HI * size) / sr));
  for (let i = 2; i < power.length; i++) { const p = power[i]; all += p; if (i >= lo && i <= hi) { band += p; if (i > lo && i < hi) { const p3 = power[i - 1] + p + power[i + 1]; if (p3 > peak) { peak = p3; at = i; } } } }
  return { t, peak: all ? peak / all : 0, band: all ? band / all : 0, level: band, loud: all - band, hz: Math.round((at * sr) / size) };
}

/** Frames for mono samples (any sample rate ≥ 9 kHz). Hop ≈ 32 ms. */
export function framesOf(samples: Float32Array, sr: number, onProgress?: (f: number) => void): Frame[] {
  const f = new Framer(sr, onProgress && ((k) => onProgress(k / Math.max(1, samples.length))));
  f.push(samples);
  return f.frames;
}

/** The same frames, fed a piece at a time (a long film's sound arrives in slices; see mp4audio.ts). */
export class Framer {
  frames: Frame[] = [];
  private size: number; private hop: number; private re: Float32Array; private im: Float32Array; private pw: Float32Array; private win: Float32Array;
  private buf = new Float32Array(0); private at = 0; // samples consumed before buf[0]
  constructor(private sr: number, private onProgress?: (samplesDone: number) => void) {
    this.size = sr > 24000 ? 2048 : sr > 12000 ? 512 : 256; this.hop = Math.round(sr * 0.032);
    this.re = new Float32Array(this.size); this.im = new Float32Array(this.size); this.pw = new Float32Array(this.size / 2); this.win = new Float32Array(this.size);
    for (let i = 0; i < this.size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.size - 1));
  }
  push(samples: Float32Array) {
    const { size, hop, re, im, pw, win, sr } = this;
    let buf = samples;
    if (this.buf.length) { buf = new Float32Array(this.buf.length + samples.length); buf.set(this.buf); buf.set(samples, this.buf.length); }
    let s = 0;
    for (; s + size <= buf.length; s += hop) {
      for (let i = 0; i < size; i++) { re[i] = buf[s + i] * win[i]; im[i] = 0; }
      fft(re, im);
      for (let i = 0; i < size / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
      this.frames.push(frameFrom((this.at + s) / sr, pw, sr, size));
      if (this.onProgress && this.frames.length % 4000 === 0) this.onProgress(this.at + s);
    }
    this.at += s; this.buf = buf.slice(s);
  }
}

/** Whistle start times. A frame counts when the band is a clear, pure peak well above the usual band level;
 * a whistle is ≥ minDur of such frames (small gaps allowed). Whistles closer than `gap` seconds are merged. */
export function findWhistles(frames: Frame[], o: { minDur?: number; gap?: number } = {}): number[] {
  if (!frames.length) return [];
  frames = frames.slice().sort((a, b) => a.t - b.t);
  const minDur = o.minDur ?? 0.22, gapS = o.gap ?? 1.2;
  const levels = frames.map((f) => f.level).filter((x) => x > 0).sort((a, b) => a - b);
  const med = levels.length ? levels[Math.floor(levels.length / 2)] : 0;
  const hot = (f: Frame) => f.peak > 0.18 && f.band > 0.45 && f.level > med * 3;
  const out: number[] = [];
  // A whistle holds one pitch; shoe squeaks are short and each one is a different pitch, so a run of hot frames
  // whose pitch jumps is squeaks running together, not a whistle. Frames without a pitch (older data) skip the check.
  let start = -1, last = -1, pitch = 0, jumps = 0, n = 0;
  const close = () => { if (start >= 0 && last - start + 0.032 >= minDur && jumps <= Math.floor(n * 0.15)) { if (!out.length || start - out[out.length - 1] > gapS) out.push(+start.toFixed(2)); } start = -1; jumps = 0; n = 0; };
  for (const f of frames) {
    if (hot(f)) {
      const jump = start >= 0 && !!f.hz && !!pitch && Math.abs(f.hz - pitch) > Math.max(160, pitch * 0.06);
      if (jump && f.t - last > 0.04) close(); // a new sound after a break, at another pitch: a new run
      else if (jump) jumps++;
      if (start < 0) start = f.t;
      last = f.t; n++; if (f.hz) pitch = f.hz;
    }
    else if (start >= 0 && f.t - last > 0.1) close();
  }
  close();
  return out;
}

/** Pair whistles into rallies: serve whistle → end whistle.
 * Not greedily: one stray whistle (a squeak that got through, a second toot) would flip serve and end for every
 * rally after it. Instead, pick the pairing for the whole film that best fits how matches run: a rally lasts a few
 * seconds to half a minute, the next serve comes several seconds after the point ends, and a whistle can be left
 * out as noise at a cost. `maxRally` caps a rally; padding gives a little before the serve and after the end. */
export function ralliesFrom(whistles: number[], duration = Infinity, o: { maxRally?: number; minRally?: number; before?: number; after?: number } = {}): Rally[] {
  const maxR = o.maxRally ?? 45, minR = o.minRally ?? 2.5, before = o.before ?? 1, after = o.after ?? 2;
  const w = whistles, n = w.length;
  if (n < 2) return [];
  const NOISE = 4, REWARD = 12;
  // Rallies usually run shorter than the time between points (players reset, the server gets the ball, the referee
  // checks), so a long "rally" and a short "gap" each cost a little. A pairing flipped by one stray whistle makes
  // every later rally look like a gap and every gap like a rally, and those little costs add up over a match.
  const rallyCost = (d: number) => (d < minR || d > maxR ? Infinity : d < 3 ? (3 - d) * 4 : (d > 12 ? (d - 12) * 0.5 : 0) + (d > 25 ? (d - 25) * 0.4 : 0));
  const gapCost = (g: number) => (g < 1.5 ? Infinity : (g < 6 ? (6 - g) * 1.5 : 0) + (g < 12 ? (12 - g) * 0.5 : 0));
  // best[e] = lowest cost with whistle e ending a rally; from[e] = [serve index, previous end index]
  const best = new Float64Array(n).fill(Infinity), from: [number, number][] = new Array(n);
  for (let e = 1; e < n; e++) {
    for (let st = e - 1; st >= 0 && w[e] - w[st] <= maxR; st--) {
      const rc = rallyCost(w[e] - w[st]); if (rc === Infinity) continue;
      const inside = (e - st - 1) * NOISE;
      // the first rally: everything before it is noise
      let bestHere = st * NOISE, prevE = -1;
      for (let pe = st - 1; pe >= 0 && st - pe <= 8; pe--) {
        if (best[pe] === Infinity) continue;
        const c = best[pe] + (st - pe - 1) * NOISE + gapCost(w[st] - w[pe]);
        if (c < bestHere) { bestHere = c; prevE = pe; }
      }
      const total = bestHere + inside + rc - REWARD;
      if (total < best[e]) { best[e] = total; from[e] = [st, prevE]; }
    }
  }
  // the last rally: everything after it is noise
  let last = -1, lastCost = 0;
  for (let e = 0; e < n; e++) if (best[e] !== Infinity) { const c = best[e] + (n - e - 1) * NOISE; if (last < 0 || c < lastCost) { last = e; lastCost = c; } }
  const out: Rally[] = [];
  for (let e = last; e >= 0; ) {
    const [st, pe] = from[e];
    out.push({ start: Math.max(0, +(w[st] - before).toFixed(1)), end: Math.min(duration, +(w[e] + after).toFixed(1)) });
    e = pe;
  }
  return out.reverse();
}

/** Mono samples from a decoded audio buffer. */
export function monoOf(buf: { numberOfChannels: number; length: number; getChannelData: (c: number) => Float32Array }): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

/** Biggest file we decode in one go; longer films are scanned by listening while they play fast. */
export const DECODE_LIMIT = 700 * 1024 * 1024;

/** Scan a video file: decode its audio at a low sample rate and find the whistles. */
export async function scanFile(file: Blob, onProgress?: (text: string, f: number) => void, signal?: AbortSignal): Promise<{ whistles: number[]; duration: number; frames: Frame[] }> {
  onProgress?.("Reading the film…", 0.02);
  const data = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException("stopped", "AbortError");
  onProgress?.("Pulling out the sound…", 0.1);
  const Ctx: any = (globalThis as any).OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext;
  const ctx = new Ctx(1, 16000, 16000);
  const buf: AudioBuffer = await ctx.decodeAudioData(data);
  if (signal?.aborted) throw new DOMException("stopped", "AbortError");
  onProgress?.("Listening for whistles…", 0.4);
  await new Promise((r) => setTimeout(r, 0));
  const frames = framesOf(monoOf(buf), buf.sampleRate, (f) => onProgress?.("Listening for whistles…", 0.4 + f * 0.55));
  return { whistles: findWhistles(frames), duration: buf.duration, frames };
}

/** Scan a long MP4/MOV film by streaming its sound (see mp4audio.ts): any length, small memory. */
export async function scanStream(file: Blob, onProgress?: (text: string, f: number) => void, signal?: AbortSignal): Promise<{ whistles: number[]; duration: number; frames: Frame[] }> {
  const { streamAudio } = await import("./mp4audio");
  let framer: Framer | null = null;
  onProgress?.("Reading the film's sound…", 0.01);
  const { duration } = await streamAudio(file, (mono, sr) => { (framer ||= new Framer(sr)).push(mono); }, (f) => onProgress?.("Listening for whistles…", 0.02 + f * 0.95), signal);
  const frames = framer ? (framer as Framer).frames : [];
  return { whistles: findWhistles(frames), duration, frames };
}

/** Frame features from an AnalyserNode (dB per bin) while the video plays. */
export function frameFromAnalyser(t: number, db: Float32Array, sr: number, fftSize: number): Frame {
  const pw = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) pw[i] = Number.isFinite(db[i]) ? Math.pow(10, db[i] / 10) : 0;
  return frameFrom(t, pw, sr, fftSize);
}

/** Which rallies have a point-ending play statted in them (a play inside the rally, or within `grace` seconds after
 * its end, since plays are often entered once the video pauses at the whistle). Pure: unit tested. */
export function rallyCheck(rallies: Rally[], plays: { t: number; point: boolean }[], grace = 4): { scored: boolean[]; missing: number[] } {
  const scored = rallies.map((r, i) => {
    const until = Math.min(r.end + grace, rallies[i + 1] ? rallies[i + 1].start : Infinity);
    return plays.some((p) => p.point && p.t >= r.start - 0.5 && p.t <= until);
  });
  return { scored, missing: scored.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0) };
}

/** The rally whose end the playhead just crossed (from `prev` to `t`), or -1. */
export function crossedEnd(rallies: Rally[], prev: number, t: number): number {
  if (t <= prev || t - prev > 2) return -1; // seeks don't count
  return rallies.findIndex((r) => prev < r.end && t >= r.end);
}

/* ---------- big moments: the crowd tells you which rallies mattered ---------- */
const median = (xs: number[]) => { if (!xs.length) return 0; const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
/** Average of the loudest third of the frames in [a, b]: a cheer is a burst, so the quiet frames around it don't dilute it. */
function burst(frames: Frame[], a: number, b: number): number {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (frames[mid].t < a) lo = mid + 1; else hi = mid; }
  const xs: number[] = [];
  for (let i = lo; i < frames.length && frames[i].t <= b; i++) xs.push(frames[i].loud ?? 0);
  if (!xs.length) return 0;
  xs.sort((x, y) => y - x); const k = Math.max(1, Math.ceil(xs.length / 3)); let t = 0; for (let i = 0; i < k; i++) t += xs[i]; return t / k;
}
/** How big each rally was, 0–1: mostly the crowd and bench reaction in the seconds after the whistle, plus how long the
 * ball stayed up. Ranked within the film, so a quiet gym and a loud one both get their best rallies on top. */
export function hypeScores(frames: Frame[], rallies: Rally[]): number[] {
  if (!rallies.length) return [];
  const fs = frames.slice().sort((a, b) => a.t - b.t), base = median(fs.map((f) => f.loud ?? 0)) || 1e-9;
  const crowd = rallies.map((r) => Math.log(1 + burst(fs, r.end - 0.5, r.end + 4) / base));
  const len = rallies.map((r) => r.end - r.start);
  const rank = (xs: number[]) => { const o = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]), out = new Array(xs.length).fill(0); o.forEach(([, i], k) => (out[i] = xs.length > 1 ? k / (xs.length - 1) : 1)); return out; };
  const rc = rank(crowd), rl = rank(len);
  return rallies.map((_, i) => +(0.75 * rc[i] + 0.25 * rl[i]).toFixed(2));
}
/** Rallies with their scores filled in. */
export const withHype = (frames: Frame[], rallies: Rally[]): Rally[] => { const h = hypeScores(frames, rallies); return rallies.map((r, i) => ({ ...r, h: h[i] })); };

/** When no whistles were heard (a phone far from the court, music over the film), the crowd still marks the big
 * moments: loud bursts at least `apart` seconds from each other, each as a clip leading up to it. */
export function loudMoments(frames: Frame[], o: { max?: number; apart?: number; before?: number; after?: number; duration?: number } = {}): Rally[] {
  const max = o.max ?? 15, apart = o.apart ?? 20, before = o.before ?? 9, after = o.after ?? 3;
  const fs = frames.slice().sort((a, b) => a.t - b.t); if (fs.length < 40) return [];
  const base = median(fs.map((f) => f.loud ?? 0)) || 1e-9;
  // one-second windows, scored by their burst against the film's usual level
  const end = fs[fs.length - 1].t, wins: { t: number; v: number }[] = [];
  for (let t = 0; t + 1 <= end; t += 0.5) wins.push({ t: t + 0.5, v: burst(fs, t, t + 1) / base });
  const peaks = wins.filter((w, i) => w.v >= 2.5 && w.v >= (wins[i - 1]?.v ?? 0) && w.v >= (wins[i + 1]?.v ?? 0)).sort((a, b) => b.v - a.v);
  const kept: { t: number; v: number }[] = [];
  for (const p of peaks) { if (kept.length >= max) break; if (kept.every((k) => Math.abs(k.t - p.t) >= apart)) kept.push(p); }
  if (!kept.length) return [];
  const top = kept[0].v, low = kept[kept.length - 1].v;
  return kept.sort((a, b) => a.t - b.t).map((k) => ({ start: Math.max(0, +(k.t - before).toFixed(1)), end: +Math.min(o.duration ?? Infinity, k.t + after).toFixed(1), h: +(top === low ? 1 : 0.4 + (0.6 * (k.v - low)) / (top - low)).toFixed(2) }));
}
/** The best `n` (by h), in film order. */
export const bestOf = (rs: Rally[], n: number): Rally[] => rs.map((r, i) => ({ r, i })).filter((x) => typeof x.r.h === "number").sort((a, b) => (b.r.h! - a.r.h!) || a.i - b.i).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.r);
