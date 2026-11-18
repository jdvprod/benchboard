import { test } from "node:test";
import assert from "node:assert/strict";
import { findDoubles } from "../src/sports/volleyball/duplicates";

const st = (id: string, t: string, p: string | undefined, us: number, them: number, w: "us" | "them" | null = null, set = 1): any => ({ id, set, kind: "stat", t, p, w, us, them });

test("the same play from two devices in one rally is flagged once", () => {
  const log = [st("devA-1", "D", "p1", 3, 2), st("devB-1", "D", "p1", 3, 2), st("devA-2", "K", "p2", 4, 2, "us"), st("devB-2", "K", "p2", 3, 2)];
  const d = findDoubles(log);
  assert.equal(d.length, 2);
  assert.equal(d[0].extra.id, "devB-1"); assert.equal(d[0].sure, false); // two digs in a rally can happen
  assert.equal(d[1].extra.id, "devB-2"); assert.equal(d[1].sure, true);  // a stats-only kill (no point) matches the scorer's kill
});

test("the same device, other rallies or other players are never flagged", () => {
  const log = [st("devA-1", "D", "p1", 3, 2), st("devA-2", "D", "p1", 3, 2), st("devB-1", "D", "p1", 4, 2), st("devB-2", "D", "p3", 3, 2), st("devB-3", "D", "p1", 3, 2, null, 2)];
  assert.equal(findDoubles(log).length, 0);
});
