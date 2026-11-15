import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTryout, newTryout, parseCandidates, rank, ratingSheetHtml, tryoutCsv } from "../src/features/tryouts/tryouts";

let n = 0; const id = () => "c" + ++n;

test("tryouts: a pasted list becomes candidates with bibs, positions and grades", () => {
  const cs = parseCandidates("12 Maya Chen OH 10th\nAva Ramirez, S, Jr\n\n#7 Lily Torres L\nZoe", [], id);
  assert.deepEqual(cs.map((c) => [c.bib, c.name, c.pos, c.grade]), [["12", "Maya Chen", "OH", "10th"], ["13", "Ava Ramirez", "S", "Jr"], ["7", "Lily Torres", "L", ""], ["14", "Zoe", "", ""]]);
});

test("tryouts: rank averages evaluators, honors weights and skips unrated", () => {
  const t = newTryout("Fall", "2026-11-20", "t1"); t.skills = ["Serve", "Pass"]; t.weights = { Pass: 3 };
  t.candidates = parseCandidates("1 Ann\n2 Bea\n3 Cy", [], id);
  const [a, b, c] = t.candidates;
  t.ratings = { coachA: { [a.id]: { Serve: 5, Pass: 2 }, [b.id]: { Serve: 2, Pass: 5 } }, coachB: { [a.id]: { Serve: 5, Pass: 3 }, [b.id]: { Serve: 3, Pass: 4 } } };
  const r = rank(t);
  assert.deepEqual(r.map((x) => x.c.name), ["Bea", "Ann", "Cy"]);
  assert.equal(r[0].score!.toFixed(3), ((2 + 15) / 4 / 2 + (3 + 12) / 4 / 2).toFixed(3));
  assert.equal(r[0].evaluators, 2); assert.equal(r[2].score, null); assert.equal(r[1].bySkill.Pass, 2.5);
  assert.ok(r[0].spread! > 0);
});

test("tryouts: another evaluator's file merges by bib and replaces only their own ratings", () => {
  const mine = newTryout("Fall", "2026-11-20", "t1"); mine.candidates = parseCandidates("1 Ann\n2 Bea", [], id);
  mine.ratings = { me: { [mine.candidates[0].id]: { Serve: 4 } }, pat: { [mine.candidates[0].id]: { Serve: 1 } } };
  const theirs = newTryout("Fall", "2026-11-20", "t9"); theirs.candidates = parseCandidates("2 Bea\n9 New Kid", [], () => "x" + ++n);
  theirs.ratings = { pat: { [theirs.candidates[0].id]: { Serve: 5, Pass: 9 }, [theirs.candidates[1].id]: { Pass: 3 } } };
  const { t, added, ratings } = mergeTryout(mine, theirs, id);
  assert.equal(added, 1); assert.equal(ratings, 2, "out-of-range ratings are dropped");
  assert.equal(t.candidates.length, 3);
  assert.deepEqual(t.ratings.me, mine.ratings.me, "my ratings stay");
  assert.equal(t.ratings.pat[mine.candidates[0].id], undefined, "pat's old ratings are replaced by the new file");
  assert.equal(t.ratings.pat[mine.candidates[1].id].Serve, 5);
});

test("tryouts: CSV for the club", () => {
  const t = newTryout("Fall", "2026-11-20", "t1"); t.skills = ["Serve"]; t.candidates = parseCandidates('1 Ann "Annie" Lee', [], id); t.candidates[0].decision = "offer";
  t.ratings = { me: { [t.candidates[0].id]: { Serve: 4 } } };
  const csv = tryoutCsv(t).split("\n");
  assert.equal(csv[0], "Rank,Bib,Name,Grade,Position,Score,Serve,Evaluators,Decision,Note");
  assert.equal(csv[1], '1,1,"Ann ""Annie"" Lee",,,4.00,4.00,1,offer,');
});

test("tryouts: a paper rating sheet, sorted by bib, with a box per skill", () => {
  const t = newTryout("16U <tryouts>", "2026-11-20", "t1"); t.skills = ["Serve", "Pass"]; t.candidates = parseCandidates("15 Zoe\n3 Ann", [], id);
  const h = ratingSheetHtml(t, "Pat");
  assert.match(h, /16U &lt;tryouts&gt;: rating sheet/); assert.match(h, /Evaluator: Pat/);
  assert.ok(h.indexOf(">3<") < h.indexOf(">15<"), "sorted by bib");
  assert.equal((h.match(/class="box"/g) || []).length, 4);
});
