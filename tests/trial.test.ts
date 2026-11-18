import { test } from "node:test";
import assert from "node:assert/strict";
import { accessWith } from "../src/app/flags";

const H = 3600e3, made = Date.parse("2026-11-01T12:00:00Z");
test("the trial covers the first day, and keeps going until the first match is done", () => {
  assert.equal(accessWith({ createdAt: made }, 0, made + 2 * H, "2026-11-01").ok, true);
  assert.equal(accessWith({ createdAt: made }, 1, made + 23 * H, "2026-11-02").ok, true);
  assert.equal(accessWith({ createdAt: made }, 1, made + 25 * H, "2026-11-02").ok, false);  // a day and a match: over
  assert.equal(accessWith({ createdAt: made }, 0, made + 5 * 24 * H, "2026-11-06").ok, true); // no match yet: still on
  assert.equal(accessWith({ createdAt: made }, 0, made + 15 * 24 * H, "2026-11-16").ok, false); // but never past 14 days
});
test("a paid plan works until its paid-through date", () => {
  assert.equal(accessWith({ createdAt: made, plan: "team", paidUntil: "2027-11-01" }, 9, made + 90 * 24 * H, "2027-01-30").why, "paid");
  assert.equal(accessWith({ createdAt: made, plan: "team", paidUntil: "2026-12-01" }, 9, made + 90 * 24 * H, "2027-01-30").ok, false);
});
