/** Finds rallies in game film from the referee's whistle: a whistle is a loud, pure tone around 2–4 kHz that lasts
 * a quarter second or more (cheering is noisy, shoe squeaks are short). The first whistle is the serve, the next
 * one ends the rally. Pure: works on frames from a decoded file or from the live audio while the video plays. */

export interface Frame { t: number; peak: number; band: number; level: number } // t seconds; peak = strongest band bin / all; band = band share; level = band power
export interface Rally { start: number; end: number }

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
  let all = 0, band = 0, peak = 0;
  const lo = Math.ceil((LO * size) / sr), hi = Math.min(power.length - 1, Math.floor((HI * size) / sr));
  for (let i = 2; i < power.length; i++) { const p = power[i]; all += p; if (i >= lo && i <= hi) { band += p; if (i > lo && i < hi) { const p3 = power[i - 1] + p + power[i + 1]; if (p3 > peak) peak = p3; } } }
  return { t, peak: all ? peak / all : 0, band: all ? band / all : 0, level: band };
}

/** Frames for mono samples (any sample rate ≥ 9 kHz). Hop ≈ 32 ms. */
export function framesOf(samples: Float32Array, sr: number, onProgress?: (f: number) => void): Frame[] {
  const size = sr > 24000 ? 2048 : sr > 12000 ? 512 : 256, hop = Math.round(sr * 0.032), out: Frame[] = [];
  const re = new Float32Array(size), im = new Float32Array(size), pw = new Float32Array(size / 2), win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const total = Math.max(1, samples.length - size);
  for (let s = 0, k = 0; s + size <= samples.length; s += hop, k++) {
    for (let i = 0; i < size; i++) { re[i] = samples[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i < size / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
    out.push(frameFrom(s / sr, pw, sr, size));
    if (onProgress && k % 4000 === 0) onProgress(s / total);
  }
  return out;
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
  let start = -1, last = -1;
  const close = () => { if (start >= 0 && last - start + 0.032 >= minDur) { if (!out.length || start - out[out.length - 1] > gapS) out.push(+start.toFixed(2)); } start = -1; };
  for (const f of frames) {
    if (hot(f)) { if (start < 0) start = f.t; last = f.t; }
    else if (start >= 0 && f.t - last > 0.1) close();
  }
  close();
  return out;
}

/** Pair whistles into rallies: serve whistle → end whistle. A rally longer than `maxRally` means a whistle was missed,
 * so the pairing restarts at the second one. Padding gives a little before the serve and after the end. */
export function ralliesFrom(whistles: number[], duration = Infinity, o: { maxRally?: number; minRally?: number; before?: number; after?: number } = {}): Rally[] {
  const maxR = o.maxRally ?? 45, minR = o.minRally ?? 2.5, before = o.before ?? 1, after = o.after ?? 2;
  const out: Rally[] = [];
  for (let i = 0; i + 1 < whistles.length; ) {
    const a = whistles[i], b = whistles[i + 1], d = b - a;
    if (d < minR) { i += 1; continue; } // a double toot
    if (d > maxR) { i += 1; continue; }
    out.push({ start: Math.max(0, +(a - before).toFixed(1)), end: Math.min(duration, +(b + after).toFixed(1)) });
    i += 2;
  }
  return out;
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
export async function scanFile(file: Blob, onProgress?: (text: string, f: number) => void, signal?: AbortSignal): Promise<{ whistles: number[]; duration: number }> {
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
  return { whistles: findWhistles(frames), duration: buf.duration };
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
