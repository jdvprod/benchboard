/** End-of-season report: record, team numbers, match log, leaders, awards and every player's line. One shareable HTML file. */
import { player, playerName, team } from "../../data/store";
import { Match, Season } from "../../data/model";
import { aggregate, Agg, recordOf, Replay, resultOf, Stat } from "../../sports/volleyball/engine";
import { rate, situations } from "../../sports/volleyball/situations";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, hitting, passAvg, playerMetrics, serveAttempts, serveEfficiency, serveErrors, teamMetrics } from "../../sports/volleyball/metrics";

export interface Award { title: string; id: string; why: string }

export function seasonAwards(items: { m: Match; R: Replay }[]): Award[] {
  const A = aggregate(items.flatMap((x) => x.R.sets)), ids = Object.keys(A.ps).filter((id) => player(id));
  const minSets = Math.max(3, Math.round(A.sets * 0.4));
  const pick = (title: string, ok: (id: string) => boolean, score: (id: string) => number, why: (id: string) => string): Award | null => {
    const c = ids.filter(ok).sort((a, b) => score(b) - score(a))[0]; return c ? { title, id: c, why: why(c) } : null;
  };
  const pm = (id: string) => playerMetrics(A, id), st = (id: string) => A.ps[id];
  const out = [
    pick("Most valuable player", (id) => pm(id).sets >= minSets, (id) => pm(id).netPerSet ?? -99, (id) => `${fmtNum(pm(id).netPerSet, 2)} net points per set, ${fmtNum(pm(id).sets)} sets`),
    pick("Top attacker", (id) => st(id).TA >= 40 && (hitting(st(id)) ?? 0) >= 0.15, (id) => pm(id).kps ?? 0, (id) => `${fmtNum(pm(id).kps, 2)} kills per set, hitting ${fmtHit(hitting(st(id)))}`),
    pick("Top server", (id) => serveAttempts(st(id)) >= 30, (id) => serveEfficiency(st(id)) ?? -1, (id) => `${st(id).SA} aces, ${fmtPct(pm(id).serveIn)} in, efficiency ${fmtHit(serveEfficiency(st(id)))}`),
    pick("Top passer", (id) => st(id).R >= 30, (id) => passAvg(st(id)) ?? 0, (id) => `${fmtAvg(passAvg(st(id)))} average on ${st(id).R} serves, ${fmtPct(pm(id).perfectPass)} perfect`),
    pick("Top defender", (id) => pm(id).sets >= minSets, (id) => pm(id).dps ?? 0, (id) => `${fmtNum(pm(id).dps, 2)} digs per set (${st(id).D} total)`),
    pick("Top blocker", (id) => pm(id).sets >= minSets && blocks(st(id)) > 0, (id) => pm(id).bps ?? 0, (id) => `${fmtNum(pm(id).bps, 2)} blocks per set`),
  ].filter(Boolean) as Award[];
  // Most improved: hitting in the second half of the season vs the first
  if (items.length >= 4) {
    const sorted = items.slice().sort((a, b) => a.m.date.localeCompare(b.m.date)), half = Math.floor(sorted.length / 2);
    const A1 = aggregate(sorted.slice(0, half).flatMap((x) => x.R.sets)), A2 = aggregate(sorted.slice(half).flatMap((x) => x.R.sets));
    const best = ids.filter((id) => (A1.ps[id]?.TA || 0) >= 10 && (A2.ps[id]?.TA || 0) >= 10).map((id) => ({ id, d: (hitting(A2.ps[id]) ?? 0) - (hitting(A1.ps[id]) ?? 0) })).sort((a, b) => b.d - a.d)[0];
    if (best && best.d > 0.05) out.push({ title: "Most improved", id: best.id, why: `Hitting ${fmtHit(hitting(A1.ps[best.id]))} in the first half of the season, ${fmtHit(hitting(A2.ps[best.id]))} since` });
  }
  return out;
}

export function seasonReportHtml(items: { m: Match; R: Replay }[], season: Season | undefined): string {
  const t = team()!, A = aggregate(items.flatMap((x) => x.R.sets)), M = teamMetrics(A);
  const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const rec = recordOf(items.map((x) => x.R));
  const sW = items.reduce((n, x) => n + x.R.wonUs, 0), sL = items.reduce((n, x) => n + x.R.wonThem, 0);
  const log = items.slice().sort((a, b) => a.m.date.localeCompare(b.m.date)).map(({ m, R }) => { const a = aggregate(R.sets), mm = teamMetrics(a); return `<tr><td>${esc(m.date)}</td><td>${esc(m.opp)}</td><td><b>${resultOf(R) || ""} ${R.wonUs}–${R.wonThem}</b></td><td>${fmtHit(mm.hitting)}</td><td>${fmtPct(mm.sideOut)}</td><td>${fmtAvg(mm.passAvg)}</td><td>${fmtPct(mm.serveIn)}</td></tr>`; }).join("");
  const awards = seasonAwards(items).map((a) => `<div class="aw"><span>${esc(a.title)}</span><b>${esc(playerName(a.id, "full"))}</b><small>${esc(a.why)}</small></div>`).join("");
  const ids = Object.keys(A.ps).filter((id) => player(id)).sort((a, b) => (+player(a)!.num || 0) - (+player(b)!.num || 0));
  const prow = (id: string) => { const s: Stat = A.ps[id], p = playerMetrics(A, id); return `<tr><td>${esc(player(id)!.num)}</td><td>${esc(player(id)!.first + " " + player(id)!.last)}</td><td>${p.sets}</td><td>${s.K}</td><td>${fmtHit(hitting(s))}</td><td>${s.SA}</td><td>${serveErrors(s)}</td><td>${s.R ? fmtAvg(passAvg(s)) : "–"}</td><td>${s.D}</td><td>${fmtNum(blocks(s))}</td><td>${s.AST}</td></tr>`; };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.name)} ${esc(season?.name || "season")} report</title>
