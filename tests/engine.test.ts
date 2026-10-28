import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, mergeLogs, MatchEvent, replay, rotateLineup, serverOf, zoneOf } from "../src/sports/volleyball/engine";
import { hitting, passAvg, perfectPassPct, playerMetrics, serveEfficiency, teamMetrics } from "../src/sports/volleyball/metrics";
import { tendencies } from "../src/sports/volleyball/tendencies";
import { sampleMatch } from "../src/sports/volleyball/sample";
import { flags } from "../src/sports/volleyball/flags";

let n = 0;
const ev = (t: string, extra: object = {}): MatchEvent => ({ id: "e" + n++, ts: 1000 + n, t, ...extra } as any);
const LU = ["s", "oh1", "mb1", "opp", "oh2", "mb2"];

test("scores rallies, side-outs rotate our lineup", () => {
  const R = replay([ev("NS", { serve: "them", lu: LU, lib: "lib" }), ev("K", { p: "oh1" }), ev("SA", { p: "oh1" }), ev("OK")]);
  const c = R.cur!;
  assert.equal(c.us, 2); assert.equal(c.them, 1);
  assert.equal(c.rot, 2, "side-out moves to rotation 2");
  assert.deepEqual(c.lu, rotateLineup(LU, 1));
  assert.equal(c.serve, "them");
});

test("two block assists on one rally count as one point", () => {
  const R = replay([ev("NS", { serve: "us" }), ev("BA", { p: "mb1" }), ev("BA", { p: "opp" })]);
  assert.equal(R.cur!.us, 1);
  assert.equal(R.cur!.ps.mb1.BA, 1); assert.equal(R.cur!.ps.opp.BA, 1);
});

test("deleted events disappear from every device's log", () => {
  const a = ev("NS", { serve: "us" }), b = ev("K", { p: "x" }), c = ev("DEL", { ref: b.id });
  const merged = mergeLogs([[a, b], [c]]);
  assert.equal(merged.length, 1);
  assert.equal(replay(merged).cur!.us, 0);
});

test("libero serving for a player takes the serve stats", () => {
  const R = replay([ev("NS", { serve: "us", lu: LU, lib: "lib", libSrv: "s" })]);
  assert.equal(serverOf(R.cur), "lib");
});

test("score correction sets the score without touching stats", () => {
  const R = replay([ev("NS", { serve: "us" }), ev("K", { p: "a" }), ev("ADJ", { us: 5, them: 3 })]);
  assert.equal(R.cur!.us, 5); assert.equal(R.cur!.them, 3); assert.equal(R.cur!.ps.a.K, 1);
});

test("scrimmage credits the right team", () => {
  const scrim = { a: { name: "Blue", ids: ["a1"] }, b: { name: "White", ids: ["b1"] }, to: 25 };
  const R = replay([ev("NS", { serve: "us" }), ev("K", { p: "a1", s: "a" }), ev("K", { p: "b1", s: "b" }), ev("SEN", { p: "b1", s: "b" })], { scrim });
  assert.equal(R.cur!.us, 2); assert.equal(R.cur!.them, 1);
  assert.equal(R.cur!.side.b.K, 1);
});

test("set and match end rules: 25 win by 2, fifth set to 15", () => {
  const evs: MatchEvent[] = [ev("NS", { serve: "us" })];
  for (let i = 0; i < 25; i++) evs.push(ev("UP"));
  const R = replay(evs, { bestOf: 5 });
  assert.equal(R.sets[0].over, true); assert.equal(R.wonUs, 1);
  const five: MatchEvent[] = [];
  for (let s = 0; s < 5; s++) { five.push(ev("NS", { serve: "us" })); for (let i = 0; i < (s === 4 ? 15 : 25); i++) five.push(ev(s % 2 ? "TP" : "UP")); }
  const R5 = replay(five, { bestOf: 5 });
  assert.equal(R5.sets[4].target, 15); assert.equal(R5.matchOver, true); assert.equal(R5.wonUs, 3);
});

