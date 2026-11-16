/** What the stats say to practice, from the last few matches. Its own module so Home can show it without loading Practice. */
import { matchesOf, replayOf, team } from "../../data/store";
import { aggregate } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, fmtSigned, inSystem, outOfSystem, teamMetrics, transition } from "../../sports/volleyball/metrics";

export function focusAreas(): { text: string; cat: string }[] {
  const t = team()!;
  const recent = matchesOf().filter((x) => x.kind === "match" && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).slice(0, 4);
  const sets = recent.flatMap((x) => replayOf(x)?.sets || []), span = recent.length === 1 ? "in the last match" : `over the last ${recent.length} matches`;
  if (!sets.length) return [];
  const A = aggregate(sets), M = teamMetrics(A), out: { text: string; cat: string; w: number }[] = [];
  const pl = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  // only compare side-out by pass quality when the gap is real and both have a decent sample
  const soGap = M.soByPass.P3 != null && M.soByPass.P1 != null && A.soByPass.P3.n >= 8 && A.soByPass.P1.n >= 5 && M.soByPass.P3 - M.soByPass.P1 >= 0.1;
  if (M.passAvg != null && M.passAvg < 2.1 && A.T.R >= 10) out.push({ text: `Pass average is ${fmtAvg(M.passAvg)} (aim for 2.1+)${soGap ? `. You side out ${fmtPct(M.soByPass.P3)} after a 3-pass but ${fmtPct(M.soByPass.P1)} after a 1` : ` on ${A.T.R} passes`}.`, cat: "Serve receive", w: 2.1 - M.passAvg + 0.4 });
  if (M.serveIn != null && M.serveIn < 0.88 && A.psc.n >= 20) out.push({ text: `Serving ${fmtPct(M.serveIn)} in (aim for 88%+), ${pl(A.T.SE + A.T.SEN + A.T.SEO, "miss", "misses")}.`, cat: "Serving", w: (0.88 - M.serveIn) * 4 + 0.3 });
  if (M.hitting != null && M.hitting < 0.2 && A.T.TA >= 20) out.push({ text: `Hitting ${fmtHit(M.hitting)} with ${pl(A.T.AE, "error")} on ${A.T.TA} swings.`, cat: "Attacking", w: (0.2 - M.hitting) * 3 + 0.3 });
  if (M.hitOutOfSystem != null && M.hitInSystem != null && outOfSystem(A).TA >= 10 && inSystem(A).TA >= 10 && M.hitInSystem - M.hitOutOfSystem > 0.15) out.push({ text: `Out-of-system hitting ${fmtHit(M.hitOutOfSystem)} vs ${fmtHit(M.hitInSystem)} in system. Rep high sets off bad passes.`, cat: "Attacking", w: 0.4 });
  if (M.digSuccess != null && M.digSuccess < 0.6 && A.T.D + A.T.DE + A.team.OK >= 15) out.push({ text: `Dig success ${fmtPct(M.digSuccess)}; they're getting kills through the defense.`, cat: "Defense", w: (0.6 - M.digSuccess) * 3 + 0.3 });
  if (M.hitTransition != null && M.hitTransition < 0.1 && transition(A).TA >= 10) out.push({ text: `Transition hitting is ${fmtHit(M.hitTransition)}. Work dig-to-attack.`, cat: "Transition", w: 0.35 });
  let worst = 0, wv = 0; for (let r = 1; r <= 6; r++) { const x = A.rot[r]; if (x && x.w - x.l < wv) { wv = x.w - x.l; worst = r; } }
  if (worst && wv <= -3) out.push({ text: `Rotation ${worst} is ${fmtSigned(wv)} ${span}. Play it out in a rotation scrimmage.`, cat: "Game play", w: 0.5 + Math.abs(wv) / 20 });
  const misc = A.team.CE + A.team.EE + A.team.PE + A.T.CE + A.T.EE + A.T.PE;
  if (misc / (A.sets || 1) > 1.5) out.push({ text: `${misc} communication, effort and positioning errors (${(misc / A.sets).toFixed(1)} per set).`, cat: "Game play", w: 0.35 });
  return out.sort((a, b) => b.w - a.w).slice(0, 5);
}
