/** The data behind a Benchboard Recruit profile: a snapshot of the player's details, season stats, game log and highlight clips. */
import { eventsOf, matchesOf, player, replayOf, seasonsOf, team } from "../../data/store";
import { aggregate, resultOf } from "../../sports/volleyball/engine";
import { ACTIONS } from "../../sports/volleyball/actions";
import { blocks, hitting, passAvg, playerMetrics } from "../../sports/volleyball/metrics";
import { Clip, clipsFrom, filmTiming, highlightPick, playName, shareable } from "../../film/clips";

export interface RecruitGame { date: string; opp: string; res: string; sets: number; K: number; AE: number; TA: number; SA: number; SE: number; R: number; RS: number; D: number; BS: number; BA: number; AST: number }
export interface RecruitData {
  v: 1; updated: number;
  player: { first: string; last: string; num: string; pos: string; grad: number | null; height: string };
  team: { name: string; level: string; season: string };
  profile: { club?: string; gpa?: string; email?: string; phone?: string; reach?: string; approach?: string; block?: string; hand?: string; video?: string; about?: string; coachContact?: string };
  season: { matches: number; sets: number; K: number; AE: number; TA: number; SA: number; SE: number; R: number; D: number; BS: number; BA: number; AST: number; hitting: number | null; kps: number | null; acesPs: number | null; serveIn: number | null; passAvg: number | null; dps: number | null; bps: number | null; aps: number | null };
  games: RecruitGame[];
  clips: Clip[];
}

/** Every clip of this player's plays from season matches whose video can be shared publicly. */
export function playerClips(id: string): Clip[] {
  const t = team()!, out: Clip[] = [];
  for (const m of matchesOf().filter((x) => x.kind === "match" && x.video && shareable(x.video) && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).reverse()) {
    const R = replayOf(m); if (!R) continue;
    out.push(...clipsFrom(m, filmTiming(m, R, eventsOf(m.id)), R.log, (l) => l.kind === "stat" && l.p === id, (l) => playName((l as any).t, (ACTIONS as any)[(l as any).t]?.long)));
  }
  return out;
}

export function recruitData(id: string, opts: { clips?: Clip[] } = {}): RecruitData {
  const p = player(id)!, t = team()!, pr = p.profile || {};
  const ms = matchesOf().filter((x) => x.kind === "match" && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).reverse();
  const games: RecruitGame[] = [], sets = [];
  for (const m of ms) {
    const R = replayOf(m); if (!R) continue; const A = aggregate(R.sets), s = A.ps[id]; if (!s && !A.pm[id]) continue;
    sets.push(...R.sets);
    const r = resultOf(R);
    games.push({ date: m.date, opp: m.opp, res: r ? `${r} ${R.wonUs}-${R.wonThem}` : `${R.wonUs}-${R.wonThem}`, sets: A.setsPlayed[id] || 0, K: s?.K || 0, AE: s?.AE || 0, TA: s?.TA || 0, SA: s?.SA || 0, SE: s ? s.SE + s.SEN + s.SEO : 0, R: s?.R || 0, RS: s?.RS || 0, D: s?.D || 0, BS: s?.BS || 0, BA: s?.BA || 0, AST: s?.AST || 0 });
  }
  const A = aggregate(sets), s = A.ps[id], pm = playerMetrics(A, id);
  const z = { K: 0, AE: 0, TA: 0, SA: 0, SE: 0, SEN: 0, SEO: 0, R: 0, RS: 0, D: 0, BS: 0, BA: 0, AST: 0 } as any, S = s || z;
  const keep = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));
  return {
    v: 1, updated: Date.now(),
    player: { first: p.first, last: p.last, num: p.num, pos: p.pos, grad: p.grad, height: p.height },
    team: { name: t.name, level: t.level || "", season: seasonsOf().find((x) => x.id === t.activeSeasonId)?.name || "" },
    profile: keep({ club: pr.club, gpa: pr.gpa, email: pr.email, phone: pr.phone, reach: pr.reach, approach: pr.approach, block: pr.block, hand: pr.hand, video: pr.video, about: pr.about, coachContact: pr.coachContact }),
    season: { matches: games.length, sets: pm.sets, K: S.K, AE: S.AE, TA: S.TA, SA: S.SA, SE: S.SE + S.SEN + S.SEO, R: S.R, D: S.D, BS: S.BS, BA: S.BA, AST: S.AST, hitting: s ? hitting(s) : null, kps: pm.kps, acesPs: pm.acesPs, serveIn: pm.serveIn, passAvg: s ? passAvg(s) : null, dps: pm.dps, bps: s && pm.sets ? blocks(s) / pm.sets : null, aps: pm.aps },
    games,
    clips: (opts.clips ?? highlightPick(playerClips(id))).map(({ p: _p, ...c }) => c),
  };
}