test("zones map both halves of the court", () => {
  assert.equal(zoneOf(1, 1), 1); assert.equal(zoneOf(8, 7), 4); assert.equal(zoneOf(1, 17), 5); assert.equal(zoneOf(8, 10), 2); assert.equal(zoneOf(-1, 5), "out");
});

test("advanced metrics", () => {
  const R = replay([
    ev("NS", { serve: "them", lu: LU }),
    ev("P3", { p: "oh1" }), ev("K", { p: "oh1" }), // side-out on a 3 pass, first-ball kill
    ev("SA", { p: "oh1" }), ev("SEN", { p: "oh2" }),
    ev("P1", { p: "oh2" }), ev("AE", { p: "opp" }),
  ]);
  const A = aggregate(R.sets), M = teamMetrics(A);
  assert.equal(M.soByPass.P3, 1); assert.equal(M.soByPass.P1, 0);
  assert.equal(M.firstBallSO, 0.5);
  assert.equal(passAvg(A.T), 2); assert.equal(perfectPassPct(A.T), 0.5);
  assert.equal(hitting(A.T), 0);
  assert.equal(serveEfficiency(A.T), 0);
  const pm = playerMetrics(A, "oh1");
  assert.equal(pm.plusMinus, 2 - 2, "oh1 on court for 2 won and 2 lost rallies");
  assert.equal(pm.netPoints, 2);
});

test("sample match replays cleanly and points add up", () => {
  const R = replay(sampleMatch(7, 0, { sets: 3, finished: true }), { bestOf: 5 });
  for (const s of R.sets) assert.equal(s.us + s.them, s.rallies.length);
  const A = aggregate(R.sets);
  assert.ok(A.T.K > 10); assert.ok(A.locs.length > 20);
  const t = tendencies(A.locs, "theirAttack");
  assert.ok(t.total > 0); assert.ok(t.recs.length > 0);
  const f = flags(R, { us: "Us", them: "Them", subLimit: 15, playerIds: Object.keys(A.ps), short: (id) => id });
  assert.ok(Array.isArray(f));
});

import { defaultFormations, overlapFaults } from "../src/sports/volleyball/formations";
test("default formations are legal at the serve", () => {
  const f = defaultFormations();
  for (let r = 0; r < 6; r++) { assert.equal(overlapFaults(f.receive[r], "receive").length, 0); assert.equal(overlapFaults(f.serve[r], "serve").length, 0); }
});
test("overlap check flags front/back and left/right faults, server exempt", () => {
  const s = defaultFormations().receive[0];
  s["5"] = [1.5, 10]; // left back in front of left front
  assert.ok(overlapFaults(s, "receive").some((x) => x.a === "4" && x.b === "5"));
  const v = defaultFormations().serve[0];
  v["1"] = [0.5, 18.9]; // server anywhere behind the line is fine
  assert.equal(overlapFaults(v, "serve").length, 0);
  const w = defaultFormations().receive[0];
  w["3"] = [8, 11.2]; // middle front right of right front
  assert.ok(overlapFaults(w, "receive").some((x) => x.a === "3" && x.b === "2"));
});

import { parseQuick } from "../src/sports/volleyball/quickcodes";
test("quick codes parse players, pass grades and their numbers", () => {
  const r = parseQuick("7k 12ace 4p3 ok11 oe, 3D u #9ba zz 7p3x");
  assert.deepEqual(r.items.map((i) => [i.code, i.num ?? "", i.op ?? ""]), [["K", "7", ""], ["SA", "12", ""], ["P3", "4", ""], ["OK", "", "11"], ["OE", "", ""], ["D", "3", ""], ["BA", "9", ""]]);
  assert.equal(r.undo, 1);
  assert.deepEqual(r.errors, ["zz", "7p3x"]);
  assert.equal(parseQuick("k5").errors.length, 1, "a number after a non-opponent code is rejected");
});

