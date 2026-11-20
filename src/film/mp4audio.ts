/** Reads the sound out of a long MP4 or MOV game film without loading it all at once.
 * A phone or camera film of a whole match is often 1–3 GB and two hours long. Decoding all its audio in one go
 * (decodeAudioData) needs the whole file in memory and fails on big files; listening while it plays takes a
 * quarter of the film's length. Instead: read the file's index (the "moov" box), find the AAC audio samples,
 * read the file in big slices, decode with the browser's AudioDecoder (WebCodecs), and hand mono samples at
 * about 16 kHz to the whistle finder as they come. Memory stays small whatever the film's length.
 * The index parser is pure (tested with Node); decoding needs a browser with AudioDecoder. */

export interface AudioTrack {
  timescale: number; sampleRate: number; channels: number;
  /** AudioSpecificConfig for the decoder, and the codec string, e.g. mp4a.40.2 */
  config: Uint8Array; codec: string;
  /** byte offset, size and start (in timescale units) of every AAC frame, in file order */
  offsets: Float64Array; sizes: Uint32Array; times: Float64Array;
  duration: number; // seconds
}

type Reader = (start: number, end: number) => Promise<Uint8Array>;
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u64 = (b: Uint8Array, i: number) => u32(b, i) * 4294967296 + u32(b, i + 4);
const type = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** Top-level boxes: walk the headers only, so a 3 GB file costs a few tiny reads. Returns the moov box's bytes. */
export async function readMoov(read: Reader, fileSize: number): Promise<Uint8Array | null> {
  let at = 0;
  for (let guard = 0; at + 8 <= fileSize && guard < 10000; guard++) {
    const h = await read(at, Math.min(fileSize, at + 16));
    let size = u32(h, 0), head = 8;
    const t = type(h, 4);
    if (size === 1) { size = u64(h, 8); head = 16; } else if (size === 0) size = fileSize - at;
    if (size < head) return null;
    if (t === "moov") return size > 256 * 1024 * 1024 ? null : read(at, at + size);
    at += size;
  }
  return null;
}

/** Children of a box: [type, start, end] (start after the header). */
function kids(b: Uint8Array, from: number, to: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (let i = from; i + 8 <= to; ) {
    let size = u32(b, i), head = 8;
    if (size === 1) { size = u64(b, i + 8); head = 16; } else if (size === 0) size = to - i;
    if (size < head || i + size > to) break;
    out.push([type(b, i + 4), i + head, i + size]);
    i += size;
  }
  return out;
}
const child = (b: Uint8Array, from: number, to: number, t: string) => kids(b, from, to).find((k) => k[0] === t);

/** MPEG-4 descriptor length (1–4 bytes of 7 bits). */
function descLen(b: Uint8Array, i: number): [number, number] { let n = 0, k = 0; for (; k < 4; k++) { const x = b[i + k]; n = (n << 7) | (x & 0x7f); if (!(x & 0x80)) break; } return [n, i + k + 1]; }

