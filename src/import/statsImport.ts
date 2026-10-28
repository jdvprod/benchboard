/** Bringing stats in from other apps. Hudl and SoloStats export MaxPreps import files (pipe-delimited .txt, one match per file);
 * MaxPreps, GameChanger-style and hand-made spreadsheets come as CSV, tab-separated or Excel. Columns are matched by meaning,
 * so "K", "Kills" and "AttackKills" all land on kills; the coach can fix any guess before importing.
 * Imported numbers become stats-only plays (they count for players, never change a score) plus each set's final score,
 * so rally-based numbers (side-out, rotations, runs) are never invented. Pure functions: unit tested. */

export type Field = "ignore" | "num" | "name" | "first" | "last" | "pos" | "date" | "opp" | "score" | "SP"
  | "K" | "AE" | "TA" | "SA" | "SE" | "SERV" | "RTOT" | "RGOOD" | "RE" | "PAVG" | "R3" | "R2" | "R1" | "R0"
  | "D" | "DE" | "BS" | "BA" | "BE" | "AST" | "BHE" | "BHA";

export const FIELD_LABEL: Record<Field, string> = {
  ignore: "Leave out", num: "Jersey number", name: "Player name", first: "First name", last: "Last name", pos: "Position", date: "Date", opp: "Opponent", score: "Score / set scores",
  SP: "Sets played", K: "Kills", AE: "Attack errors", TA: "Attack attempts (total)", SA: "Aces", SE: "Serve errors", SERV: "Serve attempts (total)",
  RTOT: "Receptions (total)", RGOOD: "Good receptions", RE: "Reception errors", PAVG: "Pass average", R3: "3 passes", R2: "2 passes", R1: "1 passes", R0: "0 passes (aced)",
  D: "Digs", DE: "Dig errors", BS: "Solo blocks", BA: "Block assists", BE: "Block errors", AST: "Assists", BHE: "Ball-handling errors", BHA: "Ball-handling attempts",
};
export const FIELDS = Object.keys(FIELD_LABEL) as Field[];

/* ---------- reading tables ---------- */
export interface Table { kind: "maxpreps" | "csv" | "tsv" | "xlsx"; header: string[]; rows: string[][]; skipped: number }

function splitCsv(text: string, sep: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"' && !cell) q = true; else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}
const isNum = (c: string) => /^-?\d+(\.\d+)?%?$/.test(c.trim()) || /^\.\d+$/.test(c.trim());
const looksHeader = (r: string[]) => { const f = r.filter((c) => c); return f.length >= 3 && f.filter((c) => !isNum(c)).length / f.length >= 0.6; };

/** Picks the header row (skipping titles, supplier-ID lines and group rows like "Serving | Attacking") and the data rows under it. */
export function toTable(grid: string[][], kind: Table["kind"]): Table {
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 8); i++) {
    if (!looksHeader(grid[i])) continue;
    // a group row ("Serving", "", "", "Attacking"…) is followed by another header row: prefer the lower one
    if (i + 1 < grid.length && looksHeader(grid[i + 1]) && grid[i + 1].filter((c) => c).length > grid[i].filter((c) => c).length) continue;
    h = i; break;
  }
  if (h < 0) return { kind, header: [], rows: [], skipped: grid.length };
  const header = grid[h].map((c) => c.trim());
  const rows: string[][] = []; let skipped = 0;
  for (const r of grid.slice(h + 1)) {
    const first = (r[0] || "").trim(), joined = r.join(" ").toLowerCase();
    // team totals and opponent lines aren't players
    if ((!first && r.slice(1).some((c) => c)) || /^(team|totals?|opponent|opp\.?)\b/i.test(first) || /\b(team totals?|totals)\b/.test(joined.slice(0, 40)) && !/\d{1,3}/.test(first)) { skipped++; continue; }
    rows.push(header.map((_, i) => (r[i] ?? "").trim()));
  }
  return { kind, header, rows, skipped };
}

