import { test } from "node:test";
import assert from "node:assert/strict";
import { replay } from "../src/sports/volleyball/engine";
import { sampleMatch } from "../src/sports/volleyball/sample";
import { playTime } from "../src/sports/volleyball/playtime";

test("playing time adds up from the lineups", () => {
  const sets = replay(sampleMatch(5, 1e12, { finished: true })).sets;
  const ids = [...new Set(sets.flatMap((s) => s.rallies.flatMap((r) => r.onCourt)))];
  const R = playTime(sets, ids.concat("bench-only"));
  assert.ok(R.withLineup > 0 && R.rallies > 0);
  const total = R.rows.reduce((s, r) => s + r.rallies, 0);
  assert.ok(total >= R.rallies * 6 && total <= R.rallies * 7, "six or seven on the court each rally");
  for (const r of R.rows) { assert.equal(r.won + r.lost, r.rallies); assert.ok(r.started <= r.sets); assert.ok(r.share >= 0 && r.share <= 1); }
  assert.equal(R.rows.find((r) => r.id === "bench-only")!.rallies, 0);
});

test("sets without a lineup are counted as untracked, not as zero minutes", () => {
  const R = playTime([{ rallies: [{ onCourt: [], w: "us" }] } as any], ["a"]);
  assert.equal(R.sets, 1); assert.equal(R.withLineup, 0); assert.equal(R.rows[0].rallies, 0);
});
