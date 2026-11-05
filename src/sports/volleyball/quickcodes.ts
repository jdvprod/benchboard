/**
 * Type-in stat codes for keyboards (laptop or Surface on the bench).
 * "7k" = #7 kill, "12ace" = #12 ace, "4p3" = #4 passed a 3, "ok11" = their #11 kill, "oe" = their error.
 * Several entries can go on one line: "7k 12ace ok11".
 */
import { ActionCode } from "./actions";

export const CODE_MAP: Record<string, ActionCode> = {
  k: "K", kill: "K", tool: "KT", kt: "KT", w: "KT", blocked: "AB", ab: "AB", r: "AB", roof: "AB", a: "TA", att: "TA", ta: "TA", e: "AE", ae: "AE", err: "AE",
  set: "SATT", st: "SATT", ast: "AST", as: "AST", bh: "BHE", bhe: "BHE", ste: "BHE",
  ace: "SA", sa: "SA", in: "SI", si: "SI", sn: "SEN", sen: "SEN", so: "SEO", seo: "SEO", se: "SE",
  p3: "P3", p2: "P2", p1: "P1", p0: "P0", r3: "P3", r2: "P2", r1: "P1", r0: "P0",
  d: "D", dig: "D", de: "DE", b: "BS", bs: "BS", ba: "BA", be: "BE", bn: "BE",
  ce: "CE", ee: "EE", pe: "PE", fb: "FBR", fbr: "FBR", ovp: "OVP", ov: "OVP", fbs: "FBS",
  oe: "OE", ok: "OK", oa: "OA", tp: "TP", up: "UP", ref: "REF",
};
/** Opponent codes take a trailing jersey number: ok11. */
const OPP: Partial<Record<ActionCode, true>> = { OK: true, OA: true, OE: true, TP: true };

export interface QuickItem { code: ActionCode; num?: string; op?: string; raw: string }
export type QuickResult = { items: QuickItem[]; undo: number; errors: string[] };

export function parseQuick(line: string): QuickResult {
  const out: QuickResult = { items: [], undo: 0, errors: [] };
  for (const raw of line.toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    if (raw === "u" || raw === "undo") { out.undo++; continue; }
    const m = raw.match(/^#?(\d{1,3})?([a-z]+)([0-3])?(\d{1,3})?$/);
    if (!m) { out.errors.push(raw); continue; }
    const [, num, letters, grade, trail] = m;
    let key = letters, op: string | undefined;
    if (grade !== undefined && (letters === "p" || letters === "r")) { key = letters + grade; op = trail; }
    else if (grade !== undefined) op = grade + (trail || "");
    else op = trail;
    const code = CODE_MAP[key];
    if (!code) { out.errors.push(raw); continue; }
    if (op && !OPP[code]) { out.errors.push(raw); continue; }
    out.items.push({ code, num: num || undefined, op: op || undefined, raw });
  }
  return out;
}

export const QUICK_HELP: [string, string][] = [
  ["7k / 7e / 7a", "kill · attack error · attempt"],
  ["1set / 1ast / 1bh", "set attempt · assist · setting error"],
  ["12ace / 12in / 12sn / 12so", "ace · in · serve error net · out (server is automatic: just ace, in…)"],
  ["4p3 … 4p0", "pass grade 3 to 0"],
  ["3d / 3de", "dig · dig error"],
  ["9bs / 9ba / 9be", "solo block · block assist · net error"],
  ["ok11 / oa7 / oe / tp", "their kill · ace · error · other point (with their #)"],
  ["ce / ee / pe / ref / up", "communication · effort · positioning · bad call · our point"],
  ["u", "undo your last entry"],
];

/* ---------- voice: what a coach says → type-in codes ("seven kill, twelve ace, their kill eleven" → "7k 12ace ok11") ---------- */
const NUM_WORDS: Record<string, number> = { zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
// longest phrases first; "their"/"they"/"opponent" phrases are the other team's
const SPOKEN: [RegExp, string][] = [
  [/^(their|they|opponent|opp) (kill|kills)$/, "ok"], [/^(their|they|opponent|opp) (ace|aces)$/, "oa"], [/^(their|they|opponent|opp) (error|errors|mistake)$/, "oe"], [/^(their|they|opponent|opp) point$/, "tp"],
  [/^solo block$/, "bs"], [/^block assist$/, "ba"], [/^(block|blocks)$/, "bs"], [/^(net|block error|net error)$/, "be"],
  [/^(serve error|service error|missed serve|miss serve|serve out|serve net)$/, "se"], [/^(serve in|serve good)$/, "in"], [/^(ace|aces|service ace)$/, "ace"],
  [/^(perfect pass|pass three|three pass|pass 3)$/, "p3"], [/^(pass two|two pass|good pass|pass 2)$/, "p2"], [/^(pass one|one pass|bad pass|pass 1)$/, "p1"], [/^(shank|shanked|pass zero|zero pass|reception error|aced|pass 0)$/, "p0"],
  [/^(kill|kills|killed|put away)$/, "k"], [/^(tool|tooled|off the block)$/, "kt"], [/^(blocked|roofed|stuffed)$/, "ab"], [/^(attack error|hitting error|hit error|hit out|error|out)$/, "e"], [/^(attempt|attack|swing|kept in play)$/, "a"],
  [/^(assist|assists|set assist)$/, "ast"], [/^(dig|digs|dug)$/, "d"], [/^(dig error|missed dig)$/, "de"], [/^(ball handling|double|lift|set error|setting error)$/, "bhe"],
  [/^(undo|scratch that|delete|cancel that)$/, "u"],
];
const toNum = (w: string) => (/^\d{1,3}$/.test(w) ? +w : w in NUM_WORDS ? NUM_WORDS[w] : null);
/** Turns speech into codes. Player number before or after the play ("seven kill" or "kill seven"); opponent numbers after. */
export function spokenToCodes(said: string): string {
  const w = said.toLowerCase().replace(/number|#/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = []; let pendingNum: number | null = null, i = 0;
  const takeNum = (j: number): [number | null, number] => { let n = toNum(w[j] ?? ""); if (n == null) return [null, j]; let k = j + 1; if (n >= 20 && n % 10 === 0 && toNum(w[k] ?? "") != null && toNum(w[k])! < 10) { n += toNum(w[k])!; k++; } return [n, k]; };
  while (i < w.length) {
    const [n, j] = takeNum(i); if (n != null) { pendingNum = n; i = j; continue; }
    let code: string | null = null, used = 0;
    for (let len = 3; len >= 1 && !code; len--) { const phrase = w.slice(i, i + len).join(" "); if (w.length - i < len) continue; for (const [re, c] of SPOKEN) if (re.test(phrase)) { code = c; used = len; break; } }
    if (!code) { i++; continue; }
    i += used;
    if (code === "u") { out.push("u"); pendingNum = null; continue; }
    if (["ok", "oa", "oe", "tp"].includes(code)) { const [on, oj] = takeNum(i); if (on != null) { out.push(code + on); i = oj; } else out.push(code); pendingNum = null; continue; }
    if (pendingNum == null) { const [after, aj] = takeNum(i); if (after != null) { pendingNum = after; i = aj; } }
    out.push((pendingNum != null ? String(pendingNum) : "") + code); pendingNum = null;
  }
  return out.join(" ");
}
