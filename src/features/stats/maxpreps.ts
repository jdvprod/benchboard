/** A match's stats in MaxPreps' volleyball categories and order, as a printable sheet to type into MaxPreps' stat entry. */
import { player, team } from "../../data/store";
import { Match } from "../../data/model";
import { aggregate, Replay } from "../../sports/volleyball/engine";
import { serveErrors, serves } from "../../sports/volleyball/metrics";

/** MaxPreps groups, each with its column codes (as MaxPreps labels them) and how to compute them. */
export const MP_GROUPS: [string, [string, string][]][] = [
  ["", [["SP", "Sets played"]]],
  ["Serving", [["SA", "Serve attempts"], ["A", "Aces"], ["SE", "Serve errors"], ["PTS", "Points while serving"]]],
  ["Attacking", [["ATT", "Attack attempts"], ["K", "Kills"], ["E", "Attack errors"]]],
  ["Serve receiving", [["R", "Good receptions"], ["RE", "Reception errors"]]],
  ["Blocking", [["BS", "Block solos"], ["BA", "Block assists"], ["BE", "Block errors"]]],
  ["Ball handling", [["BHA", "Ball handling attempts"], ["AST", "Assists"], ["BHE", "Ball handling errors"]]],
  ["Digging", [["D", "Digs"], ["DE", "Dig errors"]]],
];
const CODES = MP_GROUPS.flatMap((g) => g[1].map((c) => c[0]));

export interface MpRow { id: string; num: string; name: string; v: Record<string, number> }

export function maxprepsRows(R: Replay): MpRow[] {
  const A = aggregate(R.sets);
  return Object.keys(A.ps).filter((id) => player(id)).map((id) => {
    const s = A.ps[id], p = player(id)!;
    const v: Record<string, number> = {
      SP: A.setsPlayed[id] || 0,
      SA: serves(s, A.srv[id]?.n), A: s.SA, SE: serveErrors(s), PTS: A.srv[id]?.w || 0,
      ATT: s.TA, K: s.K, E: s.AE,
      R: s.R - s.P0, RE: s.P0,
      BS: s.BS, BA: s.BA, BE: s.BE,
      BHA: s.SATT + s.AST + s.BHE, AST: s.AST, BHE: s.BHE,
      D: s.D, DE: s.DE,
    };
    return { id, num: p.num, name: `${p.first} ${p.last}`.trim(), v };
  }).sort((a, b) => (+a.num || 0) - (+b.num || 0) || a.num.localeCompare(b.num));
}

export function maxprepsHtml(m: Match, R: Replay): string {
  const t = team()!, rows = maxprepsRows(R);
  const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const tot = Object.fromEntries(CODES.map((c) => [c, rows.reduce((n, r) => n + r.v[c], 0)]));
  tot.SP = R.sets.filter((s) => s.us + s.them > 0).length;
  const sets = R.sets.filter((s) => s.us + s.them > 0).map((s) => `${s.us}–${s.them}`).join(", ");
  const head1 = MP_GROUPS.map(([g, cs]) => `<th colspan="${cs.length}" class="g">${esc(g)}</th>`).join("");
  const head2 = CODES.map((c) => `<th title="${esc(MP_GROUPS.flatMap((g) => g[1]).find((x) => x[0] === c)![1])}">${c}</th>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MaxPreps sheet · ${esc(t.name)} vs ${esc(m.opp)} · ${esc(m.date)}</title>
<style>*{box-sizing:border-box}body{margin:0;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;background:#fff}main{max-width:1100px;margin:0 auto;padding:18px 14px}
h1{font-size:20px;margin:0}p{margin:4px 0;color:#555}.wrap{overflow-x:auto;margin-top:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5d9de;padding:5px 6px;text-align:center;white-space:nowrap}
th{background:#f1f3f5;font-size:12px}th.g{background:#e3e8ed}td.l,th.l{text-align:left}tfoot td{font-weight:700;background:#f7f8f9}tbody tr:nth-child(even) td{background:#fafbfc}
.note{margin-top:12px;font-size:12px;color:#555}@media print{main{padding:0}.note{display:none}@page{size:landscape;margin:10mm}}</style></head><body><main>
<h1>${esc(t.name)} vs ${esc(m.opp)}</h1><p>${esc(m.date)}${sets ? " · Sets " + esc(sets) : ""} · MaxPreps volleyball categories</p>
<div class="wrap"><table><thead><tr><th class="l" rowspan="2">#</th><th class="l" rowspan="2">Player</th>${head1}</tr><tr>${head2}</tr></thead>
<tbody>${rows.map((r) => `<tr><td class="l">${esc(r.num)}</td><td class="l">${esc(r.name)}</td>${CODES.map((c) => `<td>${r.v[c]}</td>`).join("")}</tr>`).join("")}</tbody>
<tfoot><tr><td class="l" colspan="2">Team</td>${CODES.map((c) => `<td>${tot[c]}</td>`).join("")}</tr></tfoot></table></div>
<p class="note">Type these into MaxPreps' stat entry for this match; the columns follow MaxPreps' volleyball categories. Good receptions are every pass rated 1 to 3; ball handling attempts are set attempts, assists and ball handling errors. Made with Benchboard.</p>
</main></body></html>`;
}
