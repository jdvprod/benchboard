import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, matchQuery } from "../src/film/query";
import { framesOf, findWhistles, ralliesFrom } from "../src/film/rallies";
import { replay, MatchEvent } from "../src/sports/volleyball/engine";
import { filmTiming, videoTime } from "../src/film/clips";

const roster = [{ id: "p1", first: "Maya", last: "Lopez", num: "12" }, { id: "p2", first: "Ava", last: "Chen", num: "7" }];

test("clip search understands plays, players, areas, sets and rotations", () => {
  let r = parseQuery("all solo blocks", roster); assert.deepEqual(r.q.codes, ["BS"]);
  r = parseQuery("blocking reps", roster); assert.deepEqual(r.q.codes!.sort(), ["BA", "BE", "BS"]);
  r = parseQuery("kills to area 1", roster); assert.deepEqual(r.q.codes, ["K", "KT"]); assert.deepEqual(r.q.zones, [1]);
  r = parseQuery("Maya's digs in set 2", roster); assert.deepEqual(r.q.codes, ["D"]); assert.deepEqual(r.q.players, ["p1"]); assert.deepEqual(r.q.sets, [2]);
  r = parseQuery("#7 aces in rotation 3", roster); assert.deepEqual(r.q.codes, ["SA"]); assert.deepEqual(r.q.players, ["p2"]); assert.deepEqual(r.q.rots, [3]);
  r = parseQuery("their kills from #7", roster); assert.deepEqual(r.q.codes, ["OK"]); assert.deepEqual(r.q.opp, ["7"]); assert.deepEqual(r.q.players, []);
  r = parseQuery("kills off perfect passes", roster); assert.deepEqual(r.q.ctx, ["P3"]);
  r = parseQuery("second set shanks", roster); assert.deepEqual(r.q.codes, ["P0"]); assert.deepEqual(r.q.sets, [2]);
  r = parseQuery("kills off the block", roster); assert.deepEqual(r.q.codes, ["KT"]);
  r = parseQuery("serve errors in clutch", roster); assert.deepEqual(r.q.codes!.sort(), ["SE", "SEN", "SEO"]); assert.equal(r.q.clutch, true);
  r = parseQuery("hitting errors when receiving", roster); assert.deepEqual(r.q.codes, ["AE", "AB"]); assert.equal(r.q.serving, "them");
  assert.equal(parseQuery("purple monkey", roster).empty, true);
});

test("clip search filters the match log with rotation, zone and context", () => {
  let ts = 1000; const e = (x: any) => ({ id: "e" + ts, ts: ts++, ...x }) as MatchEvent;
  const evs = [e({ t: "NS", serve: "them", lu: ["p1", "p2", "a", "b", "c", "d"] }), e({ t: "P3", p: "p2" }), e({ t: "K", p: "p1", x: 1, y: 2 }), e({ t: "SA", p: "p2" }), e({ t: "SEN", p: "p1" }), e({ t: "BS", p: "p2" })];
  const R = replay(evs);
  const run = (s: string) => R.log.filter((l) => matchQuery(parseQuery(s, roster).q, l)).length;
  assert.equal(run("kills to area 1"), 1);
  assert.equal(run("kills to area 5"), 0);
  assert.equal(run("kills off perfect passes"), 1);
  assert.equal(run("kills when receiving"), 1);
  assert.equal(run("Ava's aces in rotation 2"), 1);
  assert.equal(run("solo blocks"), 1);
  assert.equal(run("Maya"), 2);
});

test("film-statted plays keep their exact video time", () => {
  const evs = [{ id: "a", ts: 5000, t: "NS", serve: "us", vt: 61.5 }, { id: "b", ts: 9000, t: "K", vt: 75.25 }] as MatchEvent[];
  const T = filmTiming({ videoOffset: 30 }, replay(evs), evs);
  assert.equal(videoTime(T, "b"), 75.25);
});

