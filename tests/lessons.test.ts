import { test } from "node:test";
import assert from "node:assert/strict";
import { detail, fmtMeasure, ics, measure, message, sum, tap, trend, weekly } from "../src/lessons/reps";

test("lessons: each skill's number", () => {
  assert.equal(measure({ passing: { "3": 2, "2": 1, "0": 1 } }, "passing"), 2);
  assert.equal(measure({ serving: { ace: 1, in: 7, out: 2 } }, "serving"), 0.8);
  assert.equal(measure({ hitting: { kill: 4, play: 4, err: 2 } }, "hitting"), 0.2);
  assert.equal(measure({}, "setting"), null);
  assert.equal(fmtMeasure("hitting", 0.3125), ".313");
  assert.equal(fmtMeasure("hitting", -0.1), "-.100");
  assert.equal(fmtMeasure("passing", 2), "2.00");
  assert.equal(fmtMeasure("defense", 0.666), "67%");
  assert.equal(detail({ serving: { ace: 1, out: 2 } }, "serving"), "1 ace, 2 error");
});

test("lessons: tapping counts up and back down to nothing", () => {
  let r = tap({}, "passing", "3"); r = tap(r, "passing", "3"); r = tap(r, "passing", "1");
  assert.deepEqual(r, { passing: { "3": 2, "1": 1 } });
  r = tap(r, "passing", "1", -1); r = tap(r, "passing", "3", -5);
  assert.deepEqual(r, {});
  assert.deepEqual(sum([{ passing: { "3": 1 } }, { passing: { "3": 2, "0": 1 }, serving: { in: 3 } }]), { passing: { "3": 3, "0": 1 }, serving: { in: 3 } });
});

test("lessons: progress runs oldest to newest and skips sessions without that skill", () => {
  const t = trend([{ starts: "2030-01-08T00:00:00Z", reps: { passing: { "2": 2 } } }, { starts: "2030-01-01T00:00:00Z", reps: { passing: { "3": 1, "1": 1 } } }, { starts: "2030-01-05T00:00:00Z", reps: { serving: { in: 1 } } }], "passing");
  assert.deepEqual(t.map((x) => x.v), [2, 2]);
  assert.equal(t[0].at, "2030-01-01T00:00:00Z");
});

test("lessons: calendar files and weekly repeats", () => {
  const f = ics([{ id: "ls1", starts: "2030-01-05T17:00:00Z", minutes: 90, kind: "clinic", title: "Serve clinic; level 2", place: "Gym A, Court 3", focus: ["serving"], shared_note: "Bring water" }], new Date("2030-01-01T00:00:00Z"));
  assert.match(f, /DTSTART:20300105T170000Z\r\nDTEND:20300105T183000Z/);
  assert.ok(f.includes("SUMMARY:Serve clinic\\; level 2"));
  assert.ok(f.includes("LOCATION:Gym A\\, Court 3"));
  assert.ok(f.includes("DESCRIPTION:Focus: Serving\\nBring water"));
  assert.ok(f.split("\r\n").every((l) => l.length <= 75));
  const w = weekly("2030-01-05T17:00:00.000Z", 3);
  assert.equal(w.length, 3);
  assert.equal(new Date(w[2]).getTime() - new Date(w[0]).getTime() >= 13 * 86400000, true);
  assert.equal(new Date(w[1]).getHours(), new Date(w[0]).getHours(), "same time of day across daylight saving");
  assert.match(message({ id: "x", starts: "2030-01-05T17:00:00Z", minutes: 60, kind: "private", focus: ["passing"] }, "Mia"), /^Hi Mia, here's your private lesson: .* \(60 min\)\.\nWe'll work on: passing\.$/);
});

import { gendersFor, isAdultLevel } from "../src/data/model";
test("team levels: college, pro and adult teams are women's and men's", () => {
  for (const l of ["College", "Professional", "Adult / rec", "NCAA D1", "Pro league"]) assert.ok(isAdultLevel(l), l);
  for (const l of ["Varsity", "JV", "16U Club", "18U Open", "Middle school", ""]) assert.ok(!isAdultLevel(l), l);
  assert.deepEqual(gendersFor("Professional").map((x) => x[1]), ["Women", "Men", "Coed"]);
});

import { parseScoutQuery } from "../src/film/scout";
import { parseQuery } from "../src/film/query";
test("film: scouting search in plain words", () => {
  assert.deepEqual(parseScoutQuery("every attack by #12"), { codes: ["K", "TA", "AE"], nums: ["12"], label: "#12's attacks" });
  assert.deepEqual(parseScoutQuery("all their blocks").codes, ["B"]);
  assert.deepEqual(parseScoutQuery("#7 kills").nums, ["7"]);
  assert.deepEqual(parseScoutQuery("attempts by number 3").codes, ["K", "TA", "AE"]);
  assert.equal(parseScoutQuery("everything 14 did").codes, null);
});
test("film: our match search covers the coach's examples", () => {
  const roster = [{ id: "p7", first: "Maya", last: "Chen", num: "7" }];
  assert.deepEqual(parseQuery("all blocking clips", roster).q.codes, ["BS", "BA", "BT", "BE"]);
  assert.deepEqual(parseQuery("all kills from the opponent", roster).q.codes, ["OK"]);
  const a = parseQuery("all attempts by #7", roster).q; assert.deepEqual(a.players, ["p7"]); assert.ok(a.codes!.includes("TA"));
});
test("film: plays by the other team, in our film", () => {
  assert.deepEqual(parseQuery("aces by the other team").q.codes, ["OA"]);
  assert.deepEqual(parseQuery("their blocks").q.codes, ["AB"]);
  assert.deepEqual(parseQuery("opponent errors").q.codes, ["OE"]);
  assert.deepEqual(parseQuery("our blocks").q.codes, ["BS", "BA", "BT", "BE"]);
});

import { flowOf, runsOf } from "../src/ui/Momentum";
test("momentum: score flow and scoring runs", () => {
  const r = (w: "us" | "them", to: "us" | "them" | null = null) => ({ w, server: w, rot: 1, rotB: 1, srvP: null, pass: null, firstAtk: null, onCourt: [], end: w === "us" ? "K" : "OK", p: null, to }) as any;
  const f = flowOf([r("us"), r("us"), r("us"), r("them"), r("them", "us"), r("us"), r("us"), r("us"), r("us")]);
  assert.deepEqual(f.map((p) => p.d), [0, 1, 2, 3, 2, 1, 2, 3, 4, 5]);
  assert.equal(f[5].to, "us");
  assert.deepEqual(runsOf(f).map((x) => [x.side, x.len]), [["us", 3], ["us", 4]]);
});

import { posOf, POS_ANGLE } from "../src/features/lineup/RotationWheel";
test("rotation wheel: players move one spot clockwise each rotation", () => {
  assert.equal(posOf(0, 1), 1); assert.equal(posOf(1, 2), 1); assert.equal(posOf(0, 2), 6); assert.equal(posOf(3, 2), 3);
  for (let k = 0; k < 6; k++) for (let r = 1; r < 6; r++) assert.equal((POS_ANGLE[posOf(k, r + 1)] - POS_ANGLE[posOf(k, r)] + 360) % 360, 60);
});
