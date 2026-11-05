/** Clip search in plain words: "all solo blocks", "kills to area 1", "Maya's digs in set 2", "aces in rotation 3",
 * "kills off perfect passes", "their kills from #7", "clutch points". Turns the words into a filter over the match log.
 * Pure and unit tested; the AI can fill the same shape when the words aren't understood. */
import type { LogEntry } from "../sports/volleyball/engine";

export type QSide = "us" | "them";
export interface ClipQuery {
  codes: string[] | null; // play codes; null = any play
  players: string[]; // player ids
  opp: string[]; // their jersey numbers
  zones: number[]; // where the ball went (1–6)
  sets: number[];
  rots: number[];
  won?: QSide; // the play ended the rally for this side
  serving?: QSide; // who was serving when the play happened
  ctx?: string[]; // attack context: P3 P2 P1 DIG FREE OTH
  clutch?: boolean; // either team at 20 or more (15 in a fifth set)
  tags?: boolean; // film tags / notes
  note?: string; // tag text to look for
}
export interface QueryPlayer { id: string; first: string; last: string; num: string }
export interface Parsed { q: ClipQuery; chips: string[]; empty: boolean }

const BLOCKS = ["BS", "BA", "BE"], ATT = ["K", "KT", "AE", "AB", "TA"], SRV = ["SA", "SI", "SEN", "SEO", "SE"], PASS = ["P3", "P2", "P1", "P0"];
const OUR_ERR = ["AE", "AB", "SEN", "SEO", "SE", "BE", "BHE", "P0", "DE", "CE", "EE", "PE"];
/** Longest phrases first; each is a regex on the cleaned text, with the codes and how to show it. */
const PLAYS: [RegExp, string[], string][] = [
  [/\btheir kills?\b|\bopponent kills?\b|\bkills? against us\b/, ["OK"], "Their kills"],
  [/\btheir aces?\b|\bopponent aces?\b|\baces? against us\b/, ["OA"], "Their aces"],
  [/\btheir errors?\b|\bopponent errors?\b|\bfree points?\b/, ["OE"], "Their errors"],
  [/\b(kills? )?off the block\b|\btools?\b|\btooled\b|\bwipes?\b/, ["KT"], "Kills off the block"],
  [/\bsolo blocks?\b|\bstuff blocks? solo\b/, ["BS"], "Solo blocks"],
  [/\bblock assists?\b|\bassisted blocks?\b|\bjoint blocks?\b/, ["BA"], "Block assists"],
  [/\b(block|net) errors?\b|\bnet violations?\b|\bin the net\b/, ["BE"], "Block / net errors"],
  [/\bblocking reps?\b|\bblock(ing)? touches\b|\bblocks?\b|\bblocking\b|\bstuffs?\b|\broofs?\b/, BLOCKS, "Blocks"],
  [/\b(attack|hitting|hit|swing) errors?\b|\bhitting mistakes?\b/, ["AE", "AB"], "Attack errors"],
  [/\bgot blocked\b|\bwere blocked\b|\bblocked (attacks?|balls?|swings?)\b|\bbeen blocked\b/, ["AB"], "Blocked attacks"],
  [/\bkills?\b|\bput ?aways?\b|\bterminations?\b/, ["K", "KT"], "Kills"],
  [/\battacks?\b|\bswings?\b|\bhits\b|\bhitting\b|\battempts?\b|\bspikes?\b/, ATT, "Attacks"],
  [/\bserve errors?\b|\bmissed serves?\b|\bserving errors?\b/, ["SEN", "SEO", "SE"], "Serve errors"],
  [/\baces?\b/, ["SA"], "Aces"],
  [/\bperfect pass(es)?\b|\b3 pass(es)?\b|\bthree pass(es)?\b|\bperfect receptions?\b/, ["P3"], "Perfect passes"],
  [/\b2 pass(es)?\b|\btwo pass(es)?\b|\bgood pass(es)?\b/, ["P2"], "2 passes"],
  [/\b1 pass(es)?\b|\bone pass(es)?\b|\bbad pass(es)?\b|\bpoor pass(es)?\b/, ["P1"], "1 passes"],
  [/\bshanks?\b|\bshanked\b|\b0 pass(es)?\b|\bzero pass(es)?\b|\bgot aced\b|\bpassing errors?\b/, ["P0"], "Shanked passes"],
  [/\bserve receive\b|\bpass(es|ing)?\b|\breceptions?\b|\bserve receptions?\b/, PASS, "Passes"],
  [/\bserves?\b|\bserving\b/, SRV, "Serves"],
  [/\bdig errors?\b|\bmissed digs?\b/, ["DE"], "Dig errors"],
  [/\bdigs?\b|\bdigging\b|\bdefen[cs]e\b|\bups\b/, ["D"], "Digs"],
  [/\bsetting errors?\b|\bball handling( errors?)?\b|\bdoubles?\b|\blifts?\b/, ["BHE"], "Setting errors"],
  [/\bassists?\b|\bsets\b|\bsetting\b|\bsetter\b/, ["AST", "SATT"], "Sets"],
  [/\bfree ?balls?\b/, ["FBR"], "Free balls"],
  [/\b(our )?errors?\b|\bmistakes?\b|\bunforced\b/, OUR_ERR, "Our errors"],
];
const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (s: string) => (/^\d+$/.test(s) ? +s : ORD[s] ?? NaN);

