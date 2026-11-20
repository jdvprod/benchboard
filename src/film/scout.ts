/** Scouting an opponent from their film: a few buttons per jersey number (kill, hitting error, ace, serve error, block, dig, other error). */
import type { OppFilm, ScoutEv } from "../data/model";

export const SCOUT_CODES: { t: ScoutEv["t"]; label: string; key: string; long: string }[] = [
  { t: "K", label: "Kill", key: "k", long: "kill" },
  { t: "TA", label: "Attack in play", key: "t", long: "attack kept in play" },
  { t: "AE", label: "Hit error", key: "e", long: "hitting error" },
  { t: "SA", label: "Ace", key: "a", long: "ace" },
  { t: "SE", label: "Serve error", key: "s", long: "serve error" },
  { t: "B", label: "Block", key: "b", long: "block" },
  { t: "D", label: "Dig", key: "d", long: "dig" },
  { t: "E", label: "Other error", key: "x", long: "error" },
];
export const scoutLong = (t: ScoutEv["t"]) => SCOUT_CODES.find((c) => c.t === t)?.long || t;

export type ScoutLine = { n: string; K: number; TA: number; AE: number; SA: number; SE: number; B: number; D: number; E: number; total: number };
/** Totals by jersey number across one or more films, most dangerous first (kills + aces + blocks). */
export function scoutTotals(films: OppFilm[]): ScoutLine[] {
  const by = new Map<string, ScoutLine>();
  for (const f of films) for (const e of f.evs) {
    const n = e.n || "?";
    const x = by.get(n) || { n, K: 0, TA: 0, AE: 0, SA: 0, SE: 0, B: 0, D: 0, E: 0, total: 0 };
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

/** Attacks: kills, attacks kept in play and hitting errors. Hitting % = (K − E) / attempts. */
export const attacks = (x: ScoutLine) => x.K + x.TA + x.AE;
export const scoutHitting = (x: ScoutLine) => (attacks(x) ? (x.K - x.AE) / attacks(x) : null);

/** Clip search over scouting film in plain words: "every attack by #12", "their blocks", "#7 kills", "aces from 3".
 * Returns which play codes and jersey numbers to show (null codes = any play; empty nums = any player). Pure. */
export function parseScoutQuery(text: string): { codes: ScoutEv["t"][] | null; nums: string[]; label: string } {
  let s = " " + text.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9# ]+/g, " ").replace(/\s+/g, " ") + " ";
  const nums: string[] = [];
  s = s.replace(/(?:#|\bnumber |\bno |\bby |\bfrom |\bplayer )(\d{1,2})\b/g, (_, n) => { nums.push(n); return " "; });
  s = s.replace(/\b(\d{1,2})\b/g, (_, n) => { nums.push(n); return " "; });
  const W: [RegExp, ScoutEv["t"][], string][] = [
    [/\b(hitting|hit|attack|swing) errors?\b|\bhitting mistakes?\b|\bhit out\b/, ["AE"], "hitting errors"],
    [/\b(in play|kept in play|dug|covered)\b/, ["TA"], "attacks kept in play"],
    [/\bkills?\b|\bput ?aways?\b|\bpoints? on attack\b/, ["K"], "kills"],
    [/\battacks?\b|\bswings?\b|\bhits\b|\bhitting\b|\battempts?\b|\bspikes?\b|\bshots?\b/, ["K", "TA", "AE"], "attacks"],
    [/\bserve errors?\b|\bmissed serves?\b|\bserving errors?\b/, ["SE"], "serve errors"],
    [/\baces?\b/, ["SA"], "aces"],
    [/\bserves?\b|\bserving\b/, ["SA", "SE"], "serves"],
    [/\bblocks?\b|\bblocking\b|\bstuffs?\b|\broofs?\b/, ["B"], "blocks"],
    [/\bdigs?\b|\bdefen[cs]e\b|\bdigging\b/, ["D"], "digs"],
    [/\berrors?\b|\bmistakes?\b/, ["AE", "SE", "E"], "errors"],
  ];
  const codes = new Set<ScoutEv["t"]>(), words: string[] = [];
  for (const [re, c, w] of W) if (re.test(s)) { c.forEach((x) => codes.add(x)); words.push(w); s = s.replace(new RegExp(re.source, "g"), " "); }
  const who = nums.length ? nums.map((n) => "#" + n).join(" and ") + "'s " : "";
  const label = codes.size ? (who + words.join(" and ")).replace(/^./, (c) => c.toUpperCase()) : nums.length ? `Every play by ${nums.map((n) => "#" + n).join(" and ")}` : "Every play";
  return { codes: codes.size ? [...codes] : null, nums: [...new Set(nums)], label };
}
