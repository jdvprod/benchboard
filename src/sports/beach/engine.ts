/** Beach volleyball: two players a side, rally scoring, side switches, alternating servers.
 * A match is a list of events; replay() turns them into the score, who serves next, which side each pair is on, and each player's stats.
 * Players are 0 and 1 (us), 2 and 3 (them). */
export type Side = "us" | "them";
export type Format = "bo3" | "one21" | "one28";
export const FORMATS: Record<Format, { label: string; sets: number; to: number[]; sw: number[] }> = {
  bo3: { label: "Best of 3 (21, 21, 15)", sets: 3, to: [21, 21, 15], sw: [7, 7, 5] },
  one21: { label: "One set to 21", sets: 1, to: [21], sw: [7] },
  one28: { label: "One set to 28", sets: 1, to: [28], sw: [7] },
};
/** How a point was won, or a touch that didn't end the rally.
 * K kill · A ace · B block · AE attack error · SE serve error · E other error (net, ball handling, foot fault) · P point, no detail
 * TA attack kept in play · D dig */
export type Code = "K" | "A" | "B" | "AE" | "SE" | "E" | "P" | "TA" | "D";
export const POINT_FOR: Partial<Record<Code, "own" | "other">> = { K: "own", A: "own", B: "own", AE: "other", SE: "other", E: "other" };
export const CODE_LABEL: Record<Code, string> = { K: "Kill", A: "Ace", B: "Block", AE: "Attack error", SE: "Serve error", E: "Error", P: "Point", TA: "Attack in play", D: "Dig" };
export type BeachEvent =
  | { t: "stat"; c: Code; p: number }          // a touch by a player; scores when POINT_FOR says so
  | { t: "pt"; w: Side }                        // a point with no detail
  | { t: "to"; w: Side };                       // timeout
export interface BeachMatch {
  id: string; at: number; format: Format;
  us: string; them: string;                     // pair names, e.g. "Ava / Maya"
  names: [string, string, string, string];
  first: Side;                                  // who serves first in set 1 (set 2 flips, set 3 flips back)
  firstServer: [number, number];                // which partner serves first for us (0|1) and for them (2|3)
  events: BeachEvent[];
}
export interface Line { K: number; AE: number; TA: number; A: number; SE: number; SV: number; B: number; D: number; E: number; PTS: number }
const line = (): Line => ({ K: 0, AE: 0, TA: 0, A: 0, SE: 0, SV: 0, B: 0, D: 0, E: 0, PTS: 0 });
export interface BeachState {
  sets: { us: number; them: number; done: boolean }[];
  setsWon: { us: number; them: number };
  set: number;                                  // index of the set being played
  serving: Side; server: number;                // who serves the next rally
  swapped: boolean;                             // true when our pair is on the far side (they switch every 7, or 5 in the third)
  switchNow: boolean;                           // the last point hit a side switch
  timeouts: { us: number; them: number };       // used this set
  over: boolean; winner: Side | null;
  players: Line[];                              // by player 0–3
  log: { set: number; us: number; them: number; w: Side; text: string }[];
}
const teamOf = (p: number): Side => (p < 2 ? "us" : "them");
const other = (s: Side): Side => (s === "us" ? "them" : "us");

export function replay(m: BeachMatch): BeachState {
  const f = FORMATS[m.format];
  const S: BeachState = { sets: [{ us: 0, them: 0, done: false }], setsWon: { us: 0, them: 0 }, set: 0, serving: m.first, server: 0, swapped: false, switchNow: false, timeouts: { us: 0, them: 0 }, over: false, winner: null, players: [line(), line(), line(), line()], log: [] };
  // each pair alternates servers; `turn` counts how many service turns a pair has started this set
  let turn = { us: 0, them: 0 };
  const serverFor = (s: Side) => { const a = s === "us" ? m.firstServer[0] : m.firstServer[1], b = s === "us" ? 1 - a : 5 - a; return turn[s] % 2 === 0 ? a : b; };
  const startSet = () => { turn = { us: 0, them: 0 }; S.serving = S.set % 2 === 0 ? m.first : other(m.first); S.server = serverFor(S.serving); S.timeouts = { us: 0, them: 0 }; S.swapped = S.set % 2 === 1; };
  startSet();
  const point = (w: Side, text: string) => {
    S.switchNow = false; // the reminder stays up through digs and timeouts, until the next point
    const cur = S.sets[S.set]; cur[w]++; S.players[S.server].SV++;
    S.log.push({ set: S.set, us: cur.us, them: cur.them, w, text });
    if (w !== S.serving) { turn[S.serving]++; S.serving = w; S.server = serverFor(w); } // side-out: the other pair serves, with whoever is next
    const to = f.to[S.set], lead = Math.abs(cur.us - cur.them);
    if (Math.max(cur.us, cur.them) >= to && lead >= 2) {
      cur.done = true; S.setsWon[cur.us > cur.them ? "us" : "them"]++;
      const need = Math.ceil(f.sets / 2);
      if (S.setsWon.us >= need || S.setsWon.them >= need) { S.over = true; S.winner = S.setsWon.us > S.setsWon.them ? "us" : "them"; return; }
      S.set++; S.sets.push({ us: 0, them: 0, done: false }); startSet(); return;
    }
    if ((cur.us + cur.them) % f.sw[S.set] === 0) { S.swapped = !S.swapped; S.switchNow = true; }
  };
  for (const e of m.events) {
    if (S.over) break;
    if (e.t === "to") { S.timeouts[e.w]++; continue; }
    if (e.t === "pt") { point(e.w, `Point ${e.w === "us" ? m.us : m.them}`); continue; }
    const L = S.players[e.p]; if (!L) continue;
    if (e.c === "P") { L.PTS++; point(teamOf(e.p), `Point, ${m.names[e.p]}`); continue; }
    L[e.c as keyof Line]++;
    const who = POINT_FOR[e.c]; if (!who) continue;
    if (who === "own") L.PTS++;
    point(who === "own" ? teamOf(e.p) : other(teamOf(e.p)), `${CODE_LABEL[e.c]}, ${m.names[e.p]}`);
  }
  return S;
}

