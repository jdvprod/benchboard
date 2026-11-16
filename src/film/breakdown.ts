/** Film breakdown: what a coach would pull from a match's film before practice. Where we gave points away, which
 * rotation couldn't side out, which of their hitters hurt us and where, how we finished sets, and what to keep doing.
 * Each finding is a clip search, so it plays as clips and drops straight into a film session. Pure and unit tested;
 * the AI can rewrite the notes, but the findings themselves come from the stats. */
import type { LogEntry } from "../sports/volleyball/engine";
import type { ClipQuery } from "./query";

export type Tone = "fix" | "scout" | "keep";
export interface Finding { id: string; tone: Tone; title: string; why: string; q: ClipQuery; n: number; note: string; cost: number }
type Stat = Extract<LogEntry, { kind: "stat" }>;
const Q = (x: Partial<ClipQuery>): ClipQuery => ({ codes: null, players: [], opp: [], zones: [], sets: [], rots: [], ...x });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const ERRORS: { id: string; codes: string[]; what: string; note: string }[] = [
  { id: "serve", codes: ["SEN", "SEO", "SE"], what: "Serve errors", note: "Watch the toss and the contact. Every one of these handed them a point without a rally." },
  { id: "attack", codes: ["AE", "AB"], what: "Attack errors", note: "Look at the set and the approach before each swing. Was it the shot choice, or the ball we got?" },
  { id: "handling", codes: ["BHE", "CE"], what: "Ball-handling errors", note: "Watch hands and feet: get to the ball early and square up before the contact." },
  { id: "net", codes: ["BE", "NE"], what: "Net and block errors", note: "Watch the hands and the body on the block: press over without touching the tape." },
  { id: "dig", codes: ["DE"], what: "Dig errors", note: "Watch the platform and where it's pointing. Get the ball up and to the middle." },
];

