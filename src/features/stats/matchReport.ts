/** One-page match report as a self-contained HTML file for parents, players and staff. Prints to one page. */
import { player, team } from "../../data/store";
import { Match } from "../../data/model";
import { aggregate, momentum, Replay, Stat } from "../../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, hitting, passAvg, serveErrors, teamMetrics } from "../../sports/volleyball/metrics";
import { sideNames } from "../../app/Scoreboard";
import { rate, situations } from "../../sports/volleyball/situations";

const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function flow(diffs: number[]): string {
  if (diffs.length < 2) return "";
  const W = 220, H = 46, mx = Math.max(3, ...diffs.map(Math.abs)), x = (i: number) => (i / (diffs.length - 1)) * W, y = (v: number) => H / 2 - (v / mx) * (H / 2 - 3);
  const d = diffs.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#9aa5b1" stroke-width="1" stroke-dasharray="3 3"/><path d="${d}" fill="none" stroke="var(--c)" stroke-width="2"/></svg>`;
}

export function matchReportHtml(m: Match, R: Replay): string {
  const t = team()!, names = sideNames(m, t.name), A = aggregate(R.sets), M = teamMetrics(A), T = A.T;
  const won = R.wonUs > R.wonThem, result = R.matchOver || m.status === "done" ? (won ? "Win" : R.wonThem > R.wonUs ? "Loss" : "Final") : "In progress";
  const ids = Object.keys(A.ps).filter((id) => player(id)).sort((a, b) => (+player(a)!.num || 0) - (+player(b)!.num || 0));
  const lead = (f: (s: Stat) => number, l: string) => { const top = ids.map((id) => [id, f(A.ps[id])] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? `<div class="k"><div class="l">${l}</div><div class="v">${+top[1].toFixed(1)}</div><div class="s">#${esc(player(top[0])!.num)} ${esc(player(top[0])!.first)}</div></div>` : ""; };
  const row = (id: string) => { const s = A.ps[id], p = player(id)!; return `<tr><td>${esc(p.num)}</td><td>${esc(p.first + " " + p.last)}</td><td>${s.K}</td><td>${s.AE}</td><td>${s.TA}</td><td>${fmtHit(hitting(s))}</td><td>${s.AST}</td><td>${s.SA}</td><td>${serveErrors(s)}</td><td>${s.R ? fmtAvg(passAvg(s)) : "–"}</td><td>${s.D}</td><td>${fmtNum(blocks(s))}</td></tr>`; };
  const report = m.report ? `<section><h3>Coach's notes</h3>${esc(m.report).split(/\n+/).map((l) => /^\s*-\s/.test(l) ? `<p class="b">• ${l.replace(/^\s*-\s/, "")}</p>` : `<p>${l}</p>`).join("")}</section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(names.us)} vs ${esc(names.them)} · ${esc(m.date)}</title>
<style>:root{--c:#2B79B0;--ink:#141a21;--mut:#5d6873;--bg:#f4f6f8;--card:#fff;--line:#e2e6ea}@media(prefers-color-scheme:dark){:root{--ink:#e9edf1;--mut:#9aa6b2;--bg:#0f141a;--card:#18202a;--line:#2a3440}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:820px;margin:0 auto;padding:18px 16px}
.hero{background:#141a21;color:#fff;border-radius:12px;padding:16px 18px;border-bottom:5px solid var(--c)}.top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:#aeb8c2;font-size:13px}
.sc{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin-top:6px;text-align:center}.nm{font-weight:800;font-size:20px;text-transform:uppercase;letter-spacing:.04em}.big{font-size:52px;font-weight:800;line-height:1}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;background:var(--c);color:#fff;font-weight:700;font-size:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:12px 0;overflow-x:auto}h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{padding:5px 6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}th:nth-child(-n+2),td:nth-child(-n+2){text-align:left}th{font-size:11px;color:var(--mut);text-transform:uppercase}
.ks{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.k{border:1px solid var(--line);border-radius:8px;padding:8px 10px}.l{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:700}.v{font-size:24px;font-weight:800}.s{font-size:12px;color:var(--mut)}
.flows{display:flex;flex-wrap:wrap;gap:14px}.flows div{font-size:12px;color:var(--mut)}p{margin:0 0 6px}p.b{padding-left:6px}footer{color:var(--mut);font-size:12px;text-align:center;margin-top:14px}
@media print{body{background:#fff;color:#000}main{padding:0}section{break-inside:avoid;border-color:#ccc}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
<body><main>
<div class="hero"><div class="top"><span>${esc(m.date)}${m.event ? " · " + esc(m.event) : ""}${m.site ? " · " + esc(m.site) : ""}</span><span class="tag">${result}</span></div>
<div class="sc"><div class="nm">${esc(names.us)}</div><div class="big">${R.wonUs}–${R.wonThem}</div><div class="nm">${esc(names.them)}</div></div></div>
<section><h3>Sets</h3><table><thead><tr><th>Team</th>${R.sets.map((s) => `<th>${s.n}</th>`).join("")}</tr></thead><tbody>
<tr><td><b>${esc(names.us)}</b></td>${R.sets.map((s) => `<td${s.winner === "us" ? ' style="font-weight:800"' : ""}>${s.us}</td>`).join("")}</tr>
<tr><td><b>${esc(names.them)}</b></td>${R.sets.map((s) => `<td${s.winner === "them" ? ' style="font-weight:800"' : ""}>${s.them}</td>`).join("")}</tr></tbody></table>
<div class="flows" style="margin-top:10px">${R.sets.map((s) => { const f = flow(momentum(s)); return f ? `<div>Set ${s.n} score flow<br>${f}</div>` : ""; }).join("")}</div></section>
<section><h3>Team</h3><div class="ks">
<div class="k"><div class="l">Kills</div><div class="v">${T.K}</div><div class="s">hitting ${fmtHit(M.hitting)}</div></div>
<div class="k"><div class="l">Aces</div><div class="v">${T.SA}</div><div class="s">serving ${fmtPct(M.serveIn)} in</div></div>
<div class="k"><div class="l">Blocks</div><div class="v">${fmtNum(blocks(T))}</div><div class="s">${T.BS} solo</div></div>
<div class="k"><div class="l">Digs</div><div class="v">${T.D}</div><div class="s">${fmtNum(M.perSet?.D ?? null)} per set</div></div>
<div class="k"><div class="l">Passing</div><div class="v">${fmtAvg(M.passAvg)}</div><div class="s">${fmtPct(M.perfectPass)} perfect</div></div>
<div class="k"><div class="l">Side-out</div><div class="v">${fmtPct(M.sideOut)}</div><div class="s">on their serve</div></div></div></section>
${(() => { const X = situations(R.sets), p = (x: { w: number; n: number }) => x.n ? fmtPct(rate(x)) : "–";
  return `<section><h3>Situations</h3><div class="ks">
<div class="k"><div class="l">Late side-out</div><div class="v">${p(X.phase.late.so)}</div><div class="s">at 20+ · ${X.phase.late.so.w}/${X.phase.late.so.n}</div></div>
<div class="k"><div class="l">Late point-scoring</div><div class="v">${p(X.phase.late.ps)}</div><div class="s">${X.phase.late.ps.w}/${X.phase.late.ps.n}</div></div>
<div class="k"><div class="l">Our runs of 3+</div><div class="v">${X.runs.us.three}</div><div class="s">longest ${X.runs.us.longest}</div></div>
<div class="k"><div class="l">Their runs of 3+</div><div class="v">${X.runs.them.three}</div><div class="s">longest ${X.runs.them.longest}</div></div>
<div class="k"><div class="l">After our timeouts</div><div class="v">${p(X.afterTO.us)}</div><div class="s">next rally won</div></div></div></section>`; })()}
<section><h3>Leaders</h3><div class="ks">${lead((s) => s.K, "Kills")}${lead((s) => s.SA, "Aces")}${lead((s) => s.D, "Digs")}${lead((s) => blocks(s), "Blocks")}${lead((s) => s.AST, "Assists")}</div></section>
<section><h3>Box score</h3><table><thead><tr><th>#</th><th>Player</th><th>K</th><th>E</th><th>TA</th><th>Hit %</th><th>Ast</th><th>Ace</th><th>SE</th><th>Pass</th><th>Dig</th><th>Blk</th></tr></thead><tbody>${ids.map(row).join("")}</tbody></table></section>
${report}
<footer>${esc(t.name)}${t.level ? " · " + esc(t.level) : ""} · Made with Floorcall</footer></main></body></html>`;
}
