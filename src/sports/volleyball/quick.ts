/** Quick answers: the questions coaches ask most, worked out from the numbers (no AI, so they are instant and exact).
 *  Every answer says how much data it rests on, and says so plainly when that isn't enough to trust. */
import { aggregate, Agg, SetState } from "./engine";
import { fmtAvg, fmtHit, fmtPct, ratio, teamMetrics, TeamMetrics } from "./metrics";

export type QuickId = "passers" | "start" | "pressure" | "losses" | "oos";
export interface QuickRow { label: string; value: string; note?: string }
export interface QuickAnswer {
  id: QuickId;
  /** The question as the coach would ask it. */
  q: string;
  /** One-sentence answer, or why there isn't one yet. */
  a: string;
  rows: QuickRow[];
  /** True when there is an answer but it rests on little data. */
  thin: boolean;
  /** True when there isn't enough data to answer at all. */
  none: boolean;
}

export const QUICK: { id: QuickId; q: string }[] = [
  { id: "start", q: "Which rotation should we start in?" },
  { id: "passers", q: "Who should pass in each rotation?" },
  { id: "pressure", q: "Who's our best server under pressure?" },
  { id: "oos", q: "Who gets the ball when we're out of system?" },
  { id: "losses", q: "What changed in the sets we lost?" },
];

const MIN_PASSES = 4, MIN_ROT_RALLIES = 10, MIN_PRESSURE_SERVES = 4, MIN_OOS_SWINGS = 4;
/** Ranks by a rate pulled toward the team's rate until there are enough reps, so 3 of 4 doesn't beat 9 of 14. */
const adj = (w: number, n: number, team: number, k: number) => (w + team * k) / (n + k);
/** Players with a solid number of reps rank ahead of those with only a few. */
const solid = (n: number, min: number) => (n >= min ? 1 : 0);
const reps = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const answer = (id: QuickId, a: string, rows: QuickRow[] = [], thin = false, none = false): QuickAnswer => ({ id, q: QUICK.find((x) => x.id === id)!.q, a, rows, thin, none });

/** Best passers in each receive rotation, and the rotation where passing breaks down. */
export function passers(A: Agg, name: (id: string) => string): QuickAnswer {
  const rows: QuickRow[] = [];
  let worst: { r: number; avg: number; n: number } | null = null, total = 0, thin = false;
  for (let r = 1; r <= 6; r++) {
    const ps = A.rcvRot[r] || {};
    const all = Object.entries(ps), n = all.reduce((s, [, x]) => s + x.R, 0), sum = all.reduce((s, [, x]) => s + x.RS, 0);
    total += n;
    if (!n) continue;
    const avg = sum / n;
    const ranked = all.filter(([, x]) => x.R >= MIN_PASSES).map(([id, x]) => ({ id, avg: x.RS / x.R, n: x.R, score: adj(x.RS, x.R, avg, 6) })).sort((a, b) => solid(b.n, 8) - solid(a.n, 8) || b.score - a.score || b.n - a.n);
    if (n >= 6 && (!worst || avg < worst.avg)) worst = { r, avg, n };
    if (!ranked.length) { rows.push({ label: `Rotation ${r}`, value: "Not enough passes yet", note: `${reps(n, "pass", "passes")} in all` }); thin = true; continue; }
    rows.push({ label: `Rotation ${r}`, value: ranked.slice(0, 3).map((x) => `${name(x.id)} ${fmtAvg(x.avg)}`.replace(/ /g, "\u00a0")).join(", "), note: `team ${fmtAvg(avg)} on ${reps(n, "pass", "passes")}` });
  }
  if (total < 12) return answer("passers", total ? `Only ${reps(total, "pass", "passes")} graded so far. Track a match or two with pass grades (3, 2, 1, 0) and this fills in.` : "No graded passes yet. Grade each serve receive 3, 2, 1 or 0 while tracking and this fills in.", rows, false, true);
  let a = "Best passers in each rotation, by pass average (3 is perfect).";
  if (worst) {
    const w = worst, best = Object.entries(A.rcvRot[w.r] || {}).filter(([, x]) => x.R >= MIN_PASSES).sort((p, q) => solid(q[1].R, 8) - solid(p[1].R, 8) || adj(q[1].RS, q[1].R, w.avg, 6) - adj(p[1].RS, p[1].R, w.avg, 6))[0];
    a = `Passing is weakest in rotation ${w.r} (${fmtAvg(w.avg)} on ${reps(w.n, "pass", "passes")})` + (best ? `; ${name(best[0])} passes best there at ${fmtAvg(best[1].RS / best[1].R)} on ${reps(best[1].R, "pass", "passes")}.` : ".");
  }
  return answer("passers", a, rows, thin || total < 40);
}

