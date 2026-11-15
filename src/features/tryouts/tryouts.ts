/** Tryouts, pure parts (unit tested): candidates, ratings from several evaluators, rankings, merging another
 * evaluator's ratings file, and a CSV for the club. */

export const DEFAULT_SKILLS = ["Serve", "Pass", "Set", "Attack", "Block", "Defense", "Athleticism", "Coachability"];
export type Decision = "offer" | "maybe" | "cut" | "";
export interface Candidate { id: string; bib: string; name: string; grade: string; pos: string; note: string; decision: Decision }
/** ratings[evaluator][candidateId][skill] = 1..5 */
export type Ratings = Record<string, Record<string, Record<string, number>>>;
export interface Tryout { id: string; name: string; date: string; skills: string[]; weights: Record<string, number>; candidates: Candidate[]; ratings: Ratings; createdAt: number; /** each evaluator's notes: evNotes[evaluator][candidateId] */ evNotes?: Record<string, Record<string, string>>; /** shared with the staff by this code */ code?: string; /** opened from someone else's code: rate only */ role?: "evaluator" }

export function newTryout(name: string, date: string, id: string): Tryout {
  return { id, name: name.trim() || "Tryouts", date, skills: DEFAULT_SKILLS.slice(), weights: {}, candidates: [], ratings: {}, createdAt: Date.now() };
}

/** "12 Maya Chen OH 10th" or "12, Maya Chen, OH, 10" per line. Bib first if it's a number; position and grade if they look like one. */
export function parseCandidates(text: string, existing: Candidate[], mkId: () => string): Candidate[] {
  const POS = /^(OH|MB|MH|S|OPP|RS|L|DS|LIB|OUT|SETTER|LIBERO|MIDDLE|OPPOSITE)$/i, GRADE = /^((\d{1,2})(st|nd|rd|th)?|fr|so|jr|sr|freshman|sophomore|junior|senior|u\d{2})$/i;
  let next = existing.reduce((m, c) => Math.max(m, parseInt(c.bib) || 0), 0) + 1;
  const out: Candidate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/[,\t]| {2,}/).map((s) => s.trim()).filter(Boolean), words = (parts.length > 1 ? parts : raw.trim().split(/\s+/)).filter(Boolean);
    if (!words.length) continue;
    let bib = "", pos = "", grade = "";
    if (/^#?\d{1,4}$/.test(words[0])) bib = words.shift()!.replace("#", "");
    const name: string[] = [];
    for (const w of words) { if (!pos && POS.test(w)) pos = w.toUpperCase(); else if (!grade && GRADE.test(w)) grade = w; else name.push(w); }
    if (!name.length) continue;
    if (!bib) bib = String(next++); else next = Math.max(next, (parseInt(bib) || 0) + 1);
    out.push({ id: mkId(), bib, name: name.join(" ").slice(0, 60), grade, pos, note: "", decision: "" });
  }
  return out;
}

/** One evaluator's score for a candidate: weighted mean over the skills they rated (null if none). */
function oneScore(r: Record<string, number> | undefined, t: Tryout): number | null {
  if (!r) return null; let s = 0, w = 0;
  for (const k of t.skills) { const v = r[k]; if (typeof v !== "number") continue; const wt = t.weights[k] ?? 1; s += v * wt; w += wt; }
  return w ? s / w : null;
}