test("whistles are found in game sound and paired into rallies", () => {
  const sr = 16000, dur = 40, s = new Float32Array(sr * dur);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < s.length; i++) s[i] = rnd() * 0.05; // gym noise
  const tone = (at: number, len: number, f: number) => { for (let i = Math.floor(at * sr); i < (at + len) * sr; i++) s[i] += 0.4 * Math.sin((2 * Math.PI * f * i) / sr); };
  const squeak = (at: number) => { for (let i = Math.floor(at * sr); i < (at + 0.05) * sr; i++) s[i] += 0.4 * Math.sin((2 * Math.PI * 2800 * i) / sr); };
  tone(3, 0.5, 3150); tone(12, 0.6, 3300); squeak(15); tone(25, 0.5, 3150); tone(33.5, 0.7, 2900);
  for (let i = Math.floor(18 * sr); i < 20 * sr; i++) s[i] += rnd() * 0.5; // cheering
  const w = findWhistles(framesOf(s, sr));
  assert.equal(w.length, 4, "whistles: " + w.join(", "));
  assert.ok(Math.abs(w[0] - 3) < 0.1 && Math.abs(w[3] - 33.5) < 0.1);
  const r = ralliesFrom(w, dur);
  assert.equal(r.length, 2); assert.ok(r[0].start < 3 && r[0].end > 12);
});

import { writeEmail, emailGaps } from "../src/recruit/emails";
import { pickReel } from "../src/recruit/Guide";
test("coach emails: personal, short, with links and no empty lines doubled", () => {
  const a = { first: "Maya", last: "Chen", grad: "2028", pos: "Outside hitter", height: "5'11\"", club: "Sierra 17 Elite", clubNum: "7", gpa: "3.8", video: "https://youtu.be/x", email: "maya@example.com" };
  const e = writeEmail("intro", a, { coach: "Coach Rivera", school: "Fresno State", why: "I love your fast offense." , events: "Vegas Classic · Apr 11–13\nNorCal Qualifier · Mar 2" });
  assert.match(e.subject, /Maya Chen \(2028, Outside hitter\)/);
  assert.match(e.body, /^Dear Coach Rivera,/);
  assert.match(e.body, /because I love your fast offense\./);
  assert.match(e.body, /• Vegas Classic/);
  assert.match(e.body, /Highlight video: https:\/\/youtu\.be\/x/);
  assert.ok(!/\n\n\n/.test(e.body));
  assert.deepEqual(emailGaps("intro", a, { coach: "x", school: "y", why: "z" }), []);
  assert.ok(emailGaps("schedule", a, { coach: "x", school: "y" }).some((g) => /schedule/.test(g)));
  const s = writeEmail("schedule", a, { events: "Vegas Classic · Apr 11–13" });
  assert.match(s.body, /I'm wearing #7 for Sierra 17 Elite/);
});
test("reel studio: best-of puts starred and strongest plays first and stays under the limit", () => {
  const m = (id: string, cat: any, len: number, star = false) => ({ id, film: "f", at: 0, start: 0, end: len, cat, star });
  const marks = [m("a", "SI", 8), m("b", "D", 8), m("c", "K", 8), m("d", "TAG", 8, true), m("e", "BS", 8)];
  assert.deepEqual(pickReel(marks as any, null, 100).map((x) => x.id), ["d", "c", "e", "b", "a"]);
  assert.deepEqual(pickReel(marks as any, null, 24).map((x) => x.id), ["d", "c", "e"]);
  assert.deepEqual(pickReel(marks as any, ["K"]).map((x) => x.id), ["c"]);
});

import { rallyCheck, crossedEnd } from "../src/film/rallies";
test("rally check: finds rallies with no point statted, counting plays entered just after the whistle", () => {
  const rs = [{ start: 2, end: 14 }, { start: 24, end: 35 }, { start: 50, end: 60 }];
  const c = rallyCheck(rs, [{ t: 9, point: true }, { t: 30, point: false }, { t: 62, point: true }]);
  assert.deepEqual(c.scored, [true, false, true]); assert.deepEqual(c.missing, [1]);
  assert.equal(crossedEnd(rs, 13.8, 14.1), 0);
  assert.equal(crossedEnd(rs, 5, 30), -1); // a seek
  assert.equal(crossedEnd(rs, 20, 20.2), -1);
});
