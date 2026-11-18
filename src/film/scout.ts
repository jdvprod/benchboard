/** Scouting an opponent from their film: a few buttons per jersey number (kill, hitting error, ace, serve error, block, dig, other error). */
import type { OppFilm, ScoutEv } from "../data/model";

export const SCOUT_CODES: { t: ScoutEv["t"]; label: string; key: string; long: string }[] = [
  { t: "K", label: "Kill", key: "k", long: "kill" },
  { t: "AE", label: "Hit error", key: "e", long: "hitting error" },
  { t: "SA", label: "Ace", key: "a", long: "ace" },
  { t: "SE", label: "Serve error", key: "s", long: "serve error" },
  { t: "B", label: "Block", key: "b", long: "block" },
  { t: "D", label: "Dig", key: "d", long: "dig" },
  { t: "E", label: "Other error", key: "x", long: "error" },
];
export const scoutLong = (t: ScoutEv["t"]) => SCOUT_CODES.find((c) => c.t === t)?.long || t;

export type ScoutLine = { n: string; K: number; AE: number; SA: number; SE: number; B: number; D: number; E: number; total: number };
/** Totals by jersey number across one or more films, most dangerous first (kills + aces + blocks). */
export function scoutTotals(films: OppFilm[]): ScoutLine[] {
  const by = new Map<string, ScoutLine>();
  for (const f of films) for (const e of f.evs) {
    const n = e.n || "?";
    const x = by.get(n) || { n, K: 0, AE: 0, SA: 0, SE: 0, B: 0, D: 0, E: 0, total: 0 };
    x[e.t]++; x.total++; by.set(n, x);
  }
  return [...by.values()].sort((a, b) => b.K + b.SA + b.B - (a.K + a.SA + a.B) || b.total - a.total || (+a.n || 999) - (+b.n || 999));
}
/** A short scouting line for one player: "12 kills, 3 aces, 5 errors". */
export function scoutLine(x: ScoutLine): string {
  const parts: string[] = [];
  const add = (v: number, one: string, many = one + "s") => { if (v) parts.push(`${v} ${v === 1 ? one : many}`); };
  add(x.K, "kill"); add(x.SA, "ace"); add(x.B, "block"); add(x.D, "dig"); add(x.AE + x.SE + x.E, "error");
  return parts.join(", ") || "nothing yet";
}
/** Numbers to offer as buttons: the roster's, then any already used, in number order. */
export function scoutNumbers(roster: Record<string, unknown> | undefined, films: OppFilm[]): string[] {
  const s = new Set<string>([...Object.keys(roster || {}), ...films.flatMap((f) => f.evs.map((e) => e.n)).filter(Boolean)]);
  return [...s].sort((a, b) => (+a || 999) - (+b || 999));
}
