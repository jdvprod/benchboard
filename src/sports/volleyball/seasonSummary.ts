/** A season in a few numbers: record, sets, streaks, the biggest win and the best single-match lines. Pure: unit tested.
 * Used by the Live team page ("Season in review") and the coach's season graphic. */
import { aggregate, Replay, resultOf, Stat } from "./engine";
import { blocks } from "./metrics";

export interface SGame { id: string; opp: string; date: string; R: Replay }
export interface High { key: string; label: string; pid: string; v: number; opp: string; date: string; gameId: string }
export interface SeasonSummary {
  w: number; l: number; t: number; setsW: number; setsL: number; played: number;
  streak: { kind: "W" | "L" | null; n: number }; bestStreak: number;
  biggestWin: { opp: string; date: string; diff: number; sets: string; gameId: string } | null;
  highs: High[];
}
const CATS: [string, string, (s: Stat) => number][] = [["K", "Kills", (s) => s.K], ["SA", "Aces", (s) => s.SA], ["D", "Digs", (s) => s.D], ["AST", "Assists", (s) => s.AST], ["BLK", "Blocks", (s) => blocks(s)]];

export function seasonSummary(games: SGame[], counts: (pid: string) => boolean = () => true): SeasonSummary {
  const done = games.filter((g) => resultOf(g.R)).sort((a, b) => a.date.localeCompare(b.date));
  let w = 0, l = 0, t = 0, setsW = 0, setsL = 0, run = 0, best = 0, kind: "W" | "L" | null = null;
  let biggest: SeasonSummary["biggestWin"] = null;
  for (const g of done) {
    const r = resultOf(g.R)!; if (r === "W") w++; else if (r === "L") l++; else t++;
    setsW += g.R.wonUs; setsL += g.R.wonThem;
    if (r === kind) run++; else { kind = r === "T" ? null : r; run = r === "T" ? 0 : 1; }
    if (kind === "W") best = Math.max(best, run);
    if (r === "W") { const diff = g.R.sets.reduce((a, s) => a + s.us - s.them, 0); if (!biggest || diff > biggest.diff) biggest = { opp: g.opp, date: g.date, diff, sets: g.R.sets.filter((s) => s.us + s.them).map((s) => `${s.us}-${s.them}`).join(", "), gameId: g.id }; }
  }
  const highs: High[] = [];
  for (const [key, label, f] of CATS) {
    let top: High | null = null;
    for (const g of games) for (const [pid, s] of Object.entries(aggregate(g.R.sets).ps)) {
      const v = +f(s).toFixed(1); if (v > 0 && counts(pid) && (!top || v > top.v)) top = { key, label, pid, v, opp: g.opp, date: g.date, gameId: g.id };
    }
    if (top) highs.push(top);
  }
  return { w, l, t, setsW, setsL, played: done.length, streak: { kind, n: kind ? run : 0 }, bestStreak: best, biggestWin: biggest, highs };
}
