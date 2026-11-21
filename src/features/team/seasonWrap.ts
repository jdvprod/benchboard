/** End-of-season wrap-up: a cover page with the team's season, then one page per player with their numbers, their best
 * match, where they improved most from the first half of the season to the second, and a note from the coach.
 * Families keep it; it prints or saves as a PDF. */
import type { Match, Player, Team } from "../../data/model";
import { aggregate, Replay, Stat } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, hitting, passAvg, serveInPct, teamMetrics } from "../../sports/volleyball/metrics";
import { playerTiles } from "../player/playerGraphic";
import { esc, PRINT_CSS } from "../../ui/print";

export interface Game { m: Match; R: Replay }
/** Where a player grew most from the first half of the season to the second, if anywhere clearly. Pure. */
export function biggestJump(games: Game[], id: string): string | null {
  if (games.length < 4) return null;
  const half = Math.floor(games.length / 2), a = aggregate(games.slice(0, half).flatMap((g) => g.R.sets)).ps[id], b = aggregate(games.slice(half).flatMap((g) => g.R.sets)).ps[id];
  if (!a || !b) return null;
  const c: [string, number | null, number | null, number, (v: number) => string, number][] = [
    ["Hitting", a.TA >= 10 ? hitting(a) : null, b.TA >= 10 ? hitting(b) : null, 0.04, fmtHit, 1],
    ["Pass average", a.R >= 10 ? passAvg(a) : null, b.R >= 10 ? passAvg(b) : null, 0.15, fmtAvg, 0.25],
    ["Serves in", a.SA + a.SI + a.SE >= 10 ? serveInPct(a) : null, b.SA + b.SI + b.SE >= 10 ? serveInPct(b) : null, 0.05, fmtPct, 1],
  ];
  const best = c.filter(([, x, y, step]) => x != null && y != null && y - x >= step).sort((p, q) => (q[2]! - q[1]!) * q[5] - (p[2]! - p[1]!) * p[5])[0];
  return best ? `${best[0]}: ${best[4](best[1]!)} in the first half of the season, ${best[4](best[2]!)} in the second` : null;
}
const score = (s: Stat) => s.K + s.SA + s.BS + s.BA + s.D / 2 + s.AST / 4 - s.AE / 2 - s.SE / 2;

export function wrapHtml(t: Team, seasonName: string, games: Game[], players: Player[], notes: Record<string, string>): string {
  const A = aggregate(games.flatMap((g) => g.R.sets)), M = teamMetrics(A);
  const done = games.filter((g) => g.R.matchOver || g.m.status === "done");
  const W = done.filter((g) => g.R.wonUs > g.R.wonThem).length, L = done.filter((g) => g.R.wonThem > g.R.wonUs).length;
  const cover = `<section class="page"><h1>${esc(t.name)}</h1><p class="mut">${esc(seasonName)} · season wrap-up</p>
<div class="tiles" style="margin-top:14px"><div><span>Record</span><b>${W}–${L}</b></div><div><span>Hitting</span><b>${fmtHit(M.hitting)}</b></div><div><span>Side-out</span><b>${fmtPct(M.sideOut)}</b></div><div><span>Pass average</span><b>${fmtAvg(M.passAvg)}</b></div></div>
<h2>Matches</h2><table><thead><tr><th>Date</th><th>Opponent</th><th>Result</th></tr></thead><tbody>${done.map((g) => `<tr><td>${esc(g.m.date)}</td><td>${esc(g.m.opp)}</td><td>${g.R.wonUs > g.R.wonThem ? "W" : g.R.wonThem > g.R.wonUs ? "L" : "T"} ${g.R.wonUs}–${g.R.wonThem}</td></tr>`).join("")}</tbody></table>
<footer>Stats recorded live by the coaching staff with FloorCall.</footer></section>`;
  const pages = players.filter((p) => A.ps[p.id]).map((p) => {
    const s = A.ps[p.id]!, tiles = playerTiles(s), sets = A.setsPlayed?.[p.id] || 0;
    const best = games.map((g) => ({ g, s: aggregate(g.R.sets).ps[p.id] })).filter((x) => x.s).sort((x, y) => score(y.s!) - score(x.s!))[0];
    const jump = biggestJump(games, p.id), note = notes[p.id]?.trim();
    return `<section class="page"><h1>#${esc(p.num)} ${esc(p.first)} ${esc(p.last)}</h1><p class="mut">${esc([p.pos, t.name, seasonName].filter(Boolean).join(" · "))}${sets ? ` · ${sets} sets` : ""}</p>
${tiles.length ? `<div class="tiles" style="margin-top:14px">${tiles.map((x) => `<div><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join("")}</div>` : ""}
${best ? `<h2>Best match</h2><p>vs ${esc(best.g.m.opp)}, ${esc(best.g.m.date)}: ${playerTiles(best.s!).slice(0, 4).map((x) => `${esc(x.value)} ${esc(x.label.toLowerCase())}`).join(", ") || "a strong all-around match"}</p>` : ""}
${jump ? `<h2>Biggest improvement</h2><p>${esc(jump)}</p>` : ""}
${note ? `<h2>From your coach</h2><div class="box">${esc(note).replace(/\n/g, "<br>")}</div>` : ""}
<footer>Stats recorded live by the coaching staff with FloorCall.</footer></section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(t.name)} ${esc(seasonName)} wrap-up</title><style>${PRINT_CSS}</style></head><body><main>${cover}${pages}</main></body></html>`;
}
