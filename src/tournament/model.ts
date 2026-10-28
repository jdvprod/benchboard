/** Tournament days: our games (pool, bracket, work/ref duties), the pool's other results and the standings. Pure: unit tested. */

export interface TGame {
  id: string; stage: "pool" | "bracket" | "work"; round?: string; time?: string; court?: string; day?: string;
  /** Opponent, or for a work game the two teams we're reffing ("Team A vs Team B"). */
  opp: string;
  bestOf: number; scoring: string; // scoring like "25", "25c27", "21"
  matchId?: string;
}
export interface TOther { id: string; a: string; b: string; sets: [number, number][] }
export interface Tournament {
  id: string; name: string; start: string; end?: string; site?: string;
  poolName?: string; poolTeams: string[]; bracketName?: string;
  games: TGame[]; others: TOther[]; createdAt: number;
}
/** One of our played (or live) games, as the standings need it. */
export interface OurResult { opp: string; sets: [number, number][]; over: boolean }

export interface Standing { team: string; us?: boolean; w: number; l: number; sw: number; sl: number; pf: number; pa: number; matchPct: number | null; setPct: number | null; ptPct: number | null }

const key = (s: string) => s.trim().toLowerCase();
const pct = (a: number, b: number) => (a + b ? a / (a + b) : null);

/** Pool standings: match record, then set %, then point % (the usual club tiebreakers). Only finished matches count. */
export function standings(us: string, pool: string[], ours: OurResult[], others: TOther[]): Standing[] {
  const rows = new Map<string, Standing>();
  const row = (name: string, isUs = false) => { const k = isUs ? "\u0000us" : key(name); let r = rows.get(k); if (!r) { r = { team: name, us: isUs || undefined, w: 0, l: 0, sw: 0, sl: 0, pf: 0, pa: 0, matchPct: null, setPct: null, ptPct: null }; rows.set(k, r); } return r; };
  row(us, true); pool.filter((t) => t.trim()).forEach((t) => row(t));
  const add = (a: Standing, b: Standing, sets: [number, number][]) => {
    let wa = 0, wb = 0;
    for (const [x, y] of sets) { a.pf += x; a.pa += y; b.pf += y; b.pa += x; if (x > y) wa++; else if (y > x) wb++; }
    a.sw += wa; a.sl += wb; b.sw += wb; b.sl += wa;
    if (wa > wb) { a.w++; b.l++; } else if (wb > wa) { b.w++; a.l++; }
  };
  for (const r of ours) if (r.over && r.sets.length) add(row(us, true), row(r.opp), r.sets);
  for (const o of others) if (o.sets.length && o.a.trim() && o.b.trim()) add(row(o.a), row(o.b), o.sets);
  const out = [...rows.values()];
  for (const r of out) { r.matchPct = pct(r.w, r.l); r.setPct = pct(r.sw, r.sl); r.ptPct = pct(r.pf, r.pa); }
  const v = (x: number | null) => (x == null ? -1 : x);
  return out.sort((a, b) => b.w - a.w || a.l - b.l || v(b.setPct) - v(a.setPct) || v(b.ptPct) - v(a.ptPct) || a.team.localeCompare(b.team));
}

/** The next game to play: the first scheduled one (in time order) without a finished match. */
export function nextGame(t: Tournament, done: (matchId: string) => boolean): TGame | null {
  const order = (g: TGame) => (g.day || t.start) + " " + (g.time || "99:99");
  return t.games.filter((g) => g.stage !== "work" && !(g.matchId && done(g.matchId))).sort((a, b) => order(a).localeCompare(order(b)))[0] || null;
}

/** Is the tournament on (or around) this date? */
export const isOn = (t: Tournament, today: string) => today >= t.start && today <= (t.end || t.start);
export const sortGames = (t: Tournament) => t.games.slice().sort((a, b) => ((a.day || t.start) + (a.time || "99")).localeCompare((b.day || t.start) + (b.time || "99")));