<style>:root{--c:#2B79B0;--ink:#0B0C0E;--mut:#686E77;--line:#E2E4E8;--bg:#F3F4F6;--card:#fff}@media(prefers-color-scheme:dark){:root{--ink:#F2F3F5;--mut:#959BA4;--line:#25272C;--bg:#000;--card:#0F1012;--c:#8FCBF0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:900px;margin:0 auto;padding:20px 16px}
.hero{background:#000;color:#fff;border-radius:14px;padding:22px;border-bottom:5px solid #9BD3F2}.hero h1{margin:0;font-size:30px}.hero p{margin:4px 0 0;color:#9298A1}
.rec{display:flex;gap:28px;margin-top:16px;flex-wrap:wrap}.rec b{display:block;font-size:34px;line-height:1}.rec span{color:#9298A1;font-size:12.5px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:14px 0;overflow-x:auto}h2{font-size:15px;margin:0 0 10px}
.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.k div{border:1px solid var(--line);border-radius:10px;padding:8px 10px}.k b{display:block;font-size:22px}.k span{color:var(--mut);font-size:12px}
.awards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.aw{border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column}.aw span{font-size:12px;color:var(--c);font-weight:700}.aw b{font-size:16px}.aw small{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{padding:6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:nth-child(-n+2),td:nth-child(-n+2){text-align:left}th{color:var(--mut);font-size:12px}
footer{color:var(--mut);font-size:12px;text-align:center;margin-top:16px}@media print{body{background:#fff}section{break-inside:avoid}}</style></head><body><main>
<div class="hero"><h1>${esc(t.name)}</h1><p>${esc(season?.name || "Season")} report${t.level ? " · " + esc(t.level) : ""}</p>
<div class="rec"><div><b>${rec.text}</b><span>Record</span></div><div><b>${sW}–${sL}</b><span>Sets</span></div><div><b>${A.us}–${A.them}</b><span>Points</span></div><div><b>${fmtHit(M.hitting)}</b><span>Hitting</span></div></div></div>
<section><h2>Team numbers</h2><div class="k">
<div><b>${fmtPct(M.sideOut)}</b><span>Side-out</span></div><div><b>${fmtPct(M.pointScoring)}</b><span>Point-scoring</span></div><div><b>${fmtAvg(M.passAvg)}</b><span>Pass average</span></div>
<div><b>${fmtPct(M.serveIn)}</b><span>Serve in</span></div><div><b>${fmtNum(M.perSet?.K ?? null)}</b><span>Kills per set</span></div><div><b>${fmtNum(M.perSet?.SA ?? null)}</b><span>Aces per set</span></div>
<div><b>${fmtNum(M.perSet?.BLK ?? null)}</b><span>Blocks per set</span></div><div><b>${fmtNum(M.perSet?.D ?? null)}</b><span>Digs per set</span></div></div></section>
${(() => { const X = situations(items.flatMap((x) => x.R.sets)), p = (x: { w: number; n: number }) => x.n ? fmtPct(rate(x)) : "–", rec = (x: { w: number; n: number }) => x.n ? `${x.w}–${x.n - x.w}` : "–";
  return `<section><h2>Situations</h2><div class="k">
<div><b>${p(X.phase.late.so)}</b><span>Side-out at 20+</span></div><div><b>${p(X.phase.clutch.ps)}</b><span>Point-scoring, late and within 2</span></div>
<div><b>${X.runs.us.three}–${X.runs.them.three}</b><span>Runs of 3+ (us–them)</span></div><div><b>${rec(X.close)}</b><span>Sets decided by 3 or less</span></div>
<div><b>${rec(X.first5)}</b><span>When we reach 5 first</span></div><div><b>${p(X.afterTO.us)}</b><span>Rally won after our timeouts</span></div></div></section>`; })()}
${awards ? `<section><h2>Season awards</h2><div class="awards">${awards}</div></section>` : ""}
<section><h2>Match by match</h2><table><thead><tr><th>Date</th><th>Opponent</th><th>Result</th><th>Hit %</th><th>Side-out</th><th>Pass</th><th>Serve in</th></tr></thead><tbody>${log}</tbody></table></section>
<section><h2>Players</h2><table><thead><tr><th>#</th><th>Player</th><th>Sets</th><th>K</th><th>Hit %</th><th>Ace</th><th>SE</th><th>Pass</th><th>Dig</th><th>Blk</th><th>Ast</th></tr></thead><tbody>${ids.map(prow).join("")}</tbody></table></section>
<footer>Made with Floorcall · ${new Date().toLocaleDateString()}</footer></main></body></html>`;
}

export type { Agg };