/** Hitting percentage: (kills − errors) ÷ attempts. */
export const hitPct = (l: Line) => { const n = l.K + l.AE + l.TA; return n ? (l.K - l.AE) / n : null; };
export const pairLine = (S: BeachState, s: Side): Line => { const a = S.players[s === "us" ? 0 : 2], b = S.players[s === "us" ? 1 : 3], o = line(); for (const k of Object.keys(o) as (keyof Line)[]) o[k] = a[k] + b[k]; return o; };
export const scoreLine = (S: BeachState) => S.sets.filter((s) => s.us + s.them > 0).map((s) => `${s.us}-${s.them}`).join(", ");

/** A plain-text summary to paste into a text, email or post. */
export function summary(m: BeachMatch, S: BeachState): string {
  const pct = (l: Line) => { const h = hitPct(l); return h === null ? "-" : (h >= 0 ? "" : "-") + Math.abs(h).toFixed(3).replace(/^0/, ""); };
  const row = (i: number) => { const l = S.players[i]; return `${m.names[i]}: ${l.K} K, ${l.AE} E, ${l.K + l.AE + l.TA} TA (${pct(l)}), ${l.A} A, ${l.SE} SE, ${l.B} B, ${l.D} D`; };
  const head = S.over ? `${S.winner === "us" ? m.us : m.them} def. ${S.winner === "us" ? m.them : m.us} ${S.setsWon[S.winner!]}-${S.setsWon[other(S.winner!)]}` : `${m.us} vs ${m.them}`;
  return [head + ` (${scoreLine(S)})`, "", m.us, row(0), row(1), "", m.them, row(2), row(3)].join("\n");
}

/** A match packed into a short piece of text for a share link: anyone with the link sees the score and box score, no account or server.
 * Stats are a letter and the player (K0, A2…), plain points are u / t, timeouts are < / >. */
const PACK: Record<Code, string> = { K: "K", A: "A", B: "B", AE: "X", SE: "S", E: "E", P: "P", TA: "T", D: "D" };
const UNPACK = Object.fromEntries(Object.entries(PACK).map(([k, v]) => [v, k])) as Record<string, Code>;
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
export function pack(m: BeachMatch): string {
  const ev = m.events.map((e) => (e.t === "stat" ? PACK[e.c] + e.p : e.t === "pt" ? (e.w === "us" ? "u" : "t") : e.w === "us" ? "<" : ">")).join("");
  return b64(JSON.stringify([1, m.format, m.first === "us" ? 0 : 1, m.firstServer, m.names, m.us, m.them, m.at, ev]));
}
export function unpack(s: string): BeachMatch | null {
  try {
    const [v, format, first, firstServer, names, us, them, at, ev] = JSON.parse(unb64(s));
    if (v !== 1 || !FORMATS[format as Format] || !Array.isArray(names) || names.length !== 4 || typeof ev !== "string") return null;
    const events: BeachEvent[] = [];
    for (let i = 0; i < ev.length; i++) {
      const c = ev[i];
      if (c === "u" || c === "t") events.push({ t: "pt", w: c === "u" ? "us" : "them" });
      else if (c === "<" || c === ">") events.push({ t: "to", w: c === "<" ? "us" : "them" });
      else if (UNPACK[c] && /[0-3]/.test(ev[i + 1] || "")) events.push({ t: "stat", c: UNPACK[c], p: +ev[++i] });
      else return null;
    }
    const str = (x: unknown, max: number) => String(x ?? "").slice(0, max);
    return { id: "shared", at: +at || 0, format, first: first ? "them" : "us", firstServer: [firstServer?.[0] === 1 ? 1 : 0, firstServer?.[1] === 3 ? 3 : 2], names: names.map((n: unknown) => str(n, 24)) as BeachMatch["names"], us: str(us, 60), them: str(them, 60), events };
  } catch { return null; }
}