export function readText(text: string): Table {
  const t = text.replace(/^﻿/, "");
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const pipes = lines.filter((l) => l.includes("|")).length;
  if (pipes >= 2 && pipes >= lines.length * 0.5) return toTable(lines.filter((l) => l.includes("|")).map((l) => l.split("|").map((c) => c.trim())), "maxpreps");
  const tabs = (t.match(/\t/g) || []).length, commas = (t.match(/,/g) || []).length, semis = (t.match(/;/g) || []).length;
  const sep = tabs > commas && tabs >= semis ? "\t" : semis > commas ? ";" : ",";
  return toTable(splitCsv(t, sep), sep === "\t" ? "tsv" : "csv");
}

/* ---------- matching columns ---------- */
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9#%]/g, "");
/** Per-game, per-set, percentages and efficiencies are derived numbers: never imported. */
const derived = (n: string) => /(pergame|perset|permatch|pct|percent|%|avg|average|eff|efficiency|ratio|rating|pg$|ps$)/.test(n) && !/^(passavg|passaverage|passrating|sravg|pa|receptionavg|receiveavg)$/.test(n);
const has = (n: string, ...w: string[]) => w.some((x) => n.includes(x));

export function guessField(header: string, all: string[]): Field {
  const n = norm(header), set = new Set(all.map(norm));
  if (!n) return "ignore";
  // short codes first
  const exact: Record<string, Field> = {
    "#": "num", no: "num", num: "num", number: "num", jersey: "num", jerseynumber: "num", "jersey#": "num", uni: "num", cap: "num",
    player: "name", name: "name", athlete: "name", playername: "name", first: "first", firstname: "first", last: "last", lastname: "last", pos: "pos", position: "pos",
    date: "date", gamedate: "date", matchdate: "date", opponent: "opp", opp: "opp", vs: "opp", score: "score", result: "score", setscores: "score",
    sp: "SP", s: "SP", sets: "SP", setsplayed: "SP", gp: "SP", gamesplayed: "SP",
    k: "K", kills: "K", kill: "K", e: "AE", ae: "AE", err: "AE", errors: "AE", ta: "TA", att: "TA", attempts: "TA", totalattempts: "TA", tot: "TA",
    se: "SE", serr: "SE", tsa: "SERV", serves: "SERV", serveattempts: "SERV", srvatt: "SERV", totalserves: "SERV",
    r: "RTOT", rec: "RTOT", tr: "RTOT", receptions: "RTOT", sr: "RTOT", re: "RE", rerr: "RE", recerr: "RE", sre: "RE",
    pa: "PAVG", passavg: "PAVG", passaverage: "PAVG", passrating: "PAVG", sravg: "PAVG", r3: "R3", r2: "R2", r1: "R1", r0: "R0", p3: "R3", p2: "R2", p1: "R1", p0: "R0", "3": "R3", "2": "R2", "1": "R1", "0": "R0",
    d: "D", dig: "D", digs: "D", de: "DE", digerr: "DE", digerrors: "DE", bs: "BS", solo: "BS", ba: "BA", be: "BE", blkerr: "BE",
    ast: "AST", assists: "AST", bhe: "BHE", bha: "BHA", aces: "SA", ace: "SA", serviceaces: "SA", serveerrors: "SE", serviceerrors: "SE",
  };
  // "A" and "SA" mean different things in MaxPreps (A = aces, SA = serve attempts) and NCAA box scores (A = assists, SA = service aces)
  const maxprepsStyle = set.has("a") && set.has("ast");
  if (n === "a") return maxprepsStyle ? "SA" : "AST";
  if (n === "sa") return maxprepsStyle ? "SERV" : "SA";
  if (n === "r" && set.has("re") && maxprepsStyle) return "RGOOD"; // MaxPreps R = receptions that weren't errors
  if (exact[n]) return exact[n];
  if (derived(n)) return "ignore";
  const pr = n.match(/^(?:pass|r|rec|sr)([0-3])s?$/); if (pr) return ("R" + pr[1]) as Field;
  if (has(n, "perfect")) return "R3";
  if (has(n, "seterr", "settingerr")) return "BHE";
  if (has(n, "setatt", "settingatt", "comm", "effort", "position", "netpoint", "netpts", "plusminus")) return "ignore";
  // long names, e.g. MaxPreps fields like "AttackKills", "ServingErrors", "BlockAssists"
  if (has(n, "jersey", "uniform")) return "num";
  if (has(n, "firstname")) return "first"; if (has(n, "lastname")) return "last";
  if (has(n, "playername", "athletename")) return "name";
  if (has(n, "setsplayed", "gamesplayed")) return "SP";
  const att = has(n, "attempt", "total") || /att$/.test(n);
  if (has(n, "block")) return has(n, "solo") ? "BS" : has(n, "assist") ? "BA" : has(n, "err") ? "BE" : "ignore";
  if (has(n, "dig")) return has(n, "err") ? "DE" : "D";
  if (has(n, "recept", "receiv", "receive", "passes", "passing")) return has(n, "err") ? "RE" : has(n, "success", "good") ? "RGOOD" : "RTOT";
  if (has(n, "ballhandl", "handling")) return has(n, "err") ? "BHE" : att ? "BHA" : "ignore";
  if (has(n, "assist")) return "AST";
  if (has(n, "serv")) return has(n, "ace") ? "SA" : has(n, "err") ? "SE" : att ? "SERV" : "ignore";
  if (has(n, "ace")) return "SA";
  if (has(n, "kill")) return "K";
  if (has(n, "attack", "hitting", "spike")) return has(n, "err") ? "AE" : att ? "TA" : has(n, "kill") ? "K" : "ignore";
  return "ignore";
}