test("flags a rotation stuck on their serve and a shaky next server", () => {
  const R0 = replay([ev("NS", { serve: "them", lu: LU }), ev("OK"), ev("OA"), ev("TP")]);
  const f0 = flags(R0, { us: "Us", them: "Them", subLimit: 15, playerIds: LU, short: (id) => id });
  assert.ok(f0.some((f) => /Stuck in rotation 1/.test(f.title)), "3 straight on their serve");
});

test("attacks are split by our rotation for setter distribution", () => {
  const R = replay([ev("NS", { serve: "us", lu: LU }), ev("K", { p: "oh1" }), ev("TA", { p: "mb1" }), ev("AE", { p: "oh1" })]);
  const A = aggregate(R.sets);
  assert.deepEqual(A.atkRot[1].oh1, { K: 1, E: 1, TA: 2 }, "we kept serving, so every attack was in rotation 1");
  assert.equal(A.atkRot[1].mb1.TA, 1);
});

test("serve-receive passes are split by rotation", () => {
  const R = replay([ev("NS", { serve: "them", lu: LU }), ev("P3", { p: "oh1" }), ev("K", { p: "oh1" }), ev("SA", { p: "oh1" }), ev("OK"), ev("P1", { p: "oh2" }), ev("AE", { p: "opp" })]);
  const A = aggregate(R.sets);
  assert.deepEqual(A.rcvRot[1].oh1, { R: 1, RS: 3 });
  assert.deepEqual(A.rcvRot[2].oh2, { R: 1, RS: 1 }, "after siding out we receive in rotation 2");
});

import { situations } from "../src/sports/volleyball/situations";
test("situations: runs, timeouts, score bands and serving runs", () => {
  // We receive; side out (K), then serve 3 straight (oh1 rotates to server spot in R2 => server = LU rotated), they score 1, take TO, we win next
  const R = replay([ev("NS", { serve: "them", lu: LU }), ev("K", { p: "oh1" }), ev("SA", { p: "x" }), ev("SA", { p: "x" }), ev("SA", { p: "x" }), ev("SEN", { p: "x" }), ev("TO", { v: "us" }), ev("K", { p: "oh1" })]);
  const X = situations(R.sets);
  assert.equal(X.rallies, 6);
  assert.equal(X.runs.us.longest, 4);
  assert.equal(X.runs.us.three, 1);
  assert.deepEqual(X.afterTO.us, { w: 1, n: 1 });
  assert.deepEqual(X.bounce.afterOwnError, { w: 1, n: 1 });
  assert.equal(X.phase.early.so.n + X.phase.early.ps.n, 6);
  assert.equal(R.sets[0].rallies[2].us, 2, "score before rally is stored");
  const srv = Object.values(X.serveRuns)[0];
  assert.equal(srv.longest, 3); assert.equal(srv.runs3, 1);
});

test("stats-only entries count for the player but never change the score", () => {
  const R = replay([ev("NS", { serve: "them", lu: LU }), ev("P3", { p: "oh1", ns: true }), ev("K", { p: "oh1", ns: true }), ev("UP"), ev("P0", { p: "oh2", ns: true }), ev("TP")]);
  const c = R.cur!;
  assert.equal(c.us, 1); assert.equal(c.them, 1);
  assert.equal(c.ps.oh1.K, 1); assert.equal(c.ps.oh1.R3, 1); assert.equal(c.ps.oh2.P0, 1);
  assert.equal(c.rallies[0].pass, "P3", "the assistant's pass grade still feeds side-out by pass");
});

