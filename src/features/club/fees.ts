/** Player fees: what each family owes for the season, what they've paid, and who still owes. For coaches and club
 * directors who track this in a spreadsheet today. Floorcall doesn't take payments; this is the ledger.
 * Kept on the team (so every coach on a synced team sees it), never on Floorcall Live. Pure and unit tested. */
export interface Payment { id: string; at: string; amt: number; note?: string }
export interface FeeLine { amt?: number; paid: Payment[]; waived?: number; note?: string }
export interface Fees { amt: number; due?: string; label?: string; lines: Record<string, FeeLine> }
export interface FeePlayer { id: string; num: string | number; first: string; last?: string; active?: boolean }
/** Who the ledger covers: active players, plus anyone who left with payments on record. */
export const feePlayers = <P extends FeePlayer>(f: Fees | null | undefined, ps: P[]): P[] => ps.filter((p) => p.active !== false || !!f?.lines[p.id]);

const money = (n: number) => Math.round(n * 100) / 100;
export const fmtMoney = (n: number) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
/** Parse "$1,250.50", "1250", "250.5" into dollars; null when it isn't money. */
export function parseMoney(s: string): number | null { const t = s.replace(/[$,\s]/g, ""); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null; return money(+t); }

export function owed(f: Fees, id: string): number { const l = f.lines[id]; return money((l?.amt ?? f.amt) - (l?.waived || 0)); }
export function paid(f: Fees, id: string): number { return money((f.lines[id]?.paid || []).reduce((a, p) => a + p.amt, 0)); }
export const balance = (f: Fees, id: string) => money(owed(f, id) - paid(f, id));
export type FeeStatus = "paid" | "partial" | "owes" | "over" | "waived";
export function status(f: Fees, id: string): FeeStatus { const b = balance(f, id), p = paid(f, id); return b < 0 ? "over" : b === 0 ? (p === 0 && owed(f, id) === 0 ? "waived" : "paid") : p > 0 ? "partial" : "owes"; }
/** "1 family still owes $450", "2 families still owe $900" */
export const stillOwe = (n: number, left: number) => `${n} ${n === 1 ? "family still owes" : "families still owe"} ${fmtMoney(left)}`;

export function summary(f: Fees, players: FeePlayer[]) {
  let due = 0, got = 0, owing = 0;
  for (const p of players) { due += owed(f, p.id); got += Math.min(paid(f, p.id), Math.max(0, owed(f, p.id))); if (balance(f, p.id) > 0) owing++; }
  return { due: money(due), got: money(got), left: money(due - got), owing, n: players.length, pct: due ? got / due : 1 };
}
/** Add a payment, newest last. */
export function addPayment(f: Fees, id: string, p: Payment): Fees {
  const l = f.lines[id] || { paid: [] }; return { ...f, lines: { ...f.lines, [id]: { ...l, paid: [...l.paid, p] } } };
}
export function removePayment(f: Fees, id: string, pid: string): Fees {
  const l = f.lines[id]; if (!l) return f; return { ...f, lines: { ...f.lines, [id]: { ...l, paid: l.paid.filter((p) => p.id !== pid) } } };
}
export function setLine(f: Fees, id: string, x: Partial<FeeLine>): Fees { const l = f.lines[id] || { paid: [] }; return { ...f, lines: { ...f.lines, [id]: { ...l, ...x } } }; }

/** A message to paste to families: who still owes, by first name and number only, no amounts unless asked. */
export function reminder(f: Fees, players: FeePlayer[], team: string, withAmounts = false): string {
  const owing = players.filter((p) => balance(f, p.id) > 0);
  if (!owing.length) return "";
  const what = f.label || "season fees", when = f.due ? ` are due ${new Date(f.due + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : " are due";
  return `Reminder from ${team}: ${what}${when}. Still open:\n` + owing.map((p) => `#${p.num} ${p.first}${withAmounts ? ` (${fmtMoney(balance(f, p.id))} left)` : ""}`).join("\n") + "\nThank you! Reach out to the coach if you need a payment plan.";
}
const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
export function feesCsv(f: Fees, players: FeePlayer[]): string {
  const rows = [["Number", "First", "Last", "Owed", "Paid", "Balance", "Status", "Payments", "Note"]];
  for (const p of players) rows.push([String(p.num), p.first, p.last || "", owed(f, p.id).toFixed(2), paid(f, p.id).toFixed(2), balance(f, p.id).toFixed(2), status(f, p.id), (f.lines[p.id]?.paid || []).map((x) => `${x.at} ${x.amt.toFixed(2)}${x.note ? " " + x.note : ""}`).join("; "), f.lines[p.id]?.note || ""]);
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
