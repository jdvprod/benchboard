import { test } from "node:test";
import assert from "node:assert/strict";
import { access, billingOn, BILLING, featureOk, PAID, FREE_LIST } from "../src/app/flags";

test("until billing starts, every team has every feature", () => {
  assert.equal(BILLING, false); assert.equal(billingOn(), false);
  const a = access({ createdAt: 0 }, 99);
  for (const f of Object.keys(PAID) as (keyof typeof PAID)[]) assert.equal(featureOk(f, a), true, f);
});

test("past the trial, paid features close but the free list stays", () => {
  for (const f of Object.keys(PAID) as (keyof typeof PAID)[]) assert.equal(featureOk(f, { ok: false, why: "trial over" }), false, f);
  assert.ok(FREE_LIST.some((x) => /Points only/.test(x)) && FREE_LIST.some((x) => /Live/.test(x)) && FREE_LIST.some((x) => /helper/.test(x)));
});
