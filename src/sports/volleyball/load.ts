/** Workload: each player's volleyball minutes this week against their usual week, from what the coach already
 *  records (practice minutes × attendance, and rallies on the court in tracked matches). No health data.
 *  Flags a sudden jump (this week at 1.5× or more of the four weeks before) and a week without a day off. */

/** One player's minutes on one day. */
export interface LoadEntry { date: string; id: string; min: number }
export interface LoadRow { id: string; week: number; avg: number | null; ratio: number | null; streak: number; flag: "spike" | "streak" | null }

/** Minutes a rally adds, counting the time between rallies: an estimate, and labeled as one. */
export const MIN_PER_RALLY = 0.5;
export const SPIKE = 1.5;

const day = (iso: string, n: number) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function workload(entries: LoadEntry[], ids: string[], today: string): LoadRow[] {
  const wk0 = day(today, -6), base0 = day(today, -34), base1 = day(today, -7);
  return ids.map((id) => {
    const mine = entries.filter((e) => e.id === id && e.min > 0 && e.date <= today);
    const week = Math.round(mine.filter((e) => e.date >= wk0).reduce((s, e) => s + e.min, 0));
    const base = mine.filter((e) => e.date >= base0 && e.date <= base1);
    const avg = base.length ? Math.round(base.reduce((s, e) => s + e.min, 0) / 4) : null;
    const ratio = avg && avg >= 30 ? week / avg : null;
    const days = new Set(mine.map((e) => e.date));
    let streak = 0, d = days.has(today) ? today : day(today, -1);
    while (days.has(d)) { streak++; d = day(d, -1); }
    const flag: LoadRow["flag"] = ratio != null && ratio >= SPIKE ? "spike" : streak >= 7 ? "streak" : null;
    return { id, week, avg, ratio, streak, flag };
  }).sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || b.week - a.week);
}
