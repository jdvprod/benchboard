/** Derived volleyball metrics. Everything here is a pure function of the aggregated stats. */
import { Agg, Stat } from "./engine";
import { AttackContext } from "./actions";

export const ratio = (a: number, b: number): number | null => (b ? a / b : null);

/* ---------- player / team stat line ---------- */
export const serveErrors = (s: Stat) => s.SE + s.SEN + s.SEO;
export const serveAttempts = (s: Stat) => s.SA + s.SI + serveErrors(s);
export const miscErrors = (s: Stat) => s.CE + s.EE + s.PE;
export const blocks = (s: Stat) => s.BS + s.BA / 2;
export const hitting = (s: Pick<Stat, "K" | "AE" | "TA">) => ratio(s.K - s.AE, s.TA);
export const killPct = (s: Stat) => ratio(s.K, s.TA);
export const attackErrPct = (s: Stat) => ratio(s.AE, s.TA);
export const passAvg = (s: Stat) => ratio(s.RS, s.R);
export const perfectPassPct = (s: Stat) => ratio(s.R3, s.R);
export const goodPassPct = (s: Stat) => ratio(s.R3 + s.R2, s.R);
/** Serves = the larger of serves tapped and rallies actually served: a serve that started a rally and wasn't an ace or an error went in, even if nobody tapped "In". */
export const serves = (s: Stat, served = 0) => Math.max(serveAttempts(s), served);
export const serveInPct = (s: Stat, served = 0) => ratio(serves(s, served) - serveErrors(s), serves(s, served));
export const aceErrorRatio = (s: Stat) => ratio(s.SA, serveErrors(s));
/** (aces − errors) ÷ attempts, the serving version of hitting %. */
export const serveEfficiency = (s: Stat, served = 0) => ratio(s.SA - serveErrors(s), serves(s, served));
/** Points a player directly produced. */
export const pointsWon = (s: Stat) => s.K + s.SA + s.BS + s.BA / 2;
/** Points a player directly gave away. */
export const errorsGiven = (s: Stat) => s.AE + serveErrors(s) + s.P0 + s.BE + s.BHE + s.DE + miscErrors(s);
/** Points won minus errors given: a simple all-around rating. */
export const netPoints = (s: Stat) => pointsWon(s) - errorsGiven(s);

export function teamErrorsGiven(A: Agg) { return errorsGiven(A.T) + A.team.CE + A.team.EE + A.team.PE; }

/* ---------- system and transition ---------- */
const sumCtx = (A: Agg, keys: AttackContext[]) => {
  const o = { K: 0, E: 0, TA: 0 };
  for (const k of keys) { const c = A.ctx[k]; if (c) { o.K += c.team.K; o.E += c.team.E; o.TA += c.team.TA; } }
  return o;
};
export const inSystem = (A: Agg) => sumCtx(A, ["P3", "P2"]);
export const outOfSystem = (A: Agg) => sumCtx(A, ["P1"]);
export const transition = (A: Agg) => sumCtx(A, ["DIG", "FREE"]);
const hitCtx = (o: { K: number; E: number; TA: number }) => ratio(o.K - o.E, o.TA);

/** Share of recorded attacks that came off a good (2 or 3) pass. */
export function inSystemPct(A: Agg) {
  const i = inSystem(A).TA, all = sumCtx(A, ["P3", "P2", "P1", "DIG", "FREE"]).TA;
  return ratio(i, all);
}

/** Opponent attacks we can count: their kills + our digs + our dig errors. */
/** Digs ÷ attacks we had a chance at (digs, dig errors, their kills). Nothing when digs aren't being tracked at all. */
export function digSuccess(A: Agg) { const T = A.T; return T.D + T.DE ? ratio(T.D, T.D + T.DE + A.team.OK) : null; }

export interface TeamMetrics {
  hitting: number | null; killPct: number | null; errPct: number | null;
  sideOut: number | null; firstBallSO: number | null; pointScoring: number | null;
  passAvg: number | null; perfectPass: number | null; goodPass: number | null;
  serveIn: number | null; serveEff: number | null; aceErr: number | null;
  inSystemPct: number | null; hitInSystem: number | null; hitOutOfSystem: number | null; hitTransition: number | null;
  digSuccess: number | null; freeBallWin: number | null;
  soByPass: Record<"P3" | "P2" | "P1" | "P0", number | null>;
  perSet: { K: number; SA: number; BLK: number; D: number; AST: number; errors: number } | null;
  freePoints: { theirs: number; ours: number };
}

