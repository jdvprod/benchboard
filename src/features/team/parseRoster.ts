/** Reads a pasted roster line: "7 Maya Chen OH 2027", "#12 Sofia Nguyen MB 5'11\" Jr.", "Ava Ramirez, setter, 1".
 * Pure, so it's unit tested. Jersey number, name, position, graduation year (or class: Fr, So, Jr, Sr) and height, in any order after the name starts. */

export interface RosterLine { num: string; first: string; last: string; pos: string; grad: number | null; height: string }

const POS: Record<string, string> = {
  OH: "OH", OUTSIDE: "OH", LS: "OH", OUT: "OH", MB: "MB", MH: "MB", MIDDLE: "MB", MID: "MB", OPP: "OPP", OPPOSITE: "OPP", RS: "OPP", RIGHT: "OPP", RH: "OPP",
  S: "S", SETTER: "S", L: "L", LIB: "L", LIBERO: "L", DS: "DS", DEF: "DS", DEFENSE: "DS", "DEFENSIVE SPECIALIST": "DS",
};
const CLASS: Record<string, number> = { FR: 3, FRESH: 3, FRESHMAN: 3, SO: 2, SOPH: 2, SOPHOMORE: 2, JR: 1, JUNIOR: 1, SR: 0, SENIOR: 0 };

/** The year the current school year ends: fall 2026 and spring 2027 are both the class of 2027's senior year. */
export function schoolYearEnd(d = new Date()): number { return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(); }

const key = (w: string) => w.toUpperCase().replace(/[.()]/g, "");
/** "OH/RS" or "S-OPP": the first part that's a position. */
const posOf = (w: string): string => { for (const part of key(w).split(/[/-]/)) if (POS[part]) return POS[part]; return ""; };

export function parseRosterLine(line: string, now = new Date()): RosterLine | null {
  // heights first, so 5' 10" stays one token: 5'10", 5’10”, 5-10, 6'0
  const heights: string[] = [];
  let text = line.replace(/(?<![\d/])([4-7])\s*(?:['’′]\s*|-)(\d{1,2})\s*(?:"|”|″|'')?(?![\d/])/g, (_m, f, i) => { if (+i > 11) return _m; heights.push(`${f}'${+i}"`); return " "; });
  text = text.replace(/defensive specialist/gi, "DS");
  const tok = text.replace(/[,\t|;]/g, " ").split(/\s+/).filter(Boolean);
  if (!tok.length) return null;
  let num = "", grad: number | null = null, pos = "";
  const names: string[] = [];
  for (const w of tok) {
    if (!num && /^#?\d{1,3}$/.test(w)) num = w.replace("#", "");
    else if (/^(?:'|’)?(19|20)\d\d$/.test(w)) grad = +w.replace(/\D/g, "");
    else if (/^(?:'|’)\d\d$/.test(w)) grad = 2000 + +w.slice(1); // '27
    else if (CLASS[key(w)] !== undefined && names.length) grad = schoolYearEnd(now) + CLASS[key(w)];
    else names.push(w);
  }
  // the position is the last position word after the first name ("Ava Setter S" is Ava Setter, a setter)
  for (let i = names.length - 1; i > 0; i--) { const p = posOf(names[i]); if (p) { pos = p; names.splice(i, 1); break; } }
  if (!num && !names.length) return null;
  return { num, first: names[0] || "", last: names.slice(1).join(" "), pos, grad, height: heights[0] || "" };
}

/* ---------- single cells, for spreadsheet imports ---------- */
/** A position cell: "OH", "Outside", "OH/RS", "Defensive Specialist". Empty when it isn't a position. */
export function positionCell(raw: string): string {
  const v = raw.trim(); if (!v) return "";
  if (/defensive\s+spec/i.test(v)) return "DS";
  for (const w of v.split(/\s+/)) { const p = posOf(w); if (p) return p; }
  return "";
}
/** A grad-year or class cell: "2028", "'28", "Jr.", "Junior", "11" (grade). */
export function gradCell(raw: string, now = new Date()): number | null {
  const v = raw.trim(); if (!v) return null;
  const y = v.match(/^(?:'|’)?((?:19|20)\d\d)$/); if (y) return +y[1];
  const s = v.match(/^(?:'|’)(\d\d)$/); if (s) return 2000 + +s[1];
  if (CLASS[key(v)] !== undefined) return schoolYearEnd(now) + CLASS[key(v)];
  const g = v.match(/^(9|10|11|12)(?:th)?$/i); if (g) return schoolYearEnd(now) + (12 - +g[1]);
  return null;
}
/** A height cell: 5'10", 5-10, 5 10, 70 (inches). */
export function heightCell(raw: string): string {
  const v = raw.trim(); if (!v) return "";
  const m = v.match(/^([4-7])\s*(?:['’′]|-|\s)\s*(\d{1,2})\s*(?:"|”|″|'')?$/); if (m && +m[2] <= 11) return `${m[1]}'${+m[2]}"`;
  const inches = v.match(/^(\d{2})\s*(?:in|")?$/); if (inches && +inches[1] >= 48 && +inches[1] <= 84) return `${Math.floor(+inches[1] / 12)}'${+inches[1] % 12}"`;
  return v;
}
