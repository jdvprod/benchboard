import { test } from "node:test";
import assert from "node:assert/strict";
import { dutyCounts, fairCrew, Tournament, updateText, WORK_JOBS } from "../src/tournament/model";

const T = (games: any[]): Tournament => ({ id: "t", name: "Fall Classic", start: "2026-12-05", poolTeams: [], games, others: [], createdAt: 0 });
const players = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const slots = WORK_JOBS.reduce((s, [, n]) => s + n, 0);

test("a work crew fills every job with different players", () => {
  const crew = fairCrew({ id: "w", stage: "work", opp: "X vs Y", bestOf: 2, scoring: "25" }, players, new Map());
  const all = Object.values(crew).flat();
  assert.equal(all.length, slots); assert.equal(new Set(all).size, slots);
  assert.equal(crew["Line judges"].length, 2);
});

test("duty rotates: players who worked go to the back", () => {
  const first = fairCrew({ id: "w1", stage: "work", opp: "", bestOf: 2, scoring: "25" }, players, new Map());
  const t = T([{ id: "w1", stage: "work", opp: "", bestOf: 2, scoring: "25", crew: first }]);
  const second = fairCrew({ id: "w2", stage: "work", opp: "", bestOf: 2, scoring: "25" }, players, dutyCounts([t]));
  const worked = new Set(Object.values(first).flat());
  const fresh = Object.values(second).flat().filter((id) => !worked.has(id));
  assert.equal(fresh.length, players.length - slots, "everyone who hasn't worked goes first");
});

test("jobs the coach already set stay", () => {
  const crew = fairCrew({ id: "w", stage: "work", opp: "", bestOf: 2, scoring: "25", crew: { Scorekeeper: ["j"] } }, players, new Map());
  assert.deepEqual(crew.Scorekeeper, ["j"]); assert.ok(!crew["Down ref"].includes("j"));
});

test("a small roster fills what it can, never twice", () => {
  const crew = fairCrew({ id: "w", stage: "work", opp: "", bestOf: 2, scoring: "25" }, ["a", "b", "c"], new Map());
  assert.equal(Object.values(crew).flat().length, 3);
});

test("the family update lists what's next, the crew and the jersey", () => {
  const t = { ...T([{ id: "g1", stage: "pool", opp: "Rivals", time: "09:00", court: "4", bestOf: 2, scoring: "25" }, { id: "w", stage: "work", opp: "A vs B", time: "10:00", court: "4", bestOf: 2, scoring: "25", crew: { Scorekeeper: ["a"] } }]), info: { jersey: "White" } };
  const txt = updateText(t, () => false, (id) => id.toUpperCase(), (x) => x || "");
  assert.match(txt, /vs Rivals at 09:00, Court 4/); assert.match(txt, /Work: A vs B at 10:00, Court 4 \(Scorekeeper: A\)/); assert.match(txt, /Jersey: White/);
  assert.match(updateText(t, () => true, (x) => x, (x) => x || "").replace(/Work.*/s, ""), /Fall Classic/);
});
