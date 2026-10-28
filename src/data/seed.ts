/** Starter content: a drill library for every new team, and a full sample team to explore. */
import { Drill, Match, Player, PracticePlan } from "./model";
import { all, appendEvents, createTeam, localISO, save, setTeamPatch, team, uid } from "./store";
import { SAMPLE_ROSTER, sampleMatch } from "../sports/volleyball/sample";

const DRILLS: [string, string, number, string, string[]][] = [
  ["Dynamic warm-up + arm care", "Warm-up", 10, "Jog, skips, lunges, band work for shoulders.", []],
  ["Partner pepper", "Warm-up", 8, "Pass, set, hit in pairs. Controlled ball, keep it going.", ["passing"]],
  ["Serve to zones", "Serving", 10, "Call a zone, serve to it. Count makes out of 10 per player.", ["serving"]],
  ["Serve under pressure", "Serving", 8, "Miss and the team runs; make 5 in a row to finish.", ["serving"]],
  ["Three-person serve receive", "Serve receive", 15, "Live servers, three passers. Grade every pass 0–3; rotate on a 3.", ["passing"]],
  ["Butterfly", "Serve receive", 12, "Serve, pass to target, follow your ball. Continuous rotation.", ["passing", "serving"]],
  ["Setter location reps", "Setting", 10, "Setter takes tossed balls from different spots, sets to OH/OPP/MB.", ["setting"]],
  ["Hitting lines: OH / OPP / MB", "Attacking", 15, "Coach-tossed or setter-fed; call shots: line, angle, tip.", ["attacking"]],
  ["Out-of-system hitting", "Attacking", 10, "Bad pass on purpose; non-setter sets high outside; hitter scores smart.", ["attacking"]],
  ["Block footwork + seal", "Blocking", 10, "Shuffle and crossover to the pins, press over, seal the net.", ["blocking"]],
  ["Dig from coach on box", "Defense", 12, "Coach hits from a box at OH/OPP spots; defenders read and dig to target.", ["defense"]],
  ["Free ball to transition", "Transition", 10, "Free ball over, pass, set, attack. Hitters transition off the net.", ["transition"]],
  ["Wash drill (6 v 6)", "Game play", 20, "Need to win two rallies in a row (serve + free ball) to score a point.", ["game"]],
  ["Rotation scrimmage", "Game play", 20, "Play out a specific weak rotation over and over.", ["game"]],
  ["Sprints / lateral shuffles", "Conditioning", 8, "Court sprints and shuffles between drills.", []],
  ["Huddle: goals for today", "Team talk", 5, "Two goals for practice, one from the last match's stats.", []],
];

export function addStarterDrills(teamId: string) {
  for (const [name, category, minutes, description, focus] of DRILLS)
    save("drills", { id: uid("dr"), teamId, name, category, minutes, description, focus } as Drill, true);
}

export function createSampleTeam() {
  const t = createTeam({ name: "Sample Team", level: "Varsity", color: "#2A78AE", sample: true });
  addStarterDrills(t.id);
  const idMap: Record<string, string> = {};
  for (const sp of SAMPLE_ROSTER) {
    const p: Player = { id: uid("p"), teamId: t.id, num: sp.num, first: sp.first, last: sp.last, pos: sp.pos, grad: sp.grad, height: "", active: true, goals: [], notes: "" };
    idMap[sp.id] = p.id; save("players", p, true);
  }
  const remap = (evs: any[]) => evs.map((e) => {
    const x = { ...e };
    for (const k of ["p", "out", "in", "lib", "libSrv"]) if (x[k] && idMap[x[k]]) x[k] = idMap[x[k]];
    if (x.lu) x.lu = x.lu.map((id: string) => idMap[id] || id);
    return x;
  });
  const opps = ["Ridgeview", "Lakeside", "Westbrook", "Valley Prep"];
  const day = 86400000, now = Date.now();
  opps.forEach((opp, i) => {
    const date = new Date(now - (opps.length - i) * 7 * day);
    const m: Match = {
      id: uid("m"), teamId: t.id, seasonId: t.activeSeasonId, kind: "match", opp, date: localISO(date), bestOf: 5, status: "done",
      site: i >= 2 ? "neutral" : i % 2 ? "away" : "home", event: i >= 2 ? "Harvest Invitational" : "League", notes: "", oppPlayers: ["11", "7", "3", "15", "9"], scrim: null, filmStart: null, nextLu: null,
      report: "", reportAt: null, planId: null, createdAt: date.getTime(), sample: true,
    };
    save("matches", m, true);
    save("opponents", { id: uid("o"), teamId: t.id, name: opp, notes: i === 0 ? "Their #11 outside hits line when the set is tight. Setter dumps on 2 when front row." : "", scout: "", scoutAt: null }, true);
    appendEvents(m.id, remap(sampleMatch(11 + i * 7, date.getTime(), { sets: 5, finished: true, strength: [1.1, 0.95, 1.15, 1.0][i] })) as any);
  });
  // a live match in progress
  const live: Match = {
    id: uid("m"), teamId: t.id, seasonId: t.activeSeasonId, kind: "match", opp: "Ridgeview", date: localISO(new Date()), bestOf: 5, status: "live",
    site: "home", event: "League", notes: "Rematch. Their #11 hits line when tight.", oppPlayers: ["11", "7", "3", "15", "9"], scrim: null, filmStart: null, nextLu: null,
    report: "", reportAt: null, planId: null, createdAt: now, sample: true,
  };
  save("matches", live, true);
  appendEvents(live.id, remap(sampleMatch(11, now - 90 * 60000, { sets: 2 })) as any);
  // a practice plan built from the starter drills, plus a goal so the player page shows progress
  const ds = all("drills").filter((d) => d.teamId === t.id);
  const pick = ["Dynamic warm-up + arm care", "Three-person serve receive", "Out-of-system hitting", "Dig from coach on box", "Rotation scrimmage", "Huddle: goals for today"];
  const tomorrow = localISO(new Date(now + day));
  save("plans", { id: uid("pl"), teamId: t.id, seasonId: t.activeSeasonId, date: tomorrow, title: "Serve receive + rotation 2", start: "15:30", notes: "Focus from the Westbrook match: passing and rotation 2.", status: "planned", createdAt: now,
    blocks: pick.map((n) => ds.find((d) => d.name === n)).filter(Boolean).map((d) => ({ id: uid("b"), title: d!.name, category: d!.category, minutes: d!.minutes, notes: d!.description, drillId: d!.id })) } as PracticePlan, true);
  const maya = all("players").find((p) => p.teamId === t.id && p.num === "7");
  if (maya) save("players", { ...maya, goals: [{ id: uid("g"), metric: "hitting", target: 0.3 }, { id: uid("g"), metric: "passAvg", target: 2.2 }] }, true);
  const iso = (d: number) => localISO(new Date(now + d * day));
  setTeamPatch({ schedule: [
    { id: uid("sc"), date: iso(3), time: "18:00", opp: "Lakeside", site: "away", event: "League" },
    { id: uid("sc"), date: iso(7), time: "17:30", opp: "Westbrook", site: "home", event: "League" },
    { id: uid("sc"), date: iso(12), time: "09:00", opp: "Valley Prep", site: "neutral", event: "Fall Classic" },
  ] });
  const ids = SAMPLE_ROSTER.map((s) => idMap[s.id]);
  setTeamPatch({ currentMatchId: live.id, defLineup: { lu: ["1", "7", "9", "14", "4", "12"].map((n) => idMap["sp" + n]), lib: idMap.sp3, libSrv: null } });
  return { team: team()!, ids, all: all("players") };
}
