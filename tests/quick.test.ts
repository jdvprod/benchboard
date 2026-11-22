import { test } from "node:test";
import assert from "node:assert/strict";
import { replay } from "../src/sports/volleyball/engine";
import { sampleMatch } from "../src/sports/volleyball/sample";
import { QUICK, quickAnswer } from "../src/sports/volleyball/quick";

const name = (id: string) => "P" + id.slice(0, 4);
const season = [1, 2, 3, 4, 5, 6].flatMap((i) => replay(sampleMatch(i * 7, 1e12 + i * 1e7, { finished: true, strength: i % 2 ? 1.1 : 0.9 })).sets);

test("every quick answer has an answer from a sample season", () => {
  for (const { id } of QUICK) {
    const a = quickAnswer(id, season, name);
    assert.ok(a.a.length > 10, id);
    assert.ok(!/NaN|undefined|null|Infinity/.test(a.a + JSON.stringify(a.rows)), id + ": " + a.a);
  }
});

test("start rotation names a rotation and lists all six", () => {
  const a = quickAnswer("start", season, name);
  assert.equal(a.none, false); assert.match(a.a, /^Start in rotation [1-6]/); assert.equal(a.rows.length, 6);
});

test("no data says so instead of guessing", () => {
  for (const { id } of QUICK) { const a = quickAnswer(id, [], name); assert.equal(a.none, true, id); assert.equal(a.rows.length, 0, id); }
});

test("losses compares won and lost sets", () => {
  const a = quickAnswer("losses", season, name);
  if (!a.none) assert.match(a.a, /won and \d+ sets? lost/);
});