/** Error columns split by type (serve error net / out) add up; any other field is taken from its first column. */
export const SUMS = new Set<Field>(["SE", "AE", "BE"]);
export const guessFields = (header: string[]) => {
  const f = header.map((h) => guessField(h, header));
  const seen = new Set<Field>(); return f.map((x) => (x !== "ignore" && seen.has(x) && !SUMS.has(x) ? "ignore" : (seen.add(x), x)));
};

/* ---------- rows to player lines ---------- */
export interface Line { num: string; first: string; last: string; pos: string; date?: string; opp?: string; score?: string; v: Partial<Record<Field, number>> }
const toNum = (c: string) => { const v = parseFloat(String(c).replace(/[^\d.\-]/g, "")); return isFinite(v) ? v : NaN; };

export function linesOf(t: Table, fields: Field[]): Line[] {
  const col = (f: Field) => fields.indexOf(f);
  const out: Line[] = [];
  for (const r of t.rows) {
    const get = (f: Field) => (col(f) >= 0 ? r[col(f)] : "");
    let first = get("first"), last = get("last");
    if (!first && !last && get("name")) {
      const nm = get("name").replace(/^#?\d+\s+/, "");
      if (nm.includes(",")) { const [l, f] = nm.split(",").map((x) => x.trim()); first = f || ""; last = l; } else { const parts = nm.split(/\s+/); first = parts.shift() || ""; last = parts.join(" "); }
    }
    let num = get("num").replace(/^#/, "").trim();
    if (!num) { const m = get("name").match(/^#?(\d{1,3})\b/); if (m) num = m[1]; }
    if (!num && !first && !last) continue;
    const v: Partial<Record<Field, number>> = {};
    fields.forEach((f, i) => { if (/^[A-Z]/.test(f)) { const x = toNum(r[i] ?? ""); if (!isNaN(x)) v[f] = SUMS.has(f) && v[f] != null ? v[f]! + x : x; } });
    out.push({ num, first, last, pos: get("pos"), date: get("date") || undefined, opp: get("opp") || undefined, score: get("score") || undefined, v });
  }
  return out;
}

/** "25-20, 22-25, 15-12" (also "W 25-20 25-18", "25–20/18–25") → [[25,20],[22,25],[15,12]] */
export function parseSetScores(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of (s || "").matchAll(/(\d{1,2})\s*[-–—:]\s*(\d{1,2})/g)) { const a = +m[1], b = +m[2]; if (a + b > 0) out.push([a, b]); }
  // "W 3-1" alone is a match result, not set scores
  if (out.length === 1 && out[0][0] <= 5 && out[0][1] <= 5) return [];
  return out;
}

/** Normalizes a date cell to YYYY-MM-DD ("10/27/2026", "2026-10-27", "Oct 27, 2026", "10/27" with a fallback year). */
export function parseDate(s: string, fallbackYear = new Date().getFullYear()): string | null {
  const v = (s || "").trim(); if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (m) { const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(fallbackYear); return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const d = new Date(v); if (!isNaN(+d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return null;
}

/* ---------- player lines to plays ---------- */
export interface Note { kind: "passes-unrated" | "passes-4scale" }

/** Spreads n events over the sets a player played: [3 sets, 7 kills] → 3, 2, 2. */
const spread = (n: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));

/** The stats-only plays for one player line, per set (index = set). */
export function playsFor(l: Line, sets: number, notes: Set<Note["kind"]>): string[][] {
  const v = l.v, n = (f: Field) => Math.max(0, Math.round(v[f] || 0));
  const codes: [string, number][] = [];
  const K = n("K"), AE = n("AE");
  codes.push(["K", K], ["AE", AE], ["TA", Math.max(0, n("TA") - K - AE)]);
  const SA = n("SA"), SE = n("SE");
  codes.push(["SA", SA], ["SE", SE], ["SI", Math.max(0, n("SERV") - SA - SE)]);
  // passing: only with ratings (3-2-1-0 counts and/or an average); unrated receptions would make up a pass average
  const counts = v.R3 != null || v.R2 != null || v.R1 != null || v.R0 != null;
  let avg = v.PAVG; if (avg != null && avg > 3) { avg = (avg * 3) / 4; notes.add("passes-4scale"); }
  const total = v.RTOT != null ? n("RTOT") : v.RGOOD != null ? n("RGOOD") + n("RE") : n("R3") + n("R2") + n("R1") + (v.R0 != null ? n("R0") : n("RE"));
  if (avg != null && total > 0) {
    // known counts stay; the rest are 3s/2s/1s that give the file's pass average
    const p0 = v.R0 != null ? n("R0") : n("RE"), p3k = v.R3 != null ? n("R3") : null, p2k = v.R2 != null ? n("R2") : null, p1k = v.R1 != null ? n("R1") : null;
    let p3 = p3k ?? 0, p2 = p2k ?? 0, p1 = p1k ?? 0;
    const rest = Math.max(0, total - p0 - p3 - p2 - p1), need = Math.round(avg * total) - 3 * p3 - 2 * p2 - p1; // points the rest must add
    if (p2k == null && p1k == null) { if (p3k == null) { const x = Math.max(0, Math.min(rest, need - 2 * rest)); p3 = x; p2 = rest - x; if (need - 2 * rest < 0) { const y = Math.min(rest, 2 * rest - need); p2 = rest - y; p1 = y; } } else { const y = Math.max(0, Math.min(rest, 2 * rest - need)); p2 = rest - y; p1 = y; } }
    else p2 += rest;
    codes.push(["P3", p3], ["P2", p2], ["P1", p1], ["P0", p0]);
  } else if (counts) codes.push(["P3", n("R3")], ["P2", n("R2")], ["P1", n("R1")], ["P0", v.R0 != null ? n("R0") : n("RE")]);
  else if (v.RTOT || v.RGOOD || v.RE) notes.add("passes-unrated");
  codes.push(["D", n("D")], ["DE", n("DE")], ["BS", n("BS")], ["BA", n("BA")], ["BE", n("BE")]);
  const AST = n("AST"), BHE = n("BHE");
  codes.push(["AST", AST], ["BHE", BHE], ["SATT", Math.max(0, n("BHA") - AST - BHE)]);
  const k = Math.max(1, Math.min(sets, v.SP != null ? Math.round(v.SP) || sets : sets));
  const per: string[][] = Array.from({ length: sets }, () => []);
  for (const [code, count] of codes) if (count > 0) spread(count, k).forEach((c, i) => { for (let j = 0; j < c; j++) per[i].push(code); });
  return per;
}

export interface MatchPlan { opp: string; date: string; scores: [number, number][]; season: boolean; lines: Line[] }

/** bestOf and set target from the scores: [[25,20],[22,25],[15,12]] → best of 3 to 25. */
export function formatFrom(scores: [number, number][]): { bestOf: number; setTo: number } {
  if (!scores.length) return { bestOf: 3, setTo: 25 };
  const us = scores.filter(([a, b]) => a > b).length, them = scores.filter(([a, b]) => b > a).length, w = Math.max(us, them);
  const bestOf = scores.length === 2 && us === 1 && them === 1 ? 2 : Math.max(1, 2 * w - 1);
  const early = scores.slice(0, Math.max(1, scores.length - 1)).map(([a, b]) => Math.max(a, b));
  return { bestOf, setTo: early.every((x) => x <= 23) && early.some((x) => x === 21) ? 21 : 25 };
}

/** Events for one imported match: per set, a new-set marker, every player's stats-only plays, then the set's final score. */
export function matchEvents(plan: MatchPlan, pid: (l: Line) => string | null, notes: Set<Note["kind"]>): { t: string; [k: string]: any }[] {
  const sets = Math.max(1, plan.scores.length || Math.max(1, ...plan.lines.map((l) => Math.round(l.v.SP || 0))));
  const per = plan.lines.map((l) => ({ id: pid(l), plays: playsFor(l, sets, notes) })).filter((x) => x.id);
  const evs: { t: string; [k: string]: any }[] = [];
  for (let s = 0; s < sets; s++) {
    evs.push({ t: "NS", serve: "us" });
    for (const x of per) for (const code of x.plays[s]) evs.push({ t: code, p: x.id, ns: true });
    const sc = plan.scores[s]; if (sc) evs.push({ t: "ADJ", us: sc[0], them: sc[1] });
  }
  return evs;
}

/** Turns a parsed file into matches: one match, season totals, or several matches (rows with date and opponent columns). */
export function plansFrom(lines: Line[], o: { mode: "match" | "season" | "rows"; opp: string; date: string; scores: string }): MatchPlan[] {
  if (o.mode === "season") return [{ opp: "Season totals", date: o.date, scores: [], season: true, lines }];
  if (o.mode === "match") return [{ opp: o.opp || "Opponent", date: o.date, scores: parseSetScores(o.scores), season: false, lines }];
  const groups = new Map<string, MatchPlan>();
  for (const l of lines) {
    const date = parseDate(l.date || "", +o.date.slice(0, 4)) || o.date, opp = (l.opp || o.opp || "Opponent").replace(/^(vs\.?|at|@)\s+/i, "").trim();
    const key = date + "|" + opp.toLowerCase();
    const g = groups.get(key) || { opp, date, scores: parseSetScores(l.score || ""), season: false, lines: [] };
    if (!g.scores.length && l.score) g.scores = parseSetScores(l.score);
    g.lines.push(l); groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** "Buchanan_10-27.txt" → "Buchanan" */
export function oppFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").replace(/\b(vs\.?|at|@)\b/gi, " ").replace(/\b\d{1,4}([-./]\d{1,2}){1,2}\b/g, " ").replace(/\b(import|maxpreps|stats?|export|hudl|solostats\d*)\b/gi, " ").replace(/\s+/g, " ").trim();
}