/** The rotation that wins the most rallies: starting there gives it the most turns in a set. */
export function startRotation(A: Agg): QuickAnswer {
  const list = [1, 2, 3, 4, 5, 6].map((r) => { const x = A.rot[r]; const n = x.w + x.l; return { r, n, w: x.w, pct: ratio(x.w, n), so: ratio(x.rw, x.rn), ps: ratio(x.sw, x.sn) }; });
  const ok = list.filter((x) => x.n >= MIN_ROT_RALLIES);
  if (ok.length < 3) {
    const n = list.reduce((s, x) => s + x.n, 0);
    return answer("start", n ? `Not enough rallies in each rotation yet (${reps(n, "rally", "rallies")} in all). Set your starting lineup when you track and this fills in after a match or two.` : "No rotation data yet. Set your starting lineup when you track and every rally is filed under its rotation.", [], false, true);
  }
  const ranked = ok.slice().sort((a, b) => b.pct! - a.pct! || b.n - a.n), best = ranked[0], worst = ranked[ranked.length - 1];
  const rows = list.map((x) => ({ label: `Rotation ${x.r}`, value: x.n ? `${fmtPct(x.pct)} of rallies` : "No rallies yet", note: x.n ? `side-out ${fmtPct(x.so)} · on our serve ${fmtPct(x.ps)} · ${reps(x.n, "rally", "rallies")}` : undefined }));
  const a = `Start in rotation ${best.r}: you win ${fmtPct(best.pct)} of rallies there (${best.w} of ${best.n}), so it gets the most turns.` + (worst.r !== best.r ? ` Rotation ${worst.r} is your hardest (${fmtPct(worst.pct)}).` : "");
  return answer("start", a, rows, ok.length < 6 || best.n < 25);
}

const SERVE_ERR = new Set(["SE", "SEN", "SEO"]);
/** Late in a set means 20 or more in a set to 25 (10 or more in a set to 15). */
const late = (s: SetState, us?: number, them?: number) => us != null && them != null && Math.max(us, them) >= s.target - 5;

/** Who wins the most points serving late in a set, and who misses the fewest serves there. */
export function pressureServers(sets: SetState[], name: (id: string) => string): QuickAnswer {
  const by: Record<string, { n: number; w: number; e: number }> = {};
  for (const s of sets) for (const r of s.rallies) {
    if (r.server !== "us" || !r.srvP || !late(s, r.us, r.them)) continue;
    const x = by[r.srvP] || (by[r.srvP] = { n: 0, w: 0, e: 0 });
    x.n++; if (r.w === "us") x.w++; if (SERVE_ERR.has(r.end)) x.e++;
  }
  const total = Object.values(by).reduce((s, x) => s + x.n, 0);
  const teamRate = total ? Object.values(by).reduce((s, x) => s + x.w, 0) / total : 0;
  const ranked = Object.entries(by).filter(([, x]) => x.n >= MIN_PRESSURE_SERVES).map(([id, x]) => ({ id, ...x, pct: x.w / x.n, score: adj(x.w - x.e * 0.5, x.n, teamRate, 8) })).sort((a, b) => solid(b.n, 8) - solid(a.n, 8) || b.score - a.score || a.e - b.e || b.n - a.n);
  if (!ranked.length) return answer("pressure", total ? `Only ${reps(total, "serve")} late in a set so far, not enough per server yet.` : "No serves late in a set yet (from 20 on, or 10 on in a set to 15). Set the lineup when you track so each serve has a server.", [], false, true);
  const best = ranked[0];
  const rows = ranked.slice(0, 6).map((x) => ({ label: name(x.id), value: `${fmtPct(x.pct)} of points won`, note: `${reps(x.n, "serve")} late · ${reps(x.e, "error")}` }));
  return answer("pressure", `${name(best.id)}: ${fmtPct(best.pct)} of points won serving from 20 on (${best.w} of ${best.n}), with ${reps(best.e, "missed serve")}.`, rows, best.n < 10);
}

/** Who to set when the pass is off: hitting on attacks after a 1 pass. */
export function outOfSystem(A: Agg, name: (id: string) => string): QuickAnswer {
  const p = A.ctx.P1?.p || {};
  const all = Object.entries(p), swings = all.reduce((s, [, x]) => s + x.TA, 0);
  const teamHit = swings ? all.reduce((s, [, x]) => s + x.K - x.E, 0) / swings : 0;
  const ranked = all.filter(([, x]) => x.TA >= MIN_OOS_SWINGS).map(([id, x]) => ({ id, ...x, hit: (x.K - x.E) / x.TA, score: adj(x.K - x.E, x.TA, teamHit, 10) })).sort((a, b) => solid(b.TA, 8) - solid(a.TA, 8) || b.score - a.score || b.TA - a.TA);
  if (!ranked.length) return answer("oos", swings ? `Only ${reps(swings, "swing")} off a 1 pass so far, not enough per hitter yet.` : "No attacks off a bad pass yet. Grade passes while tracking and each attack is filed by the pass before it.", [], false, true);
  const best = ranked[0];
  const rows = ranked.slice(0, 6).map((x) => ({ label: name(x.id), value: `${fmtHit(x.hit)} hitting`, note: `${reps(x.K, "kill")} · ${reps(x.E, "error")} · ${reps(x.TA, "swing")}` }));
  return answer("oos", `Set ${name(best.id)}: ${fmtHit(best.hit)} on ${reps(best.TA, "swing")} after a 1 pass (${reps(best.K, "kill")}, ${reps(best.E, "error")}).`, rows, best.TA < 10);
}

