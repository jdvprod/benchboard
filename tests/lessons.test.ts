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