/** `name(id)` is how a player is called, e.g. "#7 Maya". */
export function breakdown(log: LogEntry[], name: (id: string) => string): Finding[] {
  const st = log.filter((l): l is Stat => l.kind === "stat");
  if (!st.some((l) => l.w)) return [];
  const out: Finding[] = [];
  const top = (ls: Stat[], key: (l: Stat) => string | undefined) => { const c = new Map<string, number>(); for (const l of ls) { const k = key(l); if (k) c.set(k, (c.get(k) || 0) + 1); } return [...c.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined; };

  // 1. points we gave away, by kind of error
  for (const e of ERRORS) {
    const ls = st.filter((l) => e.codes.includes(l.t) && l.w === "them"); if (ls.length < 3) continue;
    const t = top(ls, (l) => l.p), who = t && t[1] >= 3 && t[1] / ls.length >= 0.5 ? ` ${name(t[0])} had ${t[1]} of them.` : "";
    out.push({ id: "err-" + e.id, tone: "fix", title: `${e.what} gave them ${plural(ls.length, "point")}`, why: `${plural(ls.length, "point")} on our own errors.${who}`, q: Q({ codes: e.codes, won: "them" }), n: ls.length, note: e.note, cost: ls.length });
  }
  // 2. serve receive: shanks and their aces
  const shanks = st.filter((l) => l.t === "P0" || l.t === "OA");
  if (shanks.length >= 3) {
    const t = top(shanks.filter((l) => l.p), (l) => l.p), who = t && t[1] >= 2 ? ` ${name(t[0])} took ${t[1]} of them.` : "";
    out.push({ id: "receive", tone: "fix", title: `${plural(shanks.length, "pass")} we couldn't play`, why: `Aced or shanked ${plural(shanks.length, "time")}.${who}`, q: Q({ codes: ["P0", "OA"] }), n: shanks.length, note: "Watch the feet before the serve is contacted: read the server, move, then stop and present the platform.", cost: shanks.length });
  }
  // 3. the rotation that couldn't side out
  const recv = new Map<number, { n: number; won: number }>();
  for (const l of st) if (l.w && l.sv === "them" && l.rot) { const r = recv.get(l.rot) || { n: 0, won: 0 }; r.n++; if (l.w === "us") r.won++; recv.set(l.rot, r); }
  const worst = [...recv.entries()].filter(([, r]) => r.n >= 4 && r.won / r.n < 0.5).sort((a, b) => a[1].won / a[1].n - b[1].won / b[1].n || b[1].n - a[1].n)[0];
  if (worst) { const [rot, r] = worst; out.push({ id: "rot-" + rot, tone: "fix", title: `Rotation ${rot} sided out ${r.won} of ${r.n}`, why: `The hardest rotation to get out of. Every point we received in it.`, q: Q({ rots: [rot], serving: "them", pointsOnly: true }), n: r.n, note: `Rotation ${rot} in serve receive: watch the passing formation and who the setter can set from the pass we get.`, cost: r.n - r.won }); }
  // 4. their runs: four or more points in a row
  let run: Stat[] = [], best: Stat[] = [];
  for (const l of st) { if (!l.w) continue; if (l.w === "them" && (!run.length || run[0].set === l.set)) run.push(l); else run = l.w === "them" ? [l] : []; if (run.length > best.length) best = run.slice(); }
  if (best.length >= 4) { const a = best[0], before = `${a.us}–${a.them - 1}`; out.push({ id: "run", tone: "fix", title: `They scored ${best.length} in a row in set ${a.set}`, why: `From ${before} to ${best[best.length - 1].us}–${best[best.length - 1].them}. What happened in that stretch?`, q: Q({ ids: best.map((l) => l.id) }), n: best.length, note: "A run is where a timeout or a sub can help. Watch for what changed: the server, our rotation, or our errors.", cost: best.length }); }
  // 5. finishing sets: points at 20+ (15+ in a fifth)
  const late = st.filter((l) => { if (!l.w) return false; const lim = l.set >= 5 ? 15 : 20, b = l.w === "us" ? [l.us - 1, l.them] : [l.us, l.them - 1]; return Math.max(b[0], b[1]) >= lim; });
  const lateLost = late.filter((l) => l.w === "them").length;
  if (late.length >= 5 && lateLost / late.length > 0.5) out.push({ id: "late", tone: "fix", title: `We lost ${lateLost} of ${late.length} points at 20+`, why: "How the sets finished. The plays that decide close sets.", q: Q({ clutch: true, pointsOnly: true }), n: late.length, note: "Late in the set: who did we set, and did we serve tough or safe?", cost: lateLost });
  // 6. their best hitter, and where the kills went
  const theirs = st.filter((l) => l.t === "OK" && l.op), th = top(theirs, (l) => l.op);
  if (th && th[1] >= 3) {
    const ks = theirs.filter((l) => l.op === th[0]), z = top(ks.filter((l) => typeof l.z === "number"), (l) => String(l.z));
    const where = z && z[1] >= 2 ? `, ${z[1]} of them to area ${z[0]}` : "";
    out.push({ id: "their-" + th[0], tone: "scout", title: `Their #${th[0]}: ${plural(th[1], "kill")}${where}`, why: `Their most dangerous hitter in this match.${z && z[1] >= 2 ? ` Our defense should start in area ${z[0]} when #${th[0]} swings.` : ""}`, q: Q({ codes: ["OK"], opp: [th[0]] }), n: th[1], note: `#${th[0]}'s kills: watch the approach angle and where the ball goes, and where our block and defense were.`, cost: th[1] });
  }
  // 7. what to keep doing: our top scorer, and aces or blocks if they were a weapon
  const scoring = st.filter((l) => l.p && l.w === "us" && ["K", "KT", "SA", "BS", "BA"].includes(l.t)), sc = top(scoring, (l) => l.p);
  if (sc && sc[1] >= 3) { const ls = scoring.filter((l) => l.p === sc[0]), k = ls.filter((l) => l.t === "K" || l.t === "KT").length, a = ls.filter((l) => l.t === "SA").length, b = ls.filter((l) => l.t === "BS" || l.t === "BA").length;
    out.push({ id: "star-" + sc[0], tone: "keep", title: `${name(sc[0])} scored ${sc[1]}`, why: [k && plural(k, "kill"), a && plural(a, "ace"), b && plural(b, "block")].filter(Boolean).join(", ") + ". Show the team what working looks like.", q: Q({ players: [sc[0]], codes: ["K", "KT", "SA", "BS", "BA"], won: "us" }), n: sc[1], note: "What's working: watch the approach, the contact and the shot.", cost: 0 }); }
  const aces = st.filter((l) => l.t === "SA").length;
  if (aces >= 4) out.push({ id: "aces", tone: "keep", title: `${plural(aces, "ace")}`, why: "Our serve was a weapon. Where did the aces land?", q: Q({ codes: ["SA"] }), n: aces, note: "Watch the target on each ace: seam, short or deep corner.", cost: 0 });
  const blocks = st.filter((l) => l.t === "BS" || l.t === "BA").length;
  if (blocks >= 4) out.push({ id: "blocks", tone: "keep", title: `${plural(blocks, "block")}`, why: "The block scored points. Watch the timing and the hands.", q: Q({ codes: ["BS", "BA"] }), n: blocks, note: "Watch the read and the hands: closed, pressed over, eyes on the hitter.", cost: 0 });

  const order: Record<Tone, number> = { fix: 0, scout: 1, keep: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone] || b.cost - a.cost).slice(0, 7);
}

/** What the AI is given to write the coach's notes: the findings and the match, never players' last names. */
export function breakdownPrompt(opp: string, score: string, fs: Finding[], numbers: string): string {
  return `You are an experienced volleyball coach writing a short film review for your own team after a match against ${opp} (${score}).
Team numbers: ${numbers}.
Findings from the stats, each tied to clips the players will watch:
${fs.map((f) => `- ${f.id} [${f.tone}]: ${f.title}. ${f.why}`).join("\n")}
Return JSON: {"summary": "2-3 sentences the coach can read to the team: the story of the match and the one thing to fix first", "notes": {"<finding id>": "one or two sentences telling players exactly what to watch for in these clips, plain words, encouraging but direct"}}.
Use only the facts above. Refer to players only as they appear above. No headings, no markdown.`;
}
/** Keep only well-formed notes from an AI answer. */
export function cleanReview(x: any, fs: Finding[]): { summary: string; notes: Record<string, string> } {
  const ids = new Set(fs.map((f) => f.id)), notes: Record<string, string> = {};
  if (x && typeof x.notes === "object") for (const [k, v] of Object.entries(x.notes)) if (ids.has(k) && typeof v === "string" && v.trim()) notes[k] = v.trim().slice(0, 400);
  return { summary: typeof x?.summary === "string" ? x.summary.trim().slice(0, 800) : "", notes };
}