import { parseSchedule } from "../src/features/matchup/parseSchedule";
test("schedule paste: common formats", () => {
  const today = new Date(2026, 7, 1);
  const g = parseSchedule([
    "Thu 9/4 vs Buchanan 6:00 PM",
    "9/9/2026 @ Clovis West 5:30pm (League)",
    "Sep 13 - Fresno Invitational - Fresno State",
    "2026-09-20\tat Central\t18:00",
    "October 2, 2026  Bullard  7 PM",
    "9/27 BYE",
    "Practice notes",
  ].join("\n"), today);
  assert.equal(g.length, 5);
  assert.deepEqual([g[0].date, g[0].time, g[0].opp, g[0].site], ["2026-09-04", "18:00", "Buchanan", "home"]);
  assert.deepEqual([g[1].date, g[1].time, g[1].opp, g[1].site, g[1].event], ["2026-09-09", "17:30", "Clovis West", "away", "League"]);
  assert.equal(g[2].opp, "Fresno Invitational"); assert.equal(g[2].event, "Fresno State"); assert.equal(g[2].site, "neutral");
  assert.deepEqual([g[3].date, g[3].opp, g[3].site, g[3].time], ["2026-09-20", "Central", "away", "18:00"]);
  assert.deepEqual([g[4].date, g[4].opp, g[4].time], ["2026-10-02", "Bullard", "19:00"]);
  assert.equal(parseSchedule("1/10 vs Hoover", new Date(2026, 9, 22))[0].date, "2027-01-10", "a January date in October is next year");
});

test("tool counts as a kill, blocked counts as an attack error", () => {
  const R = replay([ev("NS", { serve: "us", lu: LU }), ev("KT", { p: "oh1" }), ev("AB", { p: "oh1" })]);
  const s = R.cur!.ps.oh1;
  assert.equal(R.cur!.us, 1); assert.equal(R.cur!.them, 1);
  assert.deepEqual([s.K, s.KT, s.AE, s.AB, s.TA], [1, 1, 1, 1, 2]);
  assert.equal(hitting(s), 0);
  assert.equal(R.log.find((l) => l.kind === "stat")!.kind === "stat" && (R.log.find((l) => l.kind === "stat") as any).t, "KT", "the log keeps the detail");
});

test("match formats: sets to 21, caps, sets ended early, two-set pool play", () => {
  const pts = (n: number, t = "UP") => Array.from({ length: n }, () => ev(t));
  // to 21
  let R = replay([ev("NS", { serve: "us" }), ...pts(21)], { bestOf: 3, setTo: 21 });
  assert.equal(R.sets[0].over, true); assert.equal(R.sets[0].winner, "us");
  // cap 27: 27–26 ends the set
  R = replay([ev("NS", { serve: "us" }), ...pts(26), ...pts(26, "TP"), ev("UP")], { bestOf: 3, setTo: 25, cap: 27 });
  assert.equal(R.sets[0].us, 27); assert.equal(R.sets[0].over, true);
  // without a cap, 27–26 keeps going
  R = replay([ev("NS", { serve: "us" }), ...pts(26), ...pts(26, "TP"), ev("UP")], { bestOf: 3 });
  assert.equal(R.sets[0].over, false);
  // a set ended early by starting the next one counts for whoever led
  R = replay([ev("NS", { serve: "us" }), ...pts(18), ...pts(15, "TP"), ev("NS", { serve: "them" })], { bestOf: 3 });
  assert.equal(R.sets[0].winner, "us"); assert.equal(R.wonUs, 1);
  // deciding set of a best-of-3 goes to 15
  R = replay([ev("NS", { serve: "us" }), ...pts(25), ev("NS", { serve: "us" }), ...pts(25, "TP"), ev("NS", { serve: "us" }), ...pts(15)], { bestOf: 3 });
  assert.equal(R.matchOver, true); assert.equal(R.wonUs, 2);
  // two-set pool play: 1–1 is a finished match
  R = replay([ev("NS", { serve: "us" }), ...pts(25), ev("NS", { serve: "us" }), ...pts(25, "TP")], { bestOf: 2 });
  assert.equal(R.sets[1].target, 25, "no deciding set in pool play"); assert.equal(R.matchOver, true); assert.deepEqual([R.wonUs, R.wonThem], [1, 1]);
});