/** The first sound track of an MP4/MOV, from its moov box. Null when there's none we can decode (not AAC, say). */
export function audioTrack(moov: Uint8Array): AudioTrack | null {
  for (const [t, s, e] of kids(moov, 8, moov.length)) {
    if (t !== "trak") continue;
    const mdia = child(moov, s, e, "mdia"); if (!mdia) continue;
    const hdlr = child(moov, mdia[1], mdia[2], "hdlr"); if (!hdlr || type(moov, hdlr[1] + 8) !== "soun") continue;
    const mdhd = child(moov, mdia[1], mdia[2], "mdhd"); if (!mdhd) continue;
    const v1 = moov[mdhd[1]] === 1, timescale = v1 ? u32(moov, mdhd[1] + 20) : u32(moov, mdhd[1] + 12), dur = v1 ? u64(moov, mdhd[1] + 24) : u32(moov, mdhd[1] + 16);
    const minf = child(moov, mdia[1], mdia[2], "minf"); if (!minf) continue;
    const stbl = child(moov, minf[1], minf[2], "stbl"); if (!stbl) continue;
    const box = (n: string) => child(moov, stbl[1], stbl[2], n);
    const stsd = box("stsd"), stts = box("stts"), stsc = box("stsc"), stsz = box("stsz"), stco = box("stco") || box("co64");
    if (!stsd || !stts || !stsc || !stsz || !stco) continue;
    // sample description: mp4a with an esds holding the AudioSpecificConfig
    const entry = stsd[1] + 8; if (type(moov, entry + 4) !== "mp4a") return null;
    const entryEnd = entry + u32(moov, entry);
    const channels = (moov[entry + 24] << 8) | moov[entry + 25], sampleRate = u32(moov, entry + 32) >>> 16;
    let esds: [string, number, number] | undefined, base = entry + 36;
    if (((moov[entry + 16] << 8) | moov[entry + 17]) === 1) base += 16; // QuickTime sound description version 1
    else if (((moov[entry + 16] << 8) | moov[entry + 17]) === 2) base += 36;
    esds = child(moov, base, entryEnd, "esds") || kids(moov, base, entryEnd).flatMap(([kt, ks, ke]) => (kt === "wave" ? kids(moov, ks, ke) : [])).find((k) => k[0] === "esds");
    if (!esds) return null;
    let i = esds[1] + 4, config: Uint8Array | null = null, oti = 0x40;
    if (moov[i] !== 0x03) return null;
    let [, j] = descLen(moov, i + 1); j += 3; // ES_ID, flags
    if (moov[j] !== 0x04) return null;
    [, j] = descLen(moov, j + 1); oti = moov[j]; j += 13;
    if (moov[j] === 0x05) { const [n, k] = descLen(moov, j + 1); config = moov.slice(k, k + n); }
    if (oti !== 0x40 && oti !== 0x67 && oti !== 0x66) return null; // AAC only
    if (!config || config.length < 2) return null;
    let aot = config[0] >> 3; if (aot === 31) aot = 32 + (((config[0] & 7) << 3) | (config[1] >> 5));
    // sample sizes
    const fixed = u32(moov, stsz[1] + 4), count = u32(moov, stsz[1] + 8);
    const sizes = new Uint32Array(count);
    for (let k = 0; k < count; k++) sizes[k] = fixed || u32(moov, stsz[1] + 12 + 4 * k);
    // chunk offsets
    const co64 = moov[stco[1] - 4 + 0] !== undefined && type(moov, stco[1] - 4) === "co64", nChunks = u32(moov, stco[1] + 4);
    const chunkAt = (k: number) => (co64 ? u64(moov, stco[1] + 8 + 8 * k) : u32(moov, stco[1] + 8 + 4 * k));
    // samples per chunk
    const nStsc = u32(moov, stsc[1] + 4), runs: [number, number][] = [];
    for (let k = 0; k < nStsc; k++) runs.push([u32(moov, stsc[1] + 8 + 12 * k), u32(moov, stsc[1] + 12 + 12 * k)]);
    const offsets = new Float64Array(count);
    for (let c = 0, sIdx = 0, r = 0; c < nChunks && sIdx < count; c++) {
      while (r + 1 < runs.length && runs[r + 1][0] <= c + 1) r++;
      let off = chunkAt(c);
      for (let n = 0; n < runs[r][1] && sIdx < count; n++, sIdx++) { offsets[sIdx] = off; off += sizes[sIdx]; }
    }
    // sample times
    const times = new Float64Array(count), nStts = u32(moov, stts[1] + 4);
    for (let k = 0, sIdx = 0, tt = 0; k < nStts; k++) {
      const n = u32(moov, stts[1] + 8 + 8 * k), d = u32(moov, stts[1] + 12 + 8 * k);
      for (let q = 0; q < n && sIdx < count; q++, sIdx++) { times[sIdx] = tt; tt += d; }
    }
    return { timescale, sampleRate, channels: channels || 2, config, codec: "mp4a." + oti.toString(16) + "." + aot, offsets, sizes, times, duration: dur / timescale };
  }
  return null;
}