/** How each number reads, and how big a gap matters (one "unit" of difference). */
const GAPS: { k: keyof TeamMetrics | "errors"; label: string; unit: number; fmt: (v: number | null) => string; higherBetter: boolean }[] = [
  { k: "sideOut", label: "Side-out", unit: 0.08, fmt: fmtPct, higherBetter: true },
  { k: "pointScoring", label: "Point-scoring on our serve", unit: 0.08, fmt: fmtPct, higherBetter: true },
  { k: "passAvg", label: "Pass average", unit: 0.25, fmt: (v) => fmtAvg(v), higherBetter: true },
  { k: "hitting", label: "Hitting", unit: 0.08, fmt: fmtHit, higherBetter: true },
  { k: "firstBallSO", label: "First-ball side-out", unit: 0.08, fmt: fmtPct, higherBetter: true },
  { k: "serveIn", label: "Serves in", unit: 0.05, fmt: fmtPct, higherBetter: true },
  { k: "inSystemPct", label: "In-system attacks", unit: 0.1, fmt: fmtPct, higherBetter: true },
  { k: "digSuccess", label: "Dig success", unit: 0.1, fmt: fmtPct, higherBetter: true },
  { k: "errors", label: "Errors per set", unit: 2, fmt: (v) => (v == null ? "—" : v.toFixed(1)), higherBetter: false },
];

/** The biggest drop-offs between sets won and sets lost. */
export function losses(sets: SetState[]): QuickAnswer {
  const won = sets.filter((s) => s.winner === "us"), lost = sets.filter((s) => s.winner === "them");
  if (!won.length || !lost.length) return answer("losses", !sets.some((s) => s.winner) ? "No finished sets yet." : !lost.length ? `You haven't lost a set here (${reps(won.length, "set")} won), so there's nothing to compare.` : `You haven't won a set here yet (${reps(lost.length, "set")} lost), so there's nothing to compare.`, [], false, true);
  const W = teamMetrics(aggregate(won)), L = teamMetrics(aggregate(lost));
  const val = (M: TeamMetrics, k: (typeof GAPS)[number]["k"]) => (k === "errors" ? M.perSet?.errors ?? null : (M[k] as number | null));
  const gaps = GAPS.map((g) => { const w = val(W, g.k), l = val(L, g.k); if (w == null || l == null) return null; const worse = (g.higherBetter ? w - l : l - w) / g.unit; return { g, w, l, worse }; })
    .filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.worse - a.worse);
  const real = gaps.filter((x) => x.worse >= 0.5);
  const rows = gaps.slice(0, 5).map((x) => ({ label: x.g.label, value: `${x.g.fmt(x.w)} won → ${x.g.fmt(x.l)} lost`, note: x.worse >= 1 ? "much worse in losses" : x.worse >= 0.5 ? "worse in losses" : x.worse <= -0.5 ? "better in losses" : "about the same" }));
  const thin = won.length + lost.length < 4;
  if (!real.length) return answer("losses", `No single number stands out between ${reps(won.length, "set")} won and ${reps(lost.length, "set")} lost; the losses were close calls across the board.`, rows, thin);
  const top = real[0];
  const lead = `The biggest change in sets you lost was ${top.g.label.toLowerCase()}: ${top.g.fmt(top.w)} in wins, ${top.g.fmt(top.l)} in losses`;
  const next = real[1] ? `, then ${real[1].g.label.toLowerCase()} (${real[1].g.fmt(real[1].w)} → ${real[1].g.fmt(real[1].l)})` : "";
  return answer("losses", `${lead}${next}. From ${reps(won.length, "set")} won and ${reps(lost.length, "set")} lost.`, rows, thin);
}

export function quickAnswer(id: QuickId, sets: SetState[], name: (id: string) => string, A: Agg = aggregate(sets)): QuickAnswer {
  switch (id) {
    case "passers": return passers(A, name);
    case "start": return startRotation(A);
    case "pressure": return pressureServers(sets, name);
    case "oos": return outOfSystem(A, name);
    case "losses": return losses(sets);
  }
}
