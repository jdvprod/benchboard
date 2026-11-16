import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, matchQuery } from "../src/film/query";
import { framesOf, findWhistles, ralliesFrom } from "../src/film/rallies";
import { replay, MatchEvent } from "../src/sports/volleyball/engine";
import { filmTiming, videoTime } from "../src/film/clips";

const roster = [{ id: "p1", first: "Maya", last: "Lopez", num: "12" }, { id: "p2", first: "Ava", last: "Chen", num: "7" }];

test("clip search understands plays, players, areas, sets and rotations", () => {
  let r = parseQuery("all solo blocks", roster); assert.deepEqual(r.q.codes, ["BS"]);
  r = parseQuery("blocking reps", roster); assert.deepEqual(r.q.codes!.sort(), ["BA", "BE", "BS", "BT"]);
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

test("clip search: block touches are their own play", () => {
  assert.deepEqual(parseQuery("all block touches").q.codes, ["BT"]);
  assert.ok(parseQuery("blocks").q.codes!.includes("BT"));
});

/* ---------- big moments ---------- */
import { bestOf, hypeScores, loudMoments, withHype, Frame as F2 } from "../src/film/rallies";
/** Frames every 32 ms with a quiet floor and loud bursts at the given times (seconds, length 2 s). */
const crowd = (secs: number, bursts: [number, number][]): F2[] => { const out: F2[] = []; for (let t = 0; t < secs; t += 0.032) { const b = bursts.find(([at]) => t >= at && t < at + 2); out.push({ t, peak: 0, band: 0, level: 0, loud: b ? b[1] : 1 + ((t * 7) % 1) * 0.2 }); } return out; };

test("big moments: the rally the crowd went wild for ranks first", () => {
  const rallies = [{ start: 10, end: 18 }, { start: 30, end: 36 }, { start: 50, end: 70 }, { start: 90, end: 95 }];
  const fr = crowd(120, [[37, 30], [71, 6], [96, 2]]); // huge cheer after rally 2, medium after the long rally 3
  const h = hypeScores(fr, rallies);
  assert.equal(h.indexOf(Math.max(...h)), 1, "the cheer wins");
  assert.ok(h[2] > h[0] && h[2] > h[3], "a long rally with a cheer beats a short quiet one");
  assert.ok(h.every((x) => x >= 0 && x <= 1));
  const best = bestOf(withHype(fr, rallies), 2);
  assert.deepEqual(best.map((r) => r.start), [30, 50], "best two, in film order");
  assert.deepEqual(hypeScores(fr, []), []);
});

test("big moments: with no whistles, loud bursts become clips leading up to them", () => {
  const fr = crowd(300, [[40, 12], [41.5, 12], [150, 20], [240, 5], [260, 1.1]]);
  const ms = loudMoments(fr, { duration: 300 });
  assert.equal(ms.length, 3, "two bursts 1.5 s apart are one moment; a burst at the usual level isn't a moment");
  assert.ok(ms[0].start < 41 && ms[0].start >= 30 && ms[0].end > 41, "the clip leads up to the cheer");
  assert.equal(Math.max(...ms.map((m) => m.h!)), ms[1].h, "the loudest is rated highest");
  assert.deepEqual(loudMoments(crowd(5, [])), []);
});

/* ---------- season search ---------- */
import { inScope, parseScope, searchSeason } from "../src/film/library";
test("season search: reads which matches from the words, leaves the plays", () => {
  const opps = ["Buchanan", "Clovis West", "Bu"];
  let r = parseScope("Maya's kills vs Buchanan", opps, "2026-11-15");
  assert.deepEqual(r.scope.opps, ["Buchanan"]); assert.equal(r.rest, "Maya's kills");
  r = parseScope("aces in the last 3 matches against clovis west", opps, "2026-11-15");
  assert.deepEqual(r.scope.opps, ["Clovis West"]); assert.equal(r.scope.last, 3); assert.equal(r.rest, "aces");
  r = parseScope("shanks last match", opps, "2026-11-15"); assert.equal(r.scope.last, 1); assert.equal(r.rest, "shanks");
  r = parseScope("blocks vs Buchanan Hills in set 2", ["Clovis West"], "2026-11-15"); assert.deepEqual(r.scope.opps, ["Buchanan Hills"]); assert.equal(r.rest, "blocks in set 2");
  assert.deepEqual(inScope([{ date: "2026-10-01", opp: "Clovis West" }], r.scope), [], "an opponent never played finds nothing");
  assert.equal(inScope([{ date: "2026-10-01", opp: "Clovis West" }], parseScope("vs clovis", [], "2026-11-15").scope).length, 1, "part of a name is enough");
  r = parseScope("blocks this month", opps, "2026-11-15"); assert.equal(r.scope.since, "2026-10-15");
  r = parseScope("all solo blocks this season", opps, "2026-11-15"); assert.equal(r.rest, "all solo blocks"); assert.equal(r.scope.opps.length, 0, "a two-letter name never matches inside words");
  const ms = [{ date: "2026-10-01", opp: "Buchanan" }, { date: "2026-11-10", opp: "Clovis West" }, { date: "2026-11-01", opp: "Buchanan" }];
  assert.deepEqual(inScope(ms, parseScope("last 2 matches", opps, "2026-11-15").scope).map((m) => m.date), ["2026-11-10", "2026-11-01"]);
  assert.deepEqual(inScope(ms, parseScope("vs buchanan", opps, "2026-11-15").scope).map((m) => m.date), ["2026-11-01", "2026-10-01"]);
});
test("season search: groups matching plays by match, newest first", () => {
  let ts = 1; const e = (x: any) => ({ id: "x" + ts, ts: ts++, ...x }) as MatchEvent;
  const a = replay([e({ t: "NS", serve: "us" }), e({ t: "SA", p: "p1" }), e({ t: "SA", p: "p2" })]), b = replay([e({ t: "NS", serve: "us" }), e({ t: "K", p: "p1" })]);
  const ms = [{ id: "a", date: "2026-10-01", opp: "Buchanan", log: a.log }, { id: "b", date: "2026-11-01", opp: "Clovis", log: b.log }];
  const g = searchSeason(ms, parseQuery("Maya", roster).q, parseScope("", [], "2026-11-15").scope);
  assert.deepEqual(g.map((x) => [x.m.id, x.rows.length]), [["b", 1], ["a", 1]]);
  assert.equal(searchSeason(ms, parseQuery("aces", roster).q, parseScope("", [], "2026-11-15").scope)[0].rows.length, 2);
});

/* ---------- film breakdown ---------- */
import { breakdown, cleanReview } from "../src/film/breakdown";
test("breakdown: finds the leaks, their best hitter, a run and what to keep doing, each as clips", () => {
  let ts = 1; const e = (x: any) => ({ id: "b" + ts, ts: ts++, ...x }) as MatchEvent;
  const evs: MatchEvent[] = [e({ t: "NS", serve: "us", lu: ["p1", "p2", "a", "b", "c", "d"] })];
  for (let i = 0; i < 3; i++) evs.push(e({ t: "SEN", p: "p2" }));          // 3 serve errors by Ava
  for (let i = 0; i < 2; i++) evs.push(e({ t: "OK", op: "7" }));
  evs.push(e({ t: "OK", op: "7" }), e({ t: "OK", op: "9" }));                  // their #7: 3 kills; run of 7 against us so far
  for (let i = 0; i < 4; i++) evs.push(e({ t: "K", p: "p1" }));               // Maya 4 kills
  evs.push(e({ t: "P0", p: "p1" }), e({ t: "OA", op: "3" }), e({ t: "P0", p: "p2" }));
  const R = replay(evs), name = (id: string) => ({ p1: "#12 Maya", p2: "#7 Ava" } as any)[id] || id;
  const fs = breakdown(R.log, name), byId = Object.fromEntries(fs.map((f) => [f.id, f]));
  assert.ok(byId["err-serve"], "serve errors"); assert.match(byId["err-serve"].why, /#7 Ava had 3/);
  assert.ok(byId["receive"]); assert.equal(byId["receive"].n, 3);
  assert.ok(byId["their-7"]); assert.match(byId["their-7"].title, /Their #7: 3 kills/);
  assert.ok(byId["run"]); assert.match(byId["run"].title, /7 in a row in set 1/); assert.equal(byId["run"].q.ids!.length, 7);
  assert.ok(byId["star-p1"]); assert.match(byId["star-p1"].title, /#12 Maya scored 4/);
  assert.deepEqual(fs.map((f) => f.tone), fs.map((f) => f.tone).slice().sort((a, b) => ["fix", "scout", "keep"].indexOf(a) - ["fix", "scout", "keep"].indexOf(b)), "fixes first, then scouting, then keep doing");
  // every finding's search finds exactly its plays
  for (const f of fs) assert.equal(R.log.filter((l) => matchQuery(f.q, l)).length, f.n, f.id);
  assert.deepEqual(breakdown(replay([e({ t: "NS", serve: "us" })]).log, name), [], "nothing to say before any points");
  const c = cleanReview({ summary: " Tough night. ", notes: { "err-serve": "Toss.", bogus: "x", run: 5 } }, fs);
  assert.deepEqual(c, { summary: "Tough night.", notes: { "err-serve": "Toss." } });
});

/* ---------- ask the film, scouting ---------- */
import { askPrompt, cleanAsk, filmDigest } from "../src/film/askFilm";
import { scoutHitters } from "../src/film/library";
test("ask the film: a compact play list in, only real plays out", () => {
  let ts = 1; const e = (x: any) => ({ id: "q" + ts, ts: ts++, ...x }) as MatchEvent;
  const R = replay([e({ t: "NS", serve: "us", lu: ["p1", "p2", "a", "b", "c", "d"] }), e({ t: "K", p: "p1" }), e({ t: "OK", op: "7" }), e({ t: "D", p: "p2" })]);
  const d = filmDigest(R.log, (id) => (id === "p1" ? "#12 Maya" : "#7 Ava"), (c) => ({ K: "Kill", OK: "Their kill", D: "Dig" } as any)[c] || c);
  assert.equal(d.length, 3);
  assert.match(d[0], /^q2 \| S1 \| 1-0 \(our point\) \| #12 Maya \| Kill/);
  assert.match(d[1], /their #7 \| Their kill/);
  assert.match(askPrompt("why did we lose?", "Central", "1-2", d), /Coach's question: "why did we lose\?"/);
  const c = cleanAsk({ answer: " Their #7. ", plays: ["q3", "nope", "q3", 5] }, R.log);
  assert.deepEqual(c, { answer: "Their #7.", plays: ["q3"] });
  assert.deepEqual(cleanAsk(null, R.log), { answer: "", plays: [] });
});
test("scouting: their hitters across matches, with where the kills land", () => {
  let ts = 1; const e = (x: any) => ({ id: "s" + ts, ts: ts++, ...x }) as MatchEvent;
  const a = replay([e({ t: "NS", serve: "us" }), e({ t: "OK", op: "7" }), e({ t: "OK", op: "7" }), e({ t: "OA", op: "3" })]).log;
  const b = replay([e({ t: "NS", serve: "us" }), e({ t: "OK", op: "7" }), e({ t: "OK", op: "11" })]).log;
  const h = scoutHitters([a, b]);
  assert.deepEqual(h.map((x) => [x.num, x.kills, x.aces, x.matches]), [["7", 3, 0, 2], ["3", 0, 1, 1], ["11", 1, 0, 1]]);
});

test("film to practice: each finding brings the drill that answers it", async () => {
  const { blockFor, blocksFor } = await import("../src/film/breakdown");
  const drills = [
    { id: "d1", name: "Serve to zones", category: "Serving", minutes: 10, description: "Call a zone." },
    { id: "d2", name: "Serve under pressure", category: "Serving", minutes: 8, description: "Miss and the team runs." },
    { id: "d3", name: "Three-person serve receive", category: "Serve receive", minutes: 15, description: "Grade every pass." },
    { id: "d4", name: "Wash drill (6 v 6)", category: "Game play", minutes: 20, description: "Two in a row." },
    { id: "d5", name: "Rotation scrimmage", category: "Game play", minutes: 20, description: "Play out a weak rotation." },
  ];
  let n = 0; const uid = () => "b" + ++n;
  const F = (id: string, tone: any = "fix", title = "T") => ({ id, tone, title, why: "", q: { codes: null, players: [], opp: [], zones: [], sets: [], rots: [] }, n: 1, note: "", cost: 1 });
  assert.equal(blockFor(F("err-serve"), drills, "Central", uid)!.title, "Serve under pressure", "serve errors bring the pressure drill");
  const rot = blockFor(F("rot-3"), drills, "Central", uid)!;
  assert.equal(rot.title, "Rotation scrimmage"); assert.match(rot.notes, /^From film vs Central: T\. Start every rally in rotation 3\./);
  assert.equal(blockFor(F("late"), drills, "Central", uid)!.title, "Wash drill (6 v 6)");
  assert.equal(blockFor(F("star-p1", "keep"), drills, "Central", uid), null, "keep doing needs no drill");
  assert.equal(blockFor(F("err-net"), drills, "Central", uid), null, "no blocking drill in the library");
  const all = blocksFor([F("err-serve"), F("receive"), F("run"), F("late"), F("rot-2")], drills, "Central", uid, ["d3"]);
  assert.deepEqual(all.map((b) => b.drillId), ["d2", "d4", "d5"], "one block per drill, skipping what the plan has");
});

test("film sessions tag each clip with the player who made the play", async () => {
  const { itemFrom } = await import("../src/film/session");
  const c = { id: "m:1", matchId: "m", url: "x.mp4", start: 1, end: 3, label: "#7 Maya · Kill", t: "K", p: "p1", date: "2026-11-01", opp: "C" };
  assert.deepEqual(itemFrom(c).who, ["p1"]);
  assert.equal(itemFrom({ ...c, p: undefined }).who, undefined);
});
test("season best: the top rallies across matches, a few per match, in date order", async () => {
  const { seasonBest } = await import("../src/film/library");
  const R = (h: number, start: number) => ({ start, end: start + 5, h });
  const ms = [{ id: "a", date: "2026-10-01", rallies: [R(1, 10), R(0.9, 20), R(0.8, 30), R(0.7, 40), R(0.95, 50)] }, { id: "b", date: "2026-09-01", rallies: [R(0.85, 5), { start: 9, end: 12 }] }, { id: "c", date: "2026-11-01", moments: [R(0.99, 60)] }];
  const b = seasonBest(ms, 5, 3);
  assert.deepEqual(b.map((x) => x.m.id + "@" + x.r.start), ["b@5", "a@10", "a@20", "a@50", "c@60"]);
});