export function teamMetrics(A: Agg): TeamMetrics {
  const T = A.T, sets = A.sets || 0;
  const per = (n: number) => (sets ? n / sets : 0);
  return {
    hitting: hitting(T), killPct: killPct(T), errPct: attackErrPct(T),
    sideOut: ratio(A.so.w, A.so.n), firstBallSO: ratio(A.fbso.w, A.fbso.n), pointScoring: ratio(A.psc.w, A.psc.n),
    passAvg: passAvg(T), perfectPass: perfectPassPct(T), goodPass: goodPassPct(T),
    serveIn: serveInPct(T, A.psc.n), serveEff: serveEfficiency(T, A.psc.n), aceErr: aceErrorRatio(T),
    inSystemPct: inSystemPct(A), hitInSystem: hitCtx(inSystem(A)), hitOutOfSystem: hitCtx(outOfSystem(A)), hitTransition: hitCtx(transition(A)),
    digSuccess: digSuccess(A), freeBallWin: ratio(A.fbr.w, A.fbr.n),
    soByPass: { P3: ratio(A.soByPass.P3.w, A.soByPass.P3.n), P2: ratio(A.soByPass.P2.w, A.soByPass.P2.n), P1: ratio(A.soByPass.P1.w, A.soByPass.P1.n), P0: ratio(A.soByPass.P0.w, A.soByPass.P0.n) },
    perSet: sets ? { K: per(T.K), SA: per(T.SA), BLK: per(blocks(T)), D: per(T.D), AST: per(T.AST), errors: per(teamErrorsGiven(A)) } : null,
    freePoints: { theirs: A.team.OE, ours: teamErrorsGiven(A) },
  };
}

export interface PlayerMetrics {
  sets: number; hitting: number | null; killPct: number | null; kps: number | null; dps: number | null; aps: number | null; bps: number | null; acesPs: number | null;
  passAvg: number | null; perfectPass: number | null; serveIn: number | null; serveEff: number | null; aceErr: number | null;
  plusMinus: number | null; netPoints: number; netPerSet: number | null;
}
export function playerMetrics(A: Agg, id: string): PlayerMetrics {
  const s = A.ps[id], sets = A.setsPlayed[id] || 0, pm = A.pm[id];
  const per = (n: number) => (sets ? n / sets : null);
  if (!s) return { sets, hitting: null, killPct: null, kps: null, dps: null, aps: null, bps: null, acesPs: null, passAvg: null, perfectPass: null, serveIn: null, serveEff: null, aceErr: null, plusMinus: pm ? pm.w - pm.l : null, netPoints: 0, netPerSet: null };
  return {
    sets, hitting: hitting(s), killPct: killPct(s), kps: per(s.K), dps: per(s.D), aps: per(s.AST), bps: per(blocks(s)), acesPs: per(s.SA),
    passAvg: passAvg(s), perfectPass: perfectPassPct(s), serveIn: serveInPct(s, A.srv[id]?.n), serveEff: serveEfficiency(s, A.srv[id]?.n), aceErr: aceErrorRatio(s),
    plusMinus: pm ? pm.w - pm.l : null, netPoints: netPoints(s), netPerSet: per(netPoints(s)),
  };
}

/* ---------- formatting ---------- */
export const fmtHit = (v: number | null) => (v == null ? "—" : (v < -0.0005 ? "−" : "") + Math.abs(v).toFixed(3).replace(/^0/, ""));
export const fmtPct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
export const fmtAvg = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));
export const fmtNum = (v: number | null, d = 1) => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(d));
export const fmtSigned = (v: number | null) => (v == null ? "—" : v > 0 ? "+" + v : v < 0 ? "−" + Math.abs(v) : "0");
export const fmtRatio = (v: number | null) => (v == null ? "—" : v.toFixed(1) + " : 1");
