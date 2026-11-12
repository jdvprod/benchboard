/** Every stat a coach can pick from: one list feeds the stat dropdown, the "choose your stats" table and its printout. */
import { Agg, Stat } from "../../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, fmtSigned, hitting, killPct, miscErrors, netPoints, passAvg, perfectPassPct, ratio, serveErrors } from "../../sports/volleyball/metrics";

/** What one row of numbers is about: the team, or one player, over some sets. */
export interface Subject { s: Stat; served: number; sets: number; pm?: { w: number; l: number } }
export type Fmt = "int" | "hit" | "pct" | "avg" | "dec" | "signed";
export interface StatDef { key: string; label: string; short: string; group: string; fmt: Fmt; get: (x: Subject) => number | null; lowIsGood?: boolean; desc?: string }

const per = (n: number, x: Subject) => (x.sets ? n / x.sets : null);
/** Every error that hands the other team a point. Attack errors include blocked attacks. */
export const totalErrors = (s: Stat) => s.AE + serveErrors(s) + s.P0 + s.BHE + s.DE + s.BE + miscErrors(s);
const servesIn = (s: Stat, served: number) => Math.max(s.SI || 0, served - (s.SA || 0) - serveErrors(s));

export const STATS: StatDef[] = [
  { key: "K", label: "Kills", short: "K", group: "Attack", fmt: "int", get: ({ s }) => s.K },
  { key: "TA", label: "Attack attempts", short: "TA", group: "Attack", fmt: "int", get: ({ s }) => s.TA },
  { key: "AE", label: "Attack errors", short: "AE", group: "Attack", fmt: "int", get: ({ s }) => s.AE, lowIsGood: true, desc: "Includes blocked attacks" },
  { key: "AB", label: "Blocked attacks", short: "Blk'd", group: "Attack", fmt: "int", get: ({ s }) => s.AB, lowIsGood: true },
  { key: "KT", label: "Tools (kills off the block)", short: "Tool", group: "Attack", fmt: "int", get: ({ s }) => s.KT },
  { key: "hit", label: "Hitting %", short: "Hit %", group: "Attack", fmt: "hit", get: ({ s }) => hitting(s) },
  { key: "kp", label: "Kill %", short: "Kill %", group: "Attack", fmt: "pct", get: ({ s }) => killPct(s) },
  { key: "kps", label: "Kills per set", short: "K/S", group: "Attack", fmt: "dec", get: (x) => per(x.s.K, x) },

  { key: "SV", label: "Serves", short: "Srv", group: "Serve", fmt: "int", get: ({ s, served }) => s.SA + servesIn(s, served) + serveErrors(s) },
  { key: "SA", label: "Aces", short: "Ace", group: "Serve", fmt: "int", get: ({ s }) => s.SA },
  { key: "SIN", label: "Serves in", short: "In", group: "Serve", fmt: "int", get: ({ s, served }) => servesIn(s, served) },
  { key: "SERR", label: "Serve errors", short: "SE", group: "Serve", fmt: "int", get: ({ s }) => serveErrors(s), lowIsGood: true },
  { key: "SEN", label: "Serve errors in the net", short: "Net", group: "Serve", fmt: "int", get: ({ s }) => s.SEN, lowIsGood: true },
  { key: "SEO", label: "Serve errors out", short: "Out", group: "Serve", fmt: "int", get: ({ s }) => s.SEO + s.SE, lowIsGood: true },
  { key: "sip", label: "Serve in %", short: "In %", group: "Serve", fmt: "pct", get: ({ s, served }) => ratio(s.SA + servesIn(s, served), s.SA + servesIn(s, served) + serveErrors(s)) },
  { key: "aps", label: "Aces per set", short: "Ace/S", group: "Serve", fmt: "dec", get: (x) => per(x.s.SA, x) },

  { key: "R", label: "Receptions", short: "Rec", group: "Receive", fmt: "int", get: ({ s }) => s.R },
  { key: "pavg", label: "Pass average (0–3)", short: "Pass", group: "Receive", fmt: "avg", get: ({ s }) => passAvg(s) },
  { key: "pp", label: "Perfect pass %", short: "3s %", group: "Receive", fmt: "pct", get: ({ s }) => perfectPassPct(s) },
  { key: "R3", label: "3 passes", short: "3s", group: "Receive", fmt: "int", get: ({ s }) => s.R3 },
  { key: "P0", label: "Reception errors (0s)", short: "0s", group: "Receive", fmt: "int", get: ({ s }) => s.P0, lowIsGood: true },

  { key: "AST", label: "Assists", short: "Ast", group: "Set", fmt: "int", get: ({ s }) => s.AST },
  { key: "SATT", label: "Set attempts", short: "Set att", group: "Set", fmt: "int", get: ({ s }) => s.SATT },
  { key: "BHE", label: "Ball-handling errors", short: "BHE", group: "Set", fmt: "int", get: ({ s }) => s.BHE, lowIsGood: true },
  { key: "asps", label: "Assists per set", short: "Ast/S", group: "Set", fmt: "dec", get: (x) => per(x.s.AST, x) },

  { key: "D", label: "Digs", short: "Dig", group: "Defense", fmt: "int", get: ({ s }) => s.D },
  { key: "DE", label: "Dig errors", short: "Dig E", group: "Defense", fmt: "int", get: ({ s }) => s.DE, lowIsGood: true },
  { key: "dps", label: "Digs per set", short: "Dig/S", group: "Defense", fmt: "dec", get: (x) => per(x.s.D, x) },

  { key: "BLK", label: "Total blocks", short: "Blk", group: "Block", fmt: "dec", get: ({ s }) => blocks(s), desc: "Solos plus half of each assist" },
  { key: "BS", label: "Solo blocks", short: "Solo", group: "Block", fmt: "int", get: ({ s }) => s.BS },
  { key: "BA", label: "Block assists", short: "B Ast", group: "Block", fmt: "int", get: ({ s }) => s.BA },
  { key: "BT", label: "Block touches", short: "Touch", group: "Block", fmt: "int", get: ({ s }) => s.BT || 0 },
  { key: "BE", label: "Block / net errors", short: "Blk E", group: "Block", fmt: "int", get: ({ s }) => s.BE, lowIsGood: true },
  { key: "bps", label: "Blocks per set", short: "Blk/S", group: "Block", fmt: "dec", get: (x) => per(blocks(x.s), x) },

  { key: "ERR", label: "Total errors", short: "Errors", group: "Errors", fmt: "int", get: ({ s }) => totalErrors(s), lowIsGood: true, desc: "Every error that gave them a point" },
  { key: "eps", label: "Errors per set", short: "Err/S", group: "Errors", fmt: "dec", get: (x) => per(totalErrors(x.s), x), lowIsGood: true },
  { key: "CE", label: "Communication errors", short: "Comm", group: "Errors", fmt: "int", get: ({ s }) => s.CE, lowIsGood: true },
  { key: "EE", label: "Effort errors", short: "Effort", group: "Errors", fmt: "int", get: ({ s }) => s.EE, lowIsGood: true },
  { key: "PE", label: "Positioning errors", short: "Pos", group: "Errors", fmt: "int", get: ({ s }) => s.PE, lowIsGood: true },

  { key: "np", label: "Net points", short: "Net pts", group: "Overall", fmt: "signed", get: ({ s }) => netPoints(s), desc: "Kills, aces and blocks minus errors" },
  { key: "pmn", label: "Plus / minus", short: "+/−", group: "Overall", fmt: "signed", get: ({ pm }) => (pm ? pm.w - pm.l : null), desc: "Rallies won minus lost while on court" },
  { key: "sets", label: "Sets played", short: "Sets", group: "Overall", fmt: "int", get: ({ sets }) => sets },
];
export const STAT = Object.fromEntries(STATS.map((d) => [d.key, d])) as Record<string, StatDef>;
export const GROUPS = [...new Set(STATS.map((d) => d.group))];