/** Can this browser use the fast path? (Chrome, Edge, Firefox 130+ and recent Safari have AudioDecoder.) */
export const canStreamAudio = () => typeof (globalThis as any).AudioDecoder === "function" && typeof (globalThis as any).EncodedAudioChunk === "function";

/** Decode the film's sound in slices and hand mono samples (about 16 kHz) to `onSamples`. Resolves with the
 * output sample rate and duration. Throws if the file isn't an MP4/MOV with AAC sound, or the browser can't decode. */
export async function streamAudio(file: Blob, onSamples: (mono: Float32Array, sampleRate: number) => void, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<{ sampleRate: number; duration: number }> {
  const read: Reader = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
  const head = await read(0, 12);
  if (type(head, 4) !== "ftyp") throw new Error("not mp4");
  const moov = await readMoov(read, file.size); if (!moov) throw new Error("no index");
  const tr = audioTrack(moov); if (!tr || !tr.sizes.length) throw new Error("no AAC sound");
  const AD: any = (globalThis as any).AudioDecoder, EAC: any = (globalThis as any).EncodedAudioChunk;
  const cfg = { codec: tr.codec, sampleRate: tr.sampleRate, numberOfChannels: tr.channels, description: tr.config };
  const sup = await AD.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error("decoder");
  const step = Math.max(1, Math.round(tr.sampleRate / 16000)), outRate = tr.sampleRate / step;
  let failed: any = null, carry = new Float32Array(0);
  const dec = new AD({
    output: (d: any) => {
      try {
        const n = d.numberOfFrames, ch = d.numberOfChannels, mono = new Float32Array(n), tmp = new Float32Array(n);
        for (let c = 0; c < ch; c++) { d.copyTo(tmp, { planeIndex: c, format: "f32-planar" }); for (let i = 0; i < n; i++) mono[i] += tmp[i] / ch; }
        d.close();
        // average `step` samples into one: a gentle low-pass that keeps the 2–4 kHz whistle band
        const all = carry.length ? (() => { const x = new Float32Array(carry.length + n); x.set(carry); x.set(mono, carry.length); return x; })() : mono;
        const m = Math.floor(all.length / step), out = new Float32Array(m);
        for (let i = 0, k = 0; i < m; i++) { let s = 0; for (let q = 0; q < step; q++) s += all[k++]; out[i] = s / step; }
        carry = all.slice(m * step);
        onSamples(out, outRate);
      } catch (e) { failed = e; }
    },
    error: (e: any) => { failed = e; },
  });
  dec.configure(cfg);
  const WINDOW = 24 * 1024 * 1024, n = tr.sizes.length;
  // samples are in file order: read a big slice, send every sample inside it, move on
  for (let i = 0; i < n; ) {
    if (signal?.aborted) { try { dec.close(); } catch { /* closed */ } throw new DOMException("stopped", "AbortError"); }
    if (failed) throw failed;
    const start = tr.offsets[i]; let j = i;
    while (j < n && tr.offsets[j] + tr.sizes[j] - start <= WINDOW) j++;
    if (j === i) j = i + 1; // one huge sample
    const buf = await read(start, tr.offsets[j - 1] + tr.sizes[j - 1]);
    for (let k = i; k < j; k++) {
      const a = tr.offsets[k] - start;
      dec.decode(new EAC({ type: "key", timestamp: Math.round((tr.times[k] / tr.timescale) * 1e6), data: buf.subarray(a, a + tr.sizes[k]) }));
    }
    i = j;
    while (dec.decodeQueueSize > 400) await new Promise((r) => setTimeout(r, 5)); // keep memory flat
    onProgress?.(i / n);
  }
  await dec.flush(); dec.close();
  if (failed) throw failed;
  return { sampleRate: outRate, duration: tr.duration };
}