import { parseRosterLine, schoolYearEnd } from "../src/features/team/parseRoster";
test("roster paste: names, positions, classes and heights from copied rosters", () => {
  const fall = new Date(2026, 9, 1), spring = new Date(2027, 2, 1);
  assert.equal(schoolYearEnd(fall), 2027); assert.equal(schoolYearEnd(spring), 2027);
  const r = (l: string) => parseRosterLine(l, fall);
  assert.deepEqual(r("7 Maya Chen OH 2027"), { num: "7", first: "Maya", last: "Chen", pos: "OH", grad: 2027, height: "" });
  assert.deepEqual(r(`#12 Sofia Nguyen MB 5'11" Jr.`), { num: "12", first: "Sofia", last: "Nguyen", pos: "MB", grad: 2028, height: `5'11"` });
  assert.deepEqual(r("1\tAva Ramirez\tS\tSr\t5' 6\""), { num: "1", first: "Ava", last: "Ramirez", pos: "S", grad: 2027, height: `5'6"` });
  assert.deepEqual(r("Ava Setter S 1"), { num: "1", first: "Ava", last: "Setter", pos: "S", grad: null, height: "" });
  assert.equal(r("4 Jordan Lee OH/RS Fr. 5-9")!.pos, "OH");
  assert.equal(r("4 Jordan Lee OH/RS Fr. 5-9")!.grad, 2030);
  assert.equal(r("4 Jordan Lee OH/RS Fr. 5-9")!.height, `5'9"`);
  assert.equal(r("9 Riley Brooks Defensive Specialist '28")!.pos, "DS");
  assert.equal(r("9 Riley Brooks Defensive Specialist '28")!.grad, 2028);
  assert.equal(r("3 Lily Torres Libero")!.pos, "L");
  assert.equal(r("   "), null);
  assert.equal(r("10 Emma Diaz DS 2028")!.last, "Diaz");
  // a first name that happens to be a class or position word stays a name
  assert.equal(r("5 Sr Mendez")!.first, "Sr");
  assert.equal(r("6 Libero")!.first, "Libero");
});

import { gradCell, heightCell, positionCell } from "../src/features/team/parseRoster";
test("roster spreadsheet cells: positions, classes, grades and heights", () => {
  const fall = new Date(2026, 9, 1);
  for (const [raw, want] of [["OH", "OH"], ["Outside Hitter", "OH"], ["MH", "MB"], ["RS", "OPP"], ["OH/RS", "OH"], ["Setter", "S"], ["Libero", "L"], ["Defensive Specialist", "DS"], ["", ""], ["Manager", ""]]) assert.equal(positionCell(raw), want, raw);
  for (const [raw, want] of [["2028", 2028], ["'29", 2029], ["Jr.", 2028], ["Senior", 2027], ["9", 2030], ["12th", 2027], ["", null], ["n/a", null]] as [string, number | null][]) assert.equal(gradCell(raw, fall), want, raw);
  for (const [raw, want] of [[`5'10"`, `5'10"`], ["5-9", `5'9"`], ["6 1", `6'1"`], ["70", `5'10"`], ["", ""], ["tall", "tall"]]) assert.equal(heightCell(raw), want, raw);
});

test("serving: rallies on our serve count as serves even when nobody tapped 'In'", () => {
  // we serve 4 rallies: an ace, a net error (side-out), then (after siding back) two rallies won by kills with no serve tapped
  const R = replay([ev("NS", { serve: "us", lu: LU, lib: "lib" }), ev("SA", { p: LU[0] }), ev("SEN", { p: LU[0] }), ev("OE"), ev("K", { p: "oh1" }), ev("K", { p: "oh1" })]);
  const A = aggregate(R.sets), M = teamMetrics(A);
  assert.equal(A.psc.n, 4, "four rallies on our serve");
  assert.equal(M.serveIn, 3 / 4, "3 of 4 serves in (one net error)");
  assert.equal(M.serveEff, 0, "(1 ace − 1 error) ÷ 4");
  assert.equal(M.digSuccess, null, "no digs tracked → no dig success number");
});

