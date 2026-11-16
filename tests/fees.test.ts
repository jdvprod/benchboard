import { test } from "node:test";
import assert from "node:assert/strict";
import { addPayment, balance, Fees, feesCsv, fmtMoney, parseMoney, reminder, removePayment, setLine, status, summary } from "../src/features/club/fees";

const players = [{ id: "a", num: 7, first: "Maya", last: "Chen" }, { id: "b", num: 12, first: "Sofia", last: "Nguyen" }, { id: "c", num: 3, first: "Lily", last: "=cmd" }];
test("fees: balances, partial payments, waivers and overpayment", () => {
  let f: Fees = { amt: 450, due: "2026-12-01", lines: {} };
  f = addPayment(f, "a", { id: "p1", at: "2026-11-01", amt: 200 }); f = addPayment(f, "a", { id: "p2", at: "2026-11-10", amt: 250 });
  f = addPayment(f, "b", { id: "p3", at: "2026-11-02", amt: 100 });
  f = setLine(f, "c", { waived: 150 }); f = addPayment(f, "c", { id: "p4", at: "2026-11-03", amt: 320 });
  assert.equal(balance(f, "a"), 0); assert.equal(status(f, "a"), "paid");
  assert.equal(balance(f, "b"), 350); assert.equal(status(f, "b"), "partial");
  assert.equal(balance(f, "c"), -20); assert.equal(status(f, "c"), "over");
  const s = summary(f, players);
  assert.deepEqual([s.due, s.got, s.left, s.owing], [1200, 850, 350, 1], "an overpayment doesn't hide what others owe");
  f = removePayment(f, "a", "p2"); assert.equal(balance(f, "a"), 250);
  assert.equal(status({ amt: 100, lines: {} }, "x"), "owes");
});
test("fees: money in and out", () => {
  assert.equal(parseMoney("$1,250.50"), 1250.5); assert.equal(parseMoney("250"), 250); assert.equal(parseMoney("12.345"), null); assert.equal(parseMoney("abc"), null); assert.equal(parseMoney("-5"), null);
  assert.equal(fmtMoney(1250), "$1,250"); assert.equal(fmtMoney(12.5), "$12.50"); assert.equal(fmtMoney(-20), "−$20");
});
test("fees: a reminder names who still owes, amounts only if asked; the spreadsheet is safe to open", () => {
  let f: Fees = { amt: 450, due: "2026-12-01", label: "Winter fees", lines: {} };
  f = addPayment(f, "a", { id: "p1", at: "2026-11-01", amt: 450 }); f = addPayment(f, "b", { id: "p2", at: "2026-11-01", amt: 100 });
  const r = reminder(f, players, "Clovis North");
  assert.match(r, /^Reminder from Clovis North: Winter fees are due December 1\./); assert.match(r, /#12 Sofia\n#3 Lily/); assert.doesNotMatch(r, /Maya|\$/);
  assert.match(reminder(f, players, "CN", true), /#12 Sofia \(\$350 left\)/);
  assert.equal(reminder(addPayment(addPayment(f, "b", { id: "x", at: "", amt: 350 }), "c", { id: "y", at: "", amt: 450 }), players, "CN"), "", "nothing to send when everyone's paid");
  const csv = feesCsv(f, players);
  assert.match(csv, /^Number,First,Last,Owed,Paid,Balance,Status/); assert.match(csv, /12,Sofia,Nguyen,450\.00,100\.00,350\.00,partial,2026-11-01 100\.00/);
  assert.match(csv, /"'=cmd"/, "a formula in a name can't run in Excel");
});
test("fees: a full waiver reads as waived, not paid", async () => {
  const { stillOwe } = await import("../src/features/club/fees");
  assert.equal(status(setLine({ amt: 450, lines: {} }, "x", { waived: 450 }), "x"), "waived");
  assert.equal(stillOwe(1, 450), "1 family still owes $450"); assert.equal(stillOwe(2, 900), "2 families still owe $900");
});