export function fmtStat(d: StatDef, v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  switch (d.fmt) {
    case "hit": return fmtHit(v); case "pct": return fmtPct(v); case "avg": return fmtAvg(v); case "dec": return fmtNum(v, 2); case "signed": return fmtSigned(v);
    default: return String(Math.round(v * 10) / 10);
  }
}

const Z = {} as Stat;
export const teamSubject = (A: Agg): Subject => ({ s: A.T, served: A.psc.n, sets: A.sets });
export const playerSubject = (A: Agg, id: string): Subject => ({ s: A.ps[id] || Z, served: A.srv[id]?.n || 0, sets: A.setsPlayed[id] || 0, pm: A.pm[id] });

/** Ready-made picks so a coach starts from something sensible. */
export const PRESETS: [string, string, string[]][] = [
  ["box", "Box score", ["K", "AE", "TA", "hit", "AST", "SA", "SERR", "D", "BLK", "R", "pavg"]],
  ["hitters", "Hitters", ["K", "AE", "TA", "hit", "kp", "kps", "AB", "KT"]],
  ["servepass", "Serve and pass", ["SV", "SA", "SERR", "sip", "R", "pavg", "pp", "P0"]],
  ["defense", "Defense and blocking", ["D", "DE", "dps", "BS", "BA", "BT", "BE", "BLK"]],
  ["errors", "Errors", ["AE", "SERR", "P0", "BHE", "DE", "BE", "CE", "ERR", "eps"]],
];
