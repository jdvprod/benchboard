import { test } from "node:test";
import assert from "node:assert/strict";
import { scoutLine, scoutNumbers, scoutTotals } from "../src/film/scout";

const film = (evs: [string, any][]) => ({ id: "f", date: "2026-11-01", vs: "X", video: "", at: 0, evs: evs.map(([n, t], i) => ({ id: "e" + i, vt: i, n, t })) });

test("scouting totals rank the most dangerous players first, across films", () => {
  const T = scoutTotals([film([["12", "K"], ["12", "K"], ["4", "SA"], ["7", "AE"], ["12", "AE"]]), film([["4", "K"], ["4", "B"], ["", "E"]])]);
  assert.deepEqual(T.map((x) => x.n), ["4", "12", "7", "?"]);
  assert.equal(T[1].K, 2); assert.equal(T[1].AE, 1);
  assert.equal(scoutLine(T[1]), "2 kills, 1 error");
  assert.equal(scoutLine(T[0]), "1 kill, 1 ace, 1 block");
});

test("number buttons come from the roster and from numbers already used", () => {
  assert.deepEqual(scoutNumbers({ "9": {}, "2": {} }, [film([["14", "K"], ["2", "D"]])]), ["2", "9", "14"]);
});
