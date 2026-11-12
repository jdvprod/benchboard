/**
 * Tendency court: where the ball lands, and what to do about it.
 * Turns tapped ball locations into zone percentages and plain-language recommendations
 * for defense, attacking and serving.
 */
import { Loc, Zone, zoneOf } from "./engine";
import { ActionCode } from "./actions";

export type TendencyView = "theirAttack" | "theirServe" | "ourAttack" | "ourServe";

export const VIEW_INFO: Record<TendencyView, { label: string; half: "us" | "them"; types: ActionCode[]; help: string }> = {
  theirAttack: { label: "Their attacks", half: "us", types: ["OK", "D"], help: "Where their kills land and where we dig them, on our side." },
  theirServe: { label: "Their serves", half: "us", types: ["OA", "P0", "P1", "P2", "P3"], help: "Where their serves go and how we pass them." },
  ourAttack: { label: "Our attacks", half: "them", types: ["K", "TA"], help: "Where our kills land and where our attacks get kept in play." },
  ourServe: { label: "Our serves", half: "them", types: ["SA", "SI"], help: "Where our aces and in-serves land." },
};

export interface ZoneCount { total: number; good: number; bad: number }
export interface TendencyResult {
  view: TendencyView;
  points: Loc[];
  zones: Record<string, ZoneCount>;
  total: number; out: number;
  recs: string[];
}

/** "good" means good for us: our kill/ace, our dig, our 3-pass. */
function goodForUs(t: ActionCode): boolean | null {
  switch (t) {
    case "K": case "SA": case "D": case "P3": return true;
    case "OK": case "OA": case "P0": return false;
    default: return null;
  }
}

const ZONE_NAME: Record<string, string> = { 1: "zone 1 (right back)", 2: "zone 2 (right front)", 3: "zone 3 (middle front)", 4: "zone 4 (left front)", 5: "zone 5 (left back)", 6: "zone 6 (middle back)" };
const pct = (n: number, d: number) => Math.round((100 * n) / (d || 1));

export function tendencies(locs: Loc[], view: TendencyView, filter?: { p?: string; op?: string; rot?: number }): TendencyResult {
  const info = VIEW_INFO[view];
  const pts = locs.filter((l) => info.types.includes(l.t) && (!filter?.p || l.p === filter.p) && (!filter?.op || l.op === filter.op) && (!filter?.rot || l.rot === filter.rot));
  const zones: Record<string, ZoneCount> = {};
  let total = 0, out = 0;
  for (const l of pts) {
    const z = zoneOf(l.x, l.y);
    if (z === "out") { out++; continue; }
    if (z == null) continue;
    const zc = zones[z] || (zones[z] = { total: 0, good: 0, bad: 0 });
    zc.total++; total++;
    const g = goodForUs(l.t); if (g === true) zc.good++; else if (g === false) zc.bad++;
  }
  return { view, points: pts, zones, total, out, recs: recommend(view, zones, total, out, pts) };
}

function ranked(zones: Record<string, ZoneCount>, key: keyof ZoneCount) {
  return Object.entries(zones).filter(([, v]) => v[key] > 0).sort((a, b) => b[1][key] - a[1][key]);
}

function recommend(view: TendencyView, zones: Record<string, ZoneCount>, total: number, out: number, pts: Loc[]): string[] {
  const recs: string[] = [];
  if (total < 5) return [total ? `Only ${total} marked so far. Recommendations show up after about 5.` : "No locations marked yet. In Settings, choose which plays ask where the ball landed, then tap the court after each one."];
  if (view === "theirAttack") {
    const kills = ranked(zones, "bad"), killTotal = kills.reduce((n, [, v]) => n + v.bad, 0);
    if (kills.length) {
      const [z, v] = kills[0];
      recs.push(`${pct(v.bad, killTotal)}% of their kills land in ${ZONE_NAME[z]}. Start a defender deeper there or shade the block to take it away.`);
      if (kills[1] && kills[1][1].bad >= 2) recs.push(`Next most: ${ZONE_NAME[kills[1][0]]} (${pct(kills[1][1].bad, killTotal)}%).`);
    }
    const line = (zones[1]?.bad || 0) + (zones[5]?.bad || 0), seam = zones[6]?.bad || 0, tips = (zones[2]?.bad || 0) + (zones[3]?.bad || 0) + (zones[4]?.bad || 0);
    if (killTotal >= 4 && tips / killTotal >= 0.35) recs.push(`${pct(tips, killTotal)}% of their kills fall in the front row. Expect tips and roll shots: bring an off-blocker or setter to cover short.`);
    if (killTotal >= 4 && seam / killTotal >= 0.3) recs.push("They're finding the middle back. Keep your zone 6 defender deep and centered.");
    if (killTotal >= 4 && line / killTotal >= 0.5) recs.push("Most kills go to the deep corners. Set your line defender at the sideline and keep the block on the angle.");
    const digs = ranked(zones, "good");
    if (digs.length) recs.push(`You dig the most in ${ZONE_NAME[digs[0][0]]}. That spot is covered; adjust elsewhere first.`);
  }
  if (view === "theirServe") {
    const aces = ranked(zones, "bad");
    if (aces.length) recs.push(`Their aces and 0-passes come from ${ZONE_NAME[aces[0][0]]}. Shift your passers or move a stronger passer there.`);
    const most = ranked(zones, "total")[0];
    if (most) recs.push(`They serve ${ZONE_NAME[most[0]]} most (${pct(most[1].total, total)}%). Expect it there first.`);
  }
  if (view === "ourAttack") {
    const kills = ranked(zones, "good"), dug = Object.entries(zones).map(([z, v]) => [z, v.total - v.good] as [string, number]).sort((a, b) => b[1] - a[1]);
    if (kills.length) recs.push(`Your kills land most in ${ZONE_NAME[kills[0][0]]} (${pct(kills[0][1].good, kills.reduce((n, [, v]) => n + v.good, 0))}% of kills). Keep attacking it.`);
    const open = (["1", "5", "6"] as const).filter((z) => !zones[z] || zones[z].total === 0);
    if (open.length && total >= 8) recs.push(`You rarely attack ${open.map((z) => ZONE_NAME[z]).join(" or ")}. Try it to make their defense move.`);
    if (dug[0] && dug[0][1] >= 3) recs.push(`Attacks to ${ZONE_NAME[dug[0][0]]} get dug the most (${dug[0][1]}). Hit away from their best defender there.`);
  }
  if (view === "ourServe") {
    const aces = ranked(zones, "good");
    if (aces.length) recs.push(`Your aces come from serving ${ZONE_NAME[aces[0][0]]}. Keep targeting it.`);
    const most = ranked(zones, "total")[0];
    if (most && pct(most[1].total, total) >= 40) recs.push(`${pct(most[1].total, total)}% of your serves go to ${ZONE_NAME[most[0]]}. Mix in other zones so they can't settle in.`);
  }
  if (out >= 3) recs.push(`${out} marked out of bounds.`);
  const byP: Record<string, number> = {};
  if (view === "theirAttack") for (const l of pts) if (l.t === "OK" && l.op) byP[l.op] = (byP[l.op] || 0) + 1;
  const topOpp = Object.entries(byP).sort((a, b) => b[1] - a[1])[0];
  if (topOpp && topOpp[1] >= 3) recs.push(`Their #${topOpp[0]} has the most marked kills (${topOpp[1]}). Filter by that number to see their spots.`);
  return recs;
}

export const ALL_ZONES: Exclude<Zone, "out">[] = [1, 2, 3, 4, 5, 6];
