/** Paste a pool schedule instead of typing it: copied from a tournament's site or app, a photo's text, or a coach's
 *  own shorthand ("8am ct 4 vs Rivals", "9 work"). Pulls out times, courts, the two teams and who works each match.
 *  Nothing is fetched: it only reads the text the coach pasted. */
import { TGame, TOther } from "./model";

export interface PastedLine { raw: string; time?: string; court?: string; a?: string; b?: string; work?: string; selfWork?: boolean; round?: string; pool?: string }
export interface Pasted { lines: PastedLine[]; teams: string[]; pool?: string }

const TIME_AP = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?(?![a-z])/i;
const TIME_24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const TIME_BARE = /^\s*(\d{1,2})(?::(\d{2}))?(?=\s|$)/;  // coach shorthand: "9 work", "10:30 vs X"
const COURT = /\b(?:court|ct|crt)\.?\s*#?\s*([A-Za-z]?\d{1,3}[A-Za-z]?)\b/i;
const POOL = /\bpool\s+([A-Za-z0-9]{1,4})\b/i;
const WORK = /(?:^|\s|\|)(?:(?:work(?:ing)?(?:\s+team)?|refs?|reffing|refing)\s*[:\-–]|(?:w|wt|w\/t)\s*:)\s*(.+?)\s*$/i;
const SELF_WORK = /^(?:we\s+)?(?:work|working|ref|reffing|refs|w)\b\.?\s*$/i;
const ROUND = /\b(gold|silver|bronze|platinum|crossover|quarter-?finals?|semi-?finals?|finals?|championship|bracket|qf|sf)\b/i;
const VS = /\s+(?:vs\.?|v\.?|versus|@|-vs-)\s+/i;
const MATCH_NO = /^\s*(?:match|m|game|g|#)\s*\d+\s*[:.)\-]?\s*|^\s*\d+\s*[.)]\s+/i;

const hhmm = (h: number, m: number) => String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
/** Team names compare without case, region codes in brackets, punctuation or extra spaces. */
export const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const clean = (s: string) => s.replace(/[|\t]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, "").trim();

function readTime(s: string): { time?: string; rest: string } {
  let m = TIME_AP.exec(s);
  if (m) { let h = +m[1] % 12; if (m[3].toLowerCase() === "p") h += 12; return { time: hhmm(h, +(m[2] || 0)), rest: s.replace(m[0], " ") }; }
  m = TIME_24.exec(s);
  if (m) { let h = +m[1]; if (h >= 1 && h <= 6) h += 12; return { time: hhmm(h, +m[2]), rest: s.replace(m[0], " ") }; }
  m = TIME_BARE.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) { let h = +m[1]; if (h <= 6) h += 12; return { time: hhmm(h, +(m[2] || 0)), rest: s.replace(m[0], " ") }; }
  return { rest: s };
}

export function parsePaste(text: string): Pasted {
  const lines: PastedLine[] = [], seen = new Map<string, string>();
  let pool: string | undefined, court: string | undefined;
  const team = (x: string) => { const n = norm(x); if (!n) return ""; if (!seen.has(n)) seen.set(n, x); return seen.get(n)!; };
  for (const raw0 of text.split(/\r?\n/)) {
    const raw = raw0.replace(/\t/g, " | ").trim();
    if (!raw) continue;
    let s = raw;
    const p = POOL.exec(s); if (p) { pool = "Pool " + p[1].toUpperCase(); s = s.replace(p[0], " "); }
    const c = COURT.exec(s); const lineCourt = c ? c[1].toUpperCase() : undefined; if (c) { s = s.replace(c[0], " "); court = lineCourt; }  // a court carries down to the lines below
    const t = readTime(s); s = t.rest;
    const rw = s.match(new RegExp(ROUND.source, "gi")); const round = rw ? rw.map((x) => x.replace(/\b\w/g, (y) => y.toUpperCase())).join(" ") : undefined;
    let work: string | undefined, selfWork = false;
    const w = WORK.exec(s); if (w) { work = clean(w[1]); s = s.slice(0, w.index); }
    // copied tables: columns, no "vs" (team, team, work team)
    let cells: string[] = [];
    if (s.includes("|") && !VS.test(" " + s + " ")) cells = s.split("|").map((x) => clean(x.replace(MATCH_NO, " "))).filter((x) => x && !/^\d+$/.test(x));
    s = clean(s.replace(MATCH_NO, " "));
    if (SELF_WORK.test(s)) { selfWork = true; s = ""; }
    if (cells.length >= 2) { s = cells[0] + " vs " + cells[1]; if (cells[2] && !work) work = cells[2]; }
    // a header line ("Pool 3 - Court 12") sets the court for the lines below it
    if (!t.time && !VS.test(" " + s + " ") && !work && !selfWork) { if (lineCourt) court = lineCourt; continue; }
    let a: string | undefined, b: string | undefined;
    const parts = (" " + s + " ").split(VS).map(clean);
    if (parts.length === 2) { const left = clean(parts[0].replace(new RegExp(ROUND.source, "gi"), " ")); a = left ? team(left) || undefined : undefined; b = team(parts[1]) || undefined; }
    if (work) work = team(work);
    if (!a && !b && !work && !selfWork) continue;
    lines.push({ raw: raw0.trim(), time: t.time, court, a, b, work, selfWork, round, pool });
  }
  return { lines, teams: [...seen.values()], pool };
}

/** Which pasted team is ours: the one sharing the most words with our team's name. */
export function guessUs(teams: string[], name: string): string | null {
  const ours = new Set(norm(name).split(" ").filter((w) => w.length > 1));
  let best: string | null = null, score = 0;
  for (const t of teams) { const n = norm(t); if (n === norm(name)) return t; const sc = n.split(" ").filter((w) => ours.has(w)).length; if (sc > score) { best = t; score = sc; } }
  return best;
}

/** Turn the pasted lines into our games (matches and work), the other pool matches, and the pool's teams. */
export function gamesFrom(p: Pasted, us: string | null, def: { bestOf: number; scoring: string }, id: () => string): { games: TGame[]; others: TOther[]; poolTeams: string[] } {
  const me = us ? norm(us) : "";
  const games: TGame[] = [], others: TOther[] = [];
  for (const l of p.lines) {
    const isA = !!me && !!l.a && norm(l.a) === me, isB = !!me && !!l.b && norm(l.b) === me;
    const base = { id: id(), time: l.time, court: l.court, bestOf: def.bestOf, scoring: def.scoring };
    if (isA || isB || (!l.a && l.b && !l.work)) {
      const opp = isA ? l.b! : isB ? l.a! : l.b!;
      games.push(l.round ? { ...base, stage: "bracket", round: l.round, opp } : { ...base, stage: "pool", opp });
    } else if (l.selfWork || (me && l.work && norm(l.work) === me)) {
      games.push({ ...base, stage: "work", opp: l.a && l.b ? `${l.a} vs ${l.b}` : "" });
    } else if (l.a && l.b && !l.round) others.push({ id: id(), a: l.a, b: l.b, sets: [] });
  }
  const poolTeams = p.teams.filter((t) => norm(t) !== me);
  return { games, others, poolTeams };
}