export function parseQuery(text: string, roster: QueryPlayer[] = []): Parsed {
  let s = " " + text.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9#+ ]+/g, " ").replace(/\s+/g, " ") + " ";
  const q: ClipQuery = { codes: null, players: [], opp: [], zones: [], sets: [], rots: [] }, chips: string[] = [];
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => { let m: RegExpMatchArray | null; const g = new RegExp(re.source, "g"); while ((m = g.exec(s))) f(m); s = s.replace(g, " "); };
  const N = "(\\d|one|two|three|four|five|six|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)";

  // opponents' jerseys first ("their #7", "from their 12")
  take(new RegExp(`\\b(?:their|opponent|opponents|other team) (?:number |no |#)?#?(\\d{1,2})\\b`), (m) => { q.opp.push(m[1]); chips.push("Their #" + m[1]); });
  // where the ball went
  take(new RegExp(`\\b(?:to |in |into |at )?(?:area|zone|position|spot) ${N}\\b`), (m) => { const z = num(m[1]); if (z >= 1 && z <= 6) { q.zones.push(z); chips.push("To area " + z); } });
  take(/\b(?:to |into )?(?:the )?(?:deep )?(left|right) back( corner)?\b/, (m) => { const z = m[1] === "left" ? 5 : 1; q.zones.push(z); chips.push("To area " + z); });
  take(/\b(?:to |into )?(?:the )?middle back\b|\bdeep middle\b/, () => { q.zones.push(6); chips.push("To area 6"); });
  take(/\btips?\b|\bdumps?\b|\bshort\b/, () => { q.zones.push(2, 3, 4); chips.push("Front row (short)"); });
  // set and rotation
  take(new RegExp(`\\b${N} (?:set|game)\\b`), (m) => { const n = num(m[1]); if (n >= 1 && n <= 5) { q.sets.push(n); chips.push("Set " + n); } });
  take(new RegExp(`\\b(?:set|game) ${N}\\b`), (m) => { const n = num(m[1]); if (n >= 1 && n <= 5) { q.sets.push(n); chips.push("Set " + n); } });
  take(new RegExp(`\\b(?:rotation|rot|rotations) ${N}\\b`), (m) => { const n = num(m[1]); if (n >= 1 && n <= 6) { q.rots.push(n); chips.push("Rotation " + n); } });
  take(new RegExp(`\\b(?:s|r)(\\d)\\b`), (m) => { const n = +m[1]; if (n >= 1 && n <= 6) { q.rots.push(n); chips.push("Rotation " + n); } });
  // situation
  take(/\b(?:when |while |on |in )?(?:we were |we re |we are )?(?:receiving|in receive|on receive|in serve receive|siding out|side ?outs?|sideout)\b/, () => { q.serving = "them"; chips.push("In serve receive"); });
  take(/\b(?:when |while |on |in )(?:we were |we are )?(?:serving|our serve|serve)\b|\bin transition\b(?= points?)|\bpoint scoring\b/, () => { q.serving = "us"; chips.push("On our serve"); });
  take(/\boff (?:a |the )?(?:perfect|great|3|three) pass(?:es)?\b|\bin system\b/, () => { q.ctx = ["P3"]; chips.push("Off perfect passes"); });
  take(/\boff (?:a |the )?(?:good|2|two) pass(?:es)?\b/, () => { q.ctx = ["P2"]; chips.push("Off 2 passes"); });
  take(/\boff (?:a |the )?(?:bad|poor|1|one) pass(?:es)?\b|\bout of system\b/, () => { q.ctx = ["P1", "OTH"]; chips.push("Out of system"); });
  take(/\boff (?:a |the )?digs?\b|\bin transition\b|\btransition\b/, () => { q.ctx = ["DIG"]; chips.push("In transition (off digs)"); });
  take(/\boff (?:a |the )?free ?balls?\b/, () => { q.ctx = ["FREE"]; chips.push("Off free balls"); });
  take(/\bclutch\b|\blate in (?:the )?sets?\b|\bafter 20\b|\b20\+|\bat 20\b|\bbig points?\b|\bcrunch time\b/, () => { q.clutch = true; chips.push("At 20+"); });
  take(/\bpoints? (?:we )?(?:lost|they won|against us)\b|\blost points?\b|\btheir points?\b/, () => { q.won = "them"; chips.push("Points they won"); });
  take(/\bpoints? (?:we )?won\b|\bwon points?\b|\bour points?\b|\bthat (?:won|scored)\b|\bscoring plays?\b/, () => { q.won = "us"; chips.push("Points we won"); });
  take(/\btags?\b|\bnotes?\b|\bflagged\b|\bmarked\b/, () => { q.tags = true; chips.push("Film tags"); });

  // players: "#12", "number 12", first or last names
  const jerseys: string[] = [];
  take(/(?:#|\bnumber |\bno )(\d{1,2})\b/, (m) => { jerseys.push(m[1]); });
  for (const p of roster) {
    const names = [p.first, p.last].filter((n) => n && n.length > 1).map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    for (const n of names) if (new RegExp(`\\b${n}\\b`).test(s)) { if (!q.players.includes(p.id)) { q.players.push(p.id); chips.push(`#${p.num} ${p.first}`); } s = s.replace(new RegExp(`\\b${n}\\b`, "g"), " "); }
  }
  // "kills to 1" / "to 5" after a play word: a bare zone
  take(/\bto (\d)\b/, (m) => { const z = +m[1]; if (z >= 1 && z <= 6) { q.zones.push(z); chips.push("To area " + z); } });

  // plays
  const codes = new Set<string>();
  for (const [re, c, label] of PLAYS) if (re.test(s)) { c.forEach((x) => codes.add(x)); chips.push(label); s = s.replace(new RegExp(re.source, "g"), " "); }
  if (/\bevery point\b|\ball points\b|\bpoints?\b|\brallies\b/.test(s) && !codes.size && !q.won) { q.won = undefined; chips.push("Every point"); (q as any).pointsOnly = true; }
  if (codes.size) q.codes = [...codes];
  // "#7" means their player when only their plays are asked for, otherwise ours
  const theirsOnly = !!q.codes && q.codes.every((c) => c === "OK" || c === "OA" || c === "OE");
  for (const n of jerseys) {
    if (theirsOnly) { q.opp.push(n); chips.push("Their #" + n); continue; }
    const p = roster.find((r) => r.num === n); if (p && !q.players.includes(p.id)) { q.players.push(p.id); chips.push(`#${p.num} ${p.first}`); }
  }
  if (q.ctx && !q.codes) q.codes = ["K", "KT", "AE", "AB", "TA"]; // "off perfect passes" means attacks
  const empty = !q.codes && !q.players.length && !q.opp.length && !q.zones.length && !q.sets.length && !q.rots.length && !q.won && !q.serving && !q.ctx && !q.clutch && !q.tags && !(q as any).pointsOnly;
  return { q, chips: [...new Set(chips)], empty };
}

/** Does a log line pass the query? */
export function matchQuery(q: ClipQuery, l: LogEntry): boolean {
  if (l.kind === "tag") {
    if (!q.tags && !q.note) return false;
    if (q.note && !l.note.toLowerCase().includes(q.note.toLowerCase())) return false;
    if (q.players.length && !(l.p && q.players.includes(l.p))) return false;
    return !q.sets.length || q.sets.includes(l.set);
  }
  if (l.kind !== "stat") return false;
  if (q.tags && !q.codes) return false;
  if (q.codes && !q.codes.includes(l.t)) return false;
  if ((q as any).pointsOnly && !l.w) return false;
  if (q.players.length && !(l.p && q.players.includes(l.p))) return false;
  if (q.opp.length && !(l.op && q.opp.includes(l.op))) return false;
  if (q.zones.length && !(typeof l.z === "number" && q.zones.includes(l.z))) return false;
  if (q.sets.length && !q.sets.includes(l.set)) return false;
  if (q.rots.length && !(l.rot && q.rots.includes(l.rot))) return false;
  if (q.won && l.w !== q.won) return false;
  if (q.serving && l.sv !== q.serving) return false;
  if (q.ctx && !(l.cx && q.ctx.includes(l.cx))) return false;
  if (q.clutch) { const lim = l.set >= 5 ? 15 : 20, before = l.w === "us" ? [l.us - 1, l.them] : l.w === "them" ? [l.us, l.them - 1] : [l.us, l.them]; if (Math.max(before[0], before[1]) < lim) return false; }
  return true;
}

/** What the AI is asked to fill when the words aren't understood. */
export function aiQueryPrompt(text: string, roster: QueryPlayer[]): string {
  return `A volleyball coach is searching match film. Turn the request into JSON with these optional keys:
codes: array of play codes from K (kill), KT (kill off the block), AE (attack error), AB (attack blocked), TA (attack attempt), SA (ace), SI (serve in), SEN/SEO (serve error), P3/P2/P1/P0 (pass grades), D (dig), DE (dig error), AST (assist), SATT (set), BHE (setting error), BS (solo block), BA (block assist), BE (block error), FBR (free ball), OK (their kill), OA (their ace), OE (their error);
players: array of player ids from the roster; opp: array of their jersey numbers; zones: array of court areas 1-6 the ball went to; sets: array of set numbers; rots: array of our rotations 1-6;
won: "us" or "them" (who won the rally); serving: "us" or "them"; ctx: attack context array from P3, P2, P1, DIG, FREE, OTH; clutch: true for late in sets (20+); tags: true for film notes.
Roster: ${roster.map((p) => `${p.id}=#${p.num} ${p.first} ${p.last}`).join("; ")}
Request: ${JSON.stringify(text)}
Answer with only the JSON object.`;
}
const CODES = new Set(["K", "KT", "AE", "AB", "TA", "SA", "SI", "SEN", "SEO", "SE", "P3", "P2", "P1", "P0", "D", "DE", "AST", "SATT", "BHE", "BS", "BA", "BE", "FBR", "OK", "OA", "OE"]);
/** Keep only well-formed fields from an AI answer. */
export function cleanAiQuery(x: any, roster: QueryPlayer[]): ClipQuery {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const ints = (v: any, lo: number, hi: number) => arr(v).map((n: any) => +n).filter((n: number) => Number.isInteger(n) && n >= lo && n <= hi);
  const side = (v: any) => (v === "us" || v === "them" ? v : undefined);
  const codes = arr(x?.codes).map(String).filter((c: string) => CODES.has(c));
  const ids = new Set(roster.map((p) => p.id));
  return {
    codes: codes.length ? codes : null, players: arr(x?.players).map(String).filter((id: string) => ids.has(id)), opp: arr(x?.opp).map(String).filter((n: string) => /^\d{1,2}$/.test(n)),
    zones: ints(x?.zones, 1, 6), sets: ints(x?.sets, 1, 5), rots: ints(x?.rots, 1, 6), won: side(x?.won), serving: side(x?.serving),
    ctx: arr(x?.ctx).filter((c: any) => ["P3", "P2", "P1", "DIG", "FREE", "OTH"].includes(c)).length ? arr(x?.ctx).filter((c: any) => ["P3", "P2", "P1", "DIG", "FREE", "OTH"].includes(c)) : undefined,
    clutch: x?.clutch === true || undefined, tags: x?.tags === true || undefined,
  };
}
