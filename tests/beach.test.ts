import { test } from "node:test";
import assert from "node:assert/strict";
import { BeachEvent, BeachMatch, hitPct, pack, replay, summary, unpack } from "../src/sports/beach/engine";

const match = (events: BeachEvent[], extra: Partial<BeachMatch> = {}): BeachMatch => ({ id: "m", at: 0, format: "bo3", us: "Ava / Maya", them: "Ridgeview", names: ["Ava", "Maya", "Kim", "Lee"], first: "us", firstServer: [0, 2], events, ...extra });
const pts = (w: "us" | "them", n: number): BeachEvent[] => Array.from({ length: n }, () => ({ t: "pt", w }));

test("beach: servers alternate within a pair on each side-out", () => {
  const order: number[] = []; const ev: BeachEvent[] = [];
  for (const w of ["them", "us", "them", "us", "them"] as const) { order.push(replay(match(ev)).server); ev.push({ t: "pt", w }); }
  assert.deepEqual(order, [0, 2, 1, 3, 0]);
  assert.equal(replay(match([...pts("us", 3)])).server, 0, "the server keeps serving while her pair scores");
});

test("beach: sides switch every 7 points, every 5 in the third", () => {
  let S = replay(match([...pts("us", 4), ...pts("them", 3)]));
  assert.equal(S.switchNow, true); assert.equal(S.swapped, true);
  S = replay(match([...pts("us", 4), ...pts("them", 4)]));
  assert.equal(S.switchNow, false);
  const two = [...pts("us", 21), ...pts("them", 21)];
  S = replay(match([...two, ...pts("us", 3), ...pts("them", 2)]));
  assert.equal(S.set, 2); assert.equal(S.switchNow, true);
});

test("beach: sets to 21 win by two, third to 15, match ends at two sets", () => {
  let S = replay(match([...pts("us", 20), ...pts("them", 20), ...pts("us", 1)]));
  assert.equal(S.sets[0].done, false, "21-20 is not over");
  S = replay(match([...pts("us", 20), ...pts("them", 20), ...pts("us", 2)]));
  assert.equal(S.sets[0].done, true); assert.equal(S.set, 1); assert.equal(S.serving, "them", "the other pair serves first in set 2");
  S = replay(match([...pts("us", 21), ...pts("them", 21), ...pts("us", 15), ...pts("us", 3)]));
  assert.equal(S.over, true); assert.equal(S.winner, "us"); assert.deepEqual(S.setsWon, { us: 2, them: 1 }); assert.equal(S.sets[2].us, 15);
  S = replay(match(pts("them", 28), { format: "one28" }));
  assert.equal(S.over, true); assert.equal(S.winner, "them");
});

test("beach: stats score the right pair and feed hitting percentage", () => {
  const S = replay(match([{ t: "stat", c: "K", p: 0 }, { t: "stat", c: "TA", p: 0 }, { t: "stat", c: "AE", p: 0 }, { t: "stat", c: "A", p: 2 }, { t: "stat", c: "SE", p: 2 }, { t: "stat", c: "D", p: 1 }, { t: "stat", c: "B", p: 3 }, { t: "to", w: "us" }]));
  assert.deepEqual([S.sets[0].us, S.sets[0].them], [2, 3]);
  assert.equal(hitPct(S.players[0]), 0); assert.equal(S.players[2].A, 1); assert.equal(S.players[1].D, 1); assert.equal(S.timeouts.us, 1);
  assert.match(summary(match([]), S), /Ava: 1 K, 1 E, 3 TA/);
});

test("beach: a share link carries the whole match and rejects junk", () => {
  const m = match([{ t: "stat", c: "K", p: 0 }, { t: "stat", c: "AE", p: 3 }, { t: "pt", w: "them" }, { t: "to", w: "us" }, { t: "stat", c: "SE", p: 2 }], { names: ["Ava", "Maya", "Kim", "Zoë"], first: "them", firstServer: [1, 3] });
  const back = unpack(pack(m))!;
  assert.deepEqual(back.events, m.events); assert.deepEqual(back.names, m.names); assert.equal(back.first, "them"); assert.deepEqual(back.firstServer, [1, 3]);
  assert.deepEqual(replay(back).sets, replay(m).sets);
  assert.match(pack(m), /^[A-Za-z0-9_-]+$/);
  assert.equal(unpack("not-a-match"), null); assert.equal(unpack(""), null);
});