test("recording after a set is over doesn't happen: a following point needs the next set (engine keeps the old set closed once NS arrives)", () => {
  const evs = [ev("NS", { serve: "us" })]; for (let i = 0; i < 25; i++) evs.push(ev("UP"));
  const R = replay(evs); assert.equal(R.cur!.over, true); assert.equal(R.cur!.us, 25);
});

import { autoLineup } from "../src/sports/volleyball/autoLineup";
test("first lineup: setter 1, opposite 4, outsides 2 & 5, middles 3 & 6, libero off the court", () => {
  const P = (id: string, pos: string) => ({ id, pos });
  const r = autoLineup([P("s", "S"), P("l", "L"), P("oh1", "OH"), P("oh2", "OH"), P("mb1", "MB"), P("mb2", "MB"), P("opp", "OPP"), P("ds", "DS")]);
  assert.deepEqual(r, { lu: ["s", "oh1", "mb1", "opp", "oh2", "mb2"], lib: "l" });
  // 6-2: second setter across from the first; short roster fills with whoever's there
  assert.deepEqual(autoLineup([P("s1", "S"), P("s2", "S"), P("oh1", "OH"), P("oh2", "OH"), P("mb1", "MB"), P("mb2", "MB")]).lu, ["s1", "oh1", "mb1", "s2", "oh2", "mb2"]);
  assert.equal(autoLineup([P("a", "OH"), P("b", "OH"), P("c", "DS"), P("d", "MB")]).lu.length, 4);
});

import { clipsFrom, filmTiming, highlightPick, shareable, videoKind, youtubeId } from "../src/film/clips";
test("clips: video kinds, YouTube ids, timing from 'first serve at', best plays first", () => {
  assert.equal(videoKind("https://youtu.be/abc123XYZ"), "youtube"); assert.equal(youtubeId("https://youtu.be/abc123XYZ?t=4"), "abc123XYZ");
  assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s"), "dQw4w9WgXcQ"); assert.equal(youtubeId("https://www.youtube.com/live/abcDEF12345"), "abcDEF12345");
  assert.equal(videoKind("https://vimeo.com/12345"), "vimeo"); assert.equal(videoKind("https://x.org/m.mp4"), "file"); assert.equal(videoKind("local:game.mov"), "local"); assert.equal(videoKind("https://www.hudl.com/video/1"), "other");
  assert.equal(shareable("local:game.mov"), false); assert.equal(shareable("https://youtu.be/abc123XYZ"), true);
  const evs = [ev("NS", { serve: "us", lu: LU, lib: "lib" }), ev("K", { p: "oh1" }), ev("D", { p: "lib" }), ev("SA", { p: "s" }), ev("AE", { p: "oh1" })];
  evs.forEach((e, k) => (e.ts = 100_000 + k * 20_000)); // a play every 20 s
  const R = replay(evs), T = filmTiming({ filmStart: null, videoOffset: 300 }, R, evs); // first serve at 5:00 in the video
  const clips = clipsFrom({ id: "m", video: "https://youtu.be/abc123XYZ", date: "2026-10-27", opp: "Buchanan" }, T, R.log, (l) => l.kind === "stat", (l) => (l as any).t, 8, 2);
  assert.deepEqual(clips.map((c) => [c.t, c.start, c.end]), [["K", 312, 322], ["D", 332, 342], ["SA", 352, 362], ["AE", 372, 382]]);
  assert.equal(clips[0].score, "1–0");
  assert.deepEqual(highlightPick(clips, 2).map((c) => c.t), ["K", "SA"], "kills and aces before digs, errors never");
  assert.equal(clipsFrom({ id: "m", date: "", opp: "" }, T, R.log, () => true, () => "").length, 0, "no video, no clips");
});
