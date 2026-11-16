/** Season film search: one question across every match that has film ("Maya's kills vs Buchanan", "aces in the last
 * 3 matches"). The words about which matches are read here; the words about which plays go to parseQuery.
 * Pure and unit tested. */
import type { LogEntry } from "../sports/volleyball/engine";
import { ClipQuery, matchQuery } from "./query";

export interface Scope { opps: string[]; last: number | null; since: string | null; chips: string[] }
export interface LibMatch { id: string; date: string; opp: string; log: LogEntry[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Pull the match words out of a question. `today` is YYYY-MM-DD; `opps` are the opponent names on file. */
export function parseScope(text: string, opps: string[], today: string): { scope: Scope; rest: string } {
  let s = " " + text + " ";
  const scope: Scope = { opps: [], last: null, since: null, chips: [] };
  // "last 3 matches", "past five games", "last match"
  s = s.replace(/\b(?:in |from |over )?(?:the )?(?:last|past|previous) (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)? ?(?:matches|games|match|game)\b/i, (_, n) => {
    const k = n ? (/^\d+$/.test(n) ? +n : WORDS[n.toLowerCase()]) : 1; scope.last = Math.max(1, k); scope.chips.push(k === 1 ? "Last match" : `Last ${k} matches`); return " ";
  });
  // "this month", "this week", "since October 3"
  s = s.replace(/\bthis (week|month)\b/i, (_, w) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() - (w.toLowerCase() === "week" ? 7 : 31)); scope.since = d.toISOString().slice(0, 10); scope.chips.push("This " + w.toLowerCase()); return " "; });
  // "vs Buchanan", "against Clovis West", "versus …", or just the opponent's name
  const byLen = [...new Set(opps.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const o of byLen) {
    const n = norm(o); if (n.length < 3) continue;
    const re = new RegExp(`(?:\\b(?:vs\\.?|v\\.?|versus|against|playing|from)\\s+)?\\b${n.replace(/ /g, "[^a-z0-9]+")}\\b`, "i");
    if (re.test(s)) { scope.opps.push(o); scope.chips.push("vs " + o); s = s.replace(new RegExp(re.source, "ig"), " "); }
  }
  // "vs Someone" we have no match against still narrows the search (to nothing, which is the honest answer)
  s = s.replace(/\b(?:vs\.?|versus|against)\s+([a-z0-9][a-z0-9 .'&-]{1,40}?)(?=\s+(?:in|on|at|from|last|past|this|during|when|while|off|to)\b|\s*$)/i, (_, name) => { const o = name.trim(); scope.opps.push(o); scope.chips.push("vs " + o); return " "; });
  s = s.replace(/\b(?:this|all|whole|entire) season\b|\ball (?:our |my )?(?:film|matches|games)\b/i, " ");
  return { scope, rest: s.replace(/\s+/g, " ").trim() };
}

/** Which matches the scope keeps, newest first. */
export function inScope<M extends { date: string; opp: string }>(ms: M[], sc: Scope): M[] {
  let out = ms.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (sc.opps.length) { const want = sc.opps.map(norm).filter(Boolean); out = out.filter((m) => { const o = norm(m.opp); return want.some((w) => o === w || (w.length >= 3 && (o.startsWith(w + " ") || o.includes(" " + w)))); }); }
  if (sc.since) out = out.filter((m) => m.date >= sc.since!);
  if (sc.last) out = out.slice(0, sc.last);
  return out;
}

/** Plays that match, grouped by match, newest match first. */
export function searchSeason(ms: LibMatch[], q: ClipQuery, sc: Scope): { m: LibMatch; rows: LogEntry[] }[] {
  return inScope(ms, sc).map((m) => ({ m, rows: m.log.filter((l) => matchQuery(q, l)) })).filter((g) => g.rows.length);
}

/** Their players against us, across matches: kills, aces and where the kills went. For scouting before a rematch. */
export interface Hitter { num: string; kills: number; aces: number; zones: Record<number, number>; topZone: number | null; matches: number }
export function scoutHitters(logs: LogEntry[][]): Hitter[] {
  const by = new Map<string, Hitter & { seen: Set<number> }>();
  logs.forEach((log, mi) => { for (const l of log) {
    if (l.kind !== "stat" || !l.op || (l.t !== "OK" && l.t !== "OA")) continue;
    const h = by.get(l.op) || { num: l.op, kills: 0, aces: 0, zones: {}, topZone: null, matches: 0, seen: new Set<number>() };
    if (l.t === "OK") { h.kills++; if (typeof l.z === "number") h.zones[l.z] = (h.zones[l.z] || 0) + 1; } else h.aces++;
    h.seen.add(mi); by.set(l.op, h);
  } });
  return [...by.values()].map(({ seen, ...h }) => { const z = Object.entries(h.zones).sort((a, b) => b[1] - a[1])[0]; return { ...h, matches: seen.size, topZone: z && z[1] >= 2 ? +z[0] : null }; })
    .sort((a, b) => b.kills + b.aces - (a.kills + a.aces) || +a.num - +b.num);
}
