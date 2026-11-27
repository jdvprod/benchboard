import { test } from "node:test";
import assert from "node:assert/strict";
import { workload } from "../src/sports/volleyball/load";

const today = "2026-12-10";
const at = (n: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };

test("a steady player isn't flagged; a sudden jump is", () => {
  const e: any[] = [];
  for (let w = 1; w <= 4; w++) for (const d of [1, 3]) { e.push({ date: at(w * 7 + d), id: "steady", min: 120 }); e.push({ date: at(w * 7 + d), id: "jump", min: 60 }); }
  for (const d of [1, 3]) e.push({ date: at(d), id: "steady", min: 120 });
  for (const d of [0, 1, 2, 3]) e.push({ date: at(d), id: "jump", min: 120 });
  const R = Object.fromEntries(workload(e, ["steady", "jump", "new"], today).map((r) => [r.id, r]));
  assert.equal(R.steady.flag, null); assert.equal(R.steady.week, 240); assert.equal(R.steady.avg, 240);
  assert.equal(R.jump.flag, "spike"); assert.equal(R.jump.week, 480); assert.equal(R.jump.avg, 120); assert.equal(R.jump.ratio, 4);
  assert.equal(R.new.avg, null); assert.equal(R.new.ratio, null); assert.equal(R.new.flag, null);
});

test("seven days in a row without a day off is flagged", () => {
  const e = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: at(d), id: "a", min: 60 }));
  const [r] = workload(e, ["a"], today);
  assert.equal(r.streak, 7); assert.equal(r.flag, "streak");
});

test("a streak can end yesterday; future days don't count", () => {
  const e = [1, 2, 3].map((d) => ({ date: at(d), id: "a", min: 60 })).concat({ date: "2026-12-20", id: "a", min: 500 });
  const [r] = workload(e, ["a"], today);
  assert.equal(r.streak, 3); assert.equal(r.week, 180);
});
