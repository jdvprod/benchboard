/** Playing time from the tracked lineups and subs: sets played and started, rallies on the court, and the team's
 *  point difference while each player was out there. Sets tracked without a lineup can't count, and say so. */
import { SetState } from "./engine";

export interface PlayTime { id: string; sets: number; started: number; rallies: number; share: number; won: number; lost: number }
export interface PlayTimeReport { rows: PlayTime[]; sets: number; withLineup: number; rallies: number }

export function playTime(sets: SetState[], ids: string[]): PlayTimeReport {
  const by = new Map<string, PlayTime>(ids.map((id) => [id, { id, sets: 0, started: 0, rallies: 0, share: 0, won: 0, lost: 0 }]));
  let withLineup = 0, rallies = 0;
  const played = sets.filter((s) => s.rallies.length > 0);
  for (const s of played) {
    const first = s.rallies.find((r) => r.onCourt.length);
    if (!first) continue;
    withLineup++;
    const starters = new Set(first.onCourt), inSet = new Set<string>();
    for (const r of s.rallies) {
      if (!r.onCourt.length) continue;
      rallies++;
      for (const id of r.onCourt) {
        const x = by.get(id); if (!x) continue;
        x.rallies++; if (r.w === "us") x.won++; else x.lost++; inSet.add(id);
      }
    }
    inSet.forEach((id) => { by.get(id)!.sets++; });
    starters.forEach((id) => { const x = by.get(id); if (x) x.started++; });
  }
  const rows = [...by.values()].map((x) => ({ ...x, share: rallies ? x.rallies / rallies : 0 })).sort((a, b) => b.rallies - a.rallies || b.sets - a.sets);
  return { rows, sets: played.length, withLineup, rallies };
}