export interface Row { c: Candidate; score: number | null; bySkill: Record<string, number | null>; evaluators: number; spread: number | null }
/** Everyone, best first. The score averages each evaluator's weighted score; spread is how far apart the evaluators are. */
export function rank(t: Tryout): Row[] {
  const evs = Object.keys(t.ratings);
  const rows = t.candidates.map((c) => {
    const per = evs.map((e) => oneScore(t.ratings[e][c.id], t)).filter((x): x is number => x !== null);
    const bySkill: Record<string, number | null> = {};
    for (const k of t.skills) { const v = evs.map((e) => t.ratings[e][c.id]?.[k]).filter((x): x is number => typeof x === "number"); bySkill[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
    return { c, score: per.length ? per.reduce((a, b) => a + b, 0) / per.length : null, bySkill, evaluators: per.length, spread: per.length > 1 ? Math.max(...per) - Math.min(...per) : null };
  });
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (parseInt(a.c.bib) || 0) - (parseInt(b.c.bib) || 0));
}

/** Fold another evaluator's file into this tryout. Candidates are matched by bib; new ones are added. Their ratings
 * replace only that evaluator's own earlier ratings. Returns the merged tryout and how many ratings came in. */
export function mergeTryout(mine: Tryout, theirs: Tryout, mkId: () => string): { t: Tryout; added: number; ratings: number } {
  const byBib = new Map(mine.candidates.map((c) => [c.bib, c])), idMap = new Map<string, string>(), candidates = mine.candidates.slice();
  let added = 0;
  for (const c of theirs.candidates) {
    const hit = byBib.get(c.bib);
    if (hit) idMap.set(c.id, hit.id);
    else { const n = { ...c, id: mkId(), decision: "" as Decision }; candidates.push(n); byBib.set(n.bib, n); idMap.set(c.id, n.id); added++; }
  }
  const ratings: Ratings = JSON.parse(JSON.stringify(mine.ratings)); let count = 0;
  for (const [ev, byC] of Object.entries(theirs.ratings)) {
    const into: Record<string, Record<string, number>> = {};
    for (const [cid, sk] of Object.entries(byC)) { const to = idMap.get(cid); if (!to) continue; const clean: Record<string, number> = {}; for (const [k, v] of Object.entries(sk)) if (typeof v === "number" && v >= 1 && v <= 5) { clean[k] = Math.round(v); count++; } into[to] = clean; }
    ratings[ev] = into;
  }
  const evNotes: Record<string, Record<string, string>> = { ...(mine.evNotes || {}) };
  for (const [ev, byC] of Object.entries(theirs.evNotes || {})) { const into: Record<string, string> = {}; for (const [cid, note] of Object.entries(byC)) { const to = idMap.get(cid); if (to && typeof note === "string" && note.trim()) into[to] = note.slice(0, 300); } evNotes[ev] = into; }
  const skills = mine.skills.concat(theirs.skills.filter((k) => !mine.skills.includes(k)));
  return { t: { ...mine, candidates, ratings, skills, evNotes }, added, ratings: count };
}

/** Everyone's notes on one player, "Pat: strong arm". */
export const staffNotes = (t: Tryout, cid: string) => Object.entries(t.evNotes || {}).map(([ev, m]) => (m[cid] ? `${ev}: ${m[cid]}` : "")).filter(Boolean);

export function tryoutCsv(t: Tryout): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s), f = (v: number | null) => (v === null ? "" : v.toFixed(2));
  const head = ["Rank", "Bib", "Name", "Grade", "Position", "Score", ...t.skills, "Evaluators", "Decision", "Note", "Staff notes"];
  return [head.join(","), ...rank(t).map((r, i) => [String(i + 1), r.c.bib, q(r.c.name), q(r.c.grade), r.c.pos, f(r.score), ...t.skills.map((k) => f(r.bySkill[k])), String(r.evaluators), r.c.decision, q(r.c.note), q(staffNotes(t, r.c.id).join(" | "))].join(","))].join("\n") + "\n";
}

/** A paper rating sheet for evaluators: one row per player, a box per skill, room for a note. */
export function ratingSheetHtml(t: Tryout, evaluator = ""): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const rows = t.candidates.slice().sort((a, b) => (parseInt(a.bib) || 0) - (parseInt(b.bib) || 0) || a.name.localeCompare(b.name));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.name)} rating sheet</title><style>
body{font:12px/1.3 Arial,sans-serif;margin:0}h1{font-size:18px;margin:0 0 2px}p{margin:0 0 10px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:5px 4px;text-align:center}th{font-size:11px;background:#eee}
td.n{text-align:left;white-space:nowrap}td.b{font-weight:700;width:34px}td.box{width:44px}td.note{width:28%}tr{page-break-inside:avoid}@page{margin:10mm}
</style></head><body><h1>${esc(t.name)}: rating sheet</h1><p>Evaluator: ${esc(evaluator) || "________________"} · Rate 1 (needs work) to 5 (excellent) · ${t.candidates.length} players</p>
<table><thead><tr><th>Bib</th><th>Player</th><th>Pos</th>${t.skills.map((k) => `<th>${esc(k)}</th>`).join("")}<th>Note</th></tr></thead><tbody>
${rows.map((c) => `<tr><td class="b">${esc(c.bib)}</td><td class="n">${esc(c.name)}</td><td>${esc(c.pos)}</td>${t.skills.map(() => '<td class="box"></td>').join("")}<td class="note"></td></tr>`).join("\n")}
</tbody></table></body></html>`;
}
