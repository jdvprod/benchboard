import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audioTrack, readMoov } from "../src/film/mp4audio";
import { Framer, framesOf } from "../src/film/rallies";

for (const kind of ["mp4", "mov"]) test(`long films: the sound track's index is read from a ${kind}`, async () => {
  const file = new Uint8Array(readFileSync(`tests/fixtures/tiny.${kind}`));
  const moov = await readMoov(async (a, b) => file.slice(a, b), file.length);
  assert.ok(moov, "found the index");
  const tr = audioTrack(moov!)!;
  assert.ok(tr, "found the sound track");
  assert.equal(tr.codec, "mp4a.40.2");
  assert.equal(tr.sampleRate, 44100);
  assert.equal(tr.channels, 2);
  // every AAC frame where ffprobe says it is (fixture made with ffmpeg; .packets is ffprobe's size,pos list)
  const want = readFileSync(`tests/fixtures/tiny.${kind}.packets`, "utf8").trim().split("\n").map((l) => l.split(",").slice(0, 2).map(Number));
  assert.equal(tr.sizes.length, want.length);
  want.forEach(([size, pos], i) => { assert.equal(tr.sizes[i], size, "size " + i); assert.equal(tr.offsets[i], pos, "offset " + i); });
  assert.ok(Math.abs(tr.duration - 6) < 0.1, String(tr.duration));
  for (let i = 1; i < tr.times.length; i++) assert.ok(tr.times[i] > tr.times[i - 1]);
});

test("long films: frames fed in slices match frames from the whole sound", () => {
  const sr = 16000, x = new Float32Array(sr * 3);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.37) * 0.3 + (i > sr && i < sr * 1.4 ? Math.sin((2 * Math.PI * 3100 * i) / sr) * 0.6 : 0);
  const whole = framesOf(x, sr), f = new Framer(sr);
  for (let i = 0; i < x.length; i += 1777) f.push(x.subarray(i, i + 1777));
  assert.equal(f.frames.length, whole.length);
  f.frames.forEach((fr, i) => { assert.ok(Math.abs(fr.t - whole[i].t) < 1e-9); assert.ok(Math.abs(fr.band - whole[i].band) < 1e-6); });
});
