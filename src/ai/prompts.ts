/** Turns stats into text Claude can reason over. Numbers only come from the data, never invented.
 * Privacy: players appear only as jersey number and first name (no last names, contact details or notes). */
import { activePlayers, matchesOf, oppKey, opponentsOf, player, playerName, replayOf, team, teamPlayers } from "../data/store";
import { Match } from "../data/model";
import { aggregate, Agg, runOf, serverOf, Stat, zoneOf } from "../sports/volleyball/engine";
import { CONTEXT_LABEL, AttackContext } from "../sports/volleyball/actions";
import { blocks, fmtAvg, fmtHit, fmtPct, hitting, passAvg, playerMetrics, ratio, serveAttempts, serveErrors, serveInPct, teamErrorsGiven, teamMetrics } from "../sports/volleyball/metrics";
import { flags } from "../sports/volleyball/flags";
import { tendencies } from "../sports/volleyball/tendencies";

export const FORMAT = 'Format: section titles on their own line ending with a colon, bullets starting with "- ". Cite numbers from the data. Never invent stats. Name players by number and first name.';
const pct = (w: number, n: number) => fmtPct(ratio(w, n));

export function statLine(s: Stat) {
  return `${s.K}K ${s.AE}E ${s.TA}TA (hit ${fmtHit(hitting(s))}${s.KT ? `, ${s.KT} kills off the block` : ""}${s.AB ? `, blocked ${s.AB} times` : ""}); ${s.AST} assists, ${s.BHE} setting errors; serve ${s.SA} aces, ${s.SEN} net, ${s.SEO + s.SE} out of ${serveAttempts(s)}; pass ${fmtAvg(passAvg(s))} on ${s.R} (${s.R3} perfect, ${s.P0} zeros); ${s.D} digs, ${s.DE} dig errors; ${blocks(s)} blocks, ${s.BE} block/net errors; comm/effort/positioning ${s.CE}/${s.EE}/${s.PE}`;
}
export function teamLine(A: Agg) {
  const M = teamMetrics(A), T = A.T;
  return `hitting ${fmtHit(M.hitting)} (${T.K}K ${T.AE}E ${T.TA}TA), in-system ${fmtHit(M.hitInSystem)}, out-of-system ${fmtHit(M.hitOutOfSystem)}, transition ${fmtHit(M.hitTransition)}; serving ${fmtPct(M.serveIn)} in, ${T.SA} aces, ${serveErrors(T)} errors; pass avg ${fmtAvg(M.passAvg)} (${fmtPct(M.perfectPass)} perfect); side-out ${pct(A.so.w, A.so.n)}, side-out after 3/2/1 pass ${fmtPct(M.soByPass.P3)}/${fmtPct(M.soByPass.P2)}/${fmtPct(M.soByPass.P1)}; first-ball side-out ${fmtPct(M.firstBallSO)}; point-scoring ${pct(A.psc.w, A.psc.n)}; digs ${T.D}, dig errors ${T.DE}; blocks ${blocks(T)}; free balls won ${A.fbr.w}/${A.fbr.n}; points we gave away ${teamErrorsGiven(A)}; their errors ${A.team.OE}`;
}

export function snapshot(m: Match): string {
  const R = replayOf(m); if (!R || !R.cur) return "No match in progress.";
  const c = R.cur, t = team()!, mA = aggregate(R.sets), sA = aggregate([c]), L: string[] = [];
  if (m.scrim) {
    const S = m.scrim;
    L.push(`INTRASQUAD SCRIMMAGE for ${t.name}: Team 1 = ${S.a.name}, Team 2 = ${S.b.name}. Games to ${c.target}.`);
    L.push("GAMES: " + R.sets.map((s) => `G${s.n} ${s.us}–${s.them}${s.over ? "" : " (in progress)"}`).join(", "));
    for (const k of ["a", "b"] as const) {
      L.push(`${S[k].name.toUpperCase()}: ${statLine(mA.side[k])}`);
      for (const id of Object.keys(mA.ps).filter((id) => mA.pside[id] === k)) L.push(`- ${playerName(id)} (${player(id)?.pos}): ${statLine(mA.ps[id])}`);
    }
    if (m.notes) L.push("COACH NOTES: " + m.notes);
    return L.join("\n");
  }
  const run = runOf(c), opp = m.opp;
  L.push(`MATCH: ${t.name} (us) vs ${opp}, best of ${m.bestOf}. Sets won: us ${R.wonUs}, them ${R.wonThem}.${R.matchOver ? " MATCH IS OVER." : ""}`);
  L.push("Set scores: " + R.sets.map((s) => `S${s.n} ${s.us}–${s.them}${s.over ? "" : " (in progress)"}`).join(", ") + `. Sets to ${c.target}, win by 2.`);
  L.push(`CURRENT: Set ${c.n}, us ${c.us} – them ${c.them}. Serving: ${c.serve === "us" ? t.name : opp}. Rotation ${c.rot}. Timeouts left: us ${2 - c.to.us}, them ${2 - c.to.them}. Subs used: ${c.subs}${t.settings.subLimit ? " of " + t.settings.subLimit : ""}. Run: ${run.n ? (run.side === "us" ? t.name : opp) + " " + run.n + "–0" : "none"}.`);
  if (c.lu) {
    L.push("ON COURT (position: player): " + c.lu.map((id, i) => `P${i + 1}${i === 0 ? "(server spot)" : ""} ${playerName(id)} ${player(id)?.pos || ""}`).join("; ") + ". Front row is P2, P3, P4." + (c.lib ? " Libero: " + playerName(c.lib) + "." : ""));
    const bench = activePlayers().filter((p) => !c.lu!.includes(p.id) && p.id !== c.lib).map((p) => `#${p.num} ${p.first} (${p.pos})`);
    if (bench.length) L.push("BENCH: " + bench.join(", "));
    const s = serverOf(c); if (s) L.push("SERVING NOW: " + playerName(s));
  }
  L.push("TEAM THIS SET: " + teamLine(sA));
  L.push("TEAM MATCH: " + teamLine(mA));
  L.push("PLAYERS (match):");
  for (const p of teamPlayers()) { const s = mA.ps[p.id]; if (!s) continue; const pm = playerMetrics(mA, p.id); L.push(`- #${p.num} ${p.first} (${p.pos}): ${statLine(s)}; +/- ${pm.plusMinus ?? "n/a"}`); }
  L.push("ATTACK BY FIRST CONTACT: " + (Object.keys(CONTEXT_LABEL) as AttackContext[]).filter((k) => mA.ctx[k]).map((k) => { const C = mA.ctx[k]!; return `${CONTEXT_LABEL[k]}: hit ${fmtHit(hitting({ K: C.team.K, AE: C.team.E, TA: C.team.TA }))} on ${C.team.TA} (sets to ${Object.entries(C.p).filter((x) => x[0] !== "_").sort((a, b) => b[1].TA - a[1].TA).slice(0, 3).map(([id, v]) => playerName(id) + " " + v.TA).join(", ")})`; }).join("; "));
  L.push("ROTATIONS (match): " + [1, 2, 3, 4, 5, 6].map((r) => { const x = mA.rot[r]; return `R${r} ${x.w}-${x.l} (side-out ${x.rw}/${x.rn}, on serve ${x.sw}/${x.sn})`; }).join("; "));
  const opps = Object.entries(mA.opp).sort((a, b) => b[1].K - a[1].K);
  if (opps.length) L.push("THEIR PLAYERS: " + opps.map(([n, o]) => `#${n} ${o.K} kills (zones ${Object.entries(o.z).map(([z, c]) => (z === "out" ? "out" : "Z" + z) + "×" + c).join(" ") || "n/a"}), ${o.A} aces, ${o.E} errors`).join("; "));
  const tA = tendencies(mA.locs, "theirAttack"); if (tA.total) L.push("WHERE THEIR KILLS/OUR DIGS LAND: " + tA.recs.join(" "));
  const tO = tendencies(mA.locs, "ourAttack"); if (tO.total) L.push("WHERE OUR ATTACKS LAND: " + tO.recs.join(" "));
  L.push("LAST RALLIES THIS SET (U=us, T=them): " + (c.rallies.slice(-15).map((r) => (r.w === "us" ? "U" : "T")).join(" ") || "none"));
  const f = flags(R, { us: t.name, them: opp, subLimit: t.settings.subLimit, playerIds: activePlayers().map((p) => p.id), short: (id) => playerName(id) });
  if (f.length) L.push("AUTO FLAGS: " + f.map((x) => x.title + " " + x.detail).join(" | "));
  const o = opponentsOf().find((x) => oppKey(x.name) === oppKey(opp));
  if (o?.notes) L.push("SCOUTING NOTES ON " + opp + ": " + o.notes);
  if (m.notes) L.push("MATCH NOTES: " + m.notes);
  return L.join("\n");
}

export const timeoutPrompt = (m: Match) => `TIMEOUT RIGHT NOW in a live volleyball match. Give the head coach exactly three lines and nothing else:
Working: ...
Fix: ...
Set: ... (who the setter should go to and why)
Each line under 18 words and cites one number from the stats below.

${snapshot(m)}`;

export function reportPrompt(m: Match) {
  if (m.kind === "scrimmage") return `Write a short report on today's intrasquad scrimmage for the coaching staff. Both teams are our own players, so focus on individuals and skills, not on who won. Sections: Summary:, Standouts:, Needs work:, Next practice: (3 bullets, each with a drill idea). ${FORMAT} Under 280 words.\n\n${snapshot(m)}`;
  if (m.kind === "drills") return `Write a short practice report for the coaching staff from these practice stats. Sections: Summary:, Standouts:, Needs work:, Next practice:. ${FORMAT} Under 260 words.\n\n${snapshot(m)}`;
  return `Write a post-match report for the coaching staff. Sections: Result: (one line), What decided it: (3 bullets), Standouts: (2-4 bullets), Concerns: (2-3 bullets), Practice priorities: (3 bullets, each with a drill idea). ${FORMAT} Under 320 words.\n\n${snapshot(m)}`;
}

export function scoutPrompt(oppName: string) {
  const t = team()!, k = oppKey(oppName);
  const ms = matchesOf().filter((m) => m.kind === "match" && oppKey(m.opp) === k);
  const Rs = ms.map((m) => ({ m, R: replayOf(m)! })).filter((x) => x.R);
  const L: string[] = [`OPPONENT: ${oppName}. Our team: ${t.name}.`];
  if (!Rs.length) L.push("No previous matches against them are recorded.");
  else {
    L.push("PREVIOUS MATCHES: " + Rs.map(({ m, R }) => `${m.date}: sets ${R.wonUs}-${R.wonThem} (${R.sets.map((s) => s.us + "-" + s.them).join(", ")})`).join("; "));
    const A = aggregate(Rs.flatMap((x) => x.R.sets));
    L.push("OUR NUMBERS VS THEM: " + teamLine(A));
    L.push("THEIR PLAYERS: " + (Object.entries(A.opp).sort((a, b) => b[1].K - a[1].K).map(([n, o]) => `#${n} ${o.K} kills (zones ${Object.entries(o.z).map(([z, c]) => (z === "out" ? "out" : "Z" + z) + "×" + c).join(" ") || "n/a"}), ${o.A} aces`).join("; ") || "not recorded"));
    for (const v of ["theirAttack", "theirServe", "ourAttack", "ourServe"] as const) { const r = tendencies(A.locs, v); if (r.total) L.push(v.toUpperCase() + ": " + r.recs.join(" ")); }
    L.push("OUR ROTATIONS VS THEM: " + [1, 2, 3, 4, 5, 6].map((r) => `R${r} ${A.rot[r].w}-${A.rot[r].l}`).join(", "));
  }
  const o = opponentsOf().find((x) => oppKey(x.name) === k); if (o?.notes) L.push("COACH NOTES: " + o.notes);
  if (o?.roster && Object.keys(o.roster).length) L.push("THEIR ROSTER: " + Object.entries(o.roster).map(([n, r]) => `#${n} ${r.name || ""}${r.pos ? " (" + r.pos + ")" : ""}`).join(", "));
  return `Write a pre-match scouting report for the head coach. Sections: Last time:, Their threats:, Where they score:, Serving and serve-receive plan:, Our keys to win:. 2-4 bullets per section. If there's little data, say what to watch for early instead of guessing. ${FORMAT} Under 320 words.\n\n${L.join("\n")}`;
}

export function seasonPrompt(items: { m: Match; R: import("../sports/volleyball/engine").Replay }[], seasonName: string) {
  const t = team()!, sorted = items.slice().sort((a, b) => a.m.date.localeCompare(b.m.date));
  const A = aggregate(sorted.flatMap((x) => x.R.sets));
  const L = [`TEAM: ${t.name} (${t.level}), ${seasonName}.`, "MATCHES (oldest first):"];
  for (const { m, R } of sorted) { const a = aggregate(R.sets), M = teamMetrics(a); L.push(`- ${m.date} vs ${m.opp}: ${R.wonUs}-${R.wonThem} (${R.sets.map((s) => s.us + "-" + s.them).join(", ")}); hitting ${fmtHit(M.hitting)}, side-out ${fmtPct(M.sideOut)}, pass ${fmtAvg(M.passAvg)}, serve in ${fmtPct(M.serveIn)}`); }
  L.push("SEASON: " + teamLine(A));
  L.push("ROTATIONS: " + [1, 2, 3, 4, 5, 6].map((r) => `R${r} ${A.rot[r].w}-${A.rot[r].l}`).join(", "));
  L.push("PLAYERS:");
  for (const p of teamPlayers()) { const s = A.ps[p.id]; if (s) L.push(`- #${p.num} ${p.first} (${p.pos}): ${statLine(s)}; ${playerMetrics(A, p.id).sets} sets`); }
  return `Write a season review for the coaching staff. Sections: Where we are:, What's working:, What's holding us back:, Trends:, Player notes:, Next 3 practice priorities:. 2-4 bullets each; cite numbers and trends across matches; name players by number and first name. ${FORMAT} Under 380 words.\n\n${L.join("\n")}`;
}

export function reportCardPrompt(playerId: string) {
  const p = player(playerId); if (!p) return "";
  const games = matchesOf().filter((m) => m.kind === "match").slice().reverse();
  const L = [`PLAYER: #${p.num} ${p.first} (${p.pos})${p.grad ? ", class of " + p.grad : ""}, team ${team()!.name}.`, "MATCH BY MATCH (oldest first):"];
  const all: any[] = [];
  for (const m of games) { const R = replayOf(m); if (!R) continue; const A = aggregate(R.sets); if (!A.ps[p.id]) continue; all.push(...R.sets); L.push(`- ${m.date} vs ${m.opp}: ${statLine(A.ps[p.id])}`); }
  if (all.length) { const A = aggregate(all), pm = playerMetrics(A, p.id); L.push(`SEASON: ${statLine(A.ps[p.id])}; ${pm.sets} sets; kills/set ${pm.kps?.toFixed(2)}, digs/set ${pm.dps?.toFixed(2)}, +/- ${pm.plusMinus ?? "n/a"}, net points ${pm.netPoints}`); }
  if (p.goals.length) L.push("GOALS SET BY COACH: " + p.goals.map((g) => `${g.metric} target ${g.target}`).join(", "));
  return `Write a player report card a coach can share with the athlete. Sections: Strengths:, Growth areas:, Goal for next match:, Coach's note:. 2-3 bullets in the first two sections, one specific measurable goal, and a 1-2 sentence encouraging note to the player by first name. Mention trends across matches when the data shows them. Only judge skills that fit the player's position and that have enough attempts. ${FORMAT} Under 220 words.\n\n${L.join("\n")}`;
}

export function lineupPrompt() {
  const games = matchesOf().filter((m) => m.kind === "match");
  const sets = games.flatMap((m) => replayOf(m)?.sets || []);
  const A = aggregate(sets);
  const L = ["ROSTER (use these ids exactly):"];
  for (const p of activePlayers()) { const s = A.ps[p.id]; L.push(`- id ${p.id}: #${p.num} ${p.first} (${p.pos}). ${s ? statLine(s) : "no stats yet"}${A.srv[p.id] ? `; rallies won serving ${A.srv[p.id].w}/${A.srv[p.id].n}` : ""}`); }
  L.push("STARTING LINEUPS USED (P1 first) AND NET POINTS BY ROTATION:");
  for (const s of sets.filter((x) => x.startLu).slice(-12)) { const rot: Record<number, number> = {}; for (const r of s.rallies) rot[r.rot] = (rot[r.rot] || 0) + (r.w === "us" ? 1 : -1); L.push(`- set ${s.n} (${s.us}-${s.them}): ${s.startLu!.map((id) => playerName(id)).join(", ")} · ${[1, 2, 3, 4, 5, 6].map((k) => `R${k} ${rot[k] || 0}`).join(" ")}`); }
  return `Suggest the best starting lineup for a 6-player volleyball rotation from the data below. Reply with only JSON: {"lineup":[six roster ids in order P1 (right back, first server), P2 (right front), P3 (middle front), P4 (left front), P5 (left back), P6 (middle back)],"libero":roster id or null,"summary":"one sentence","reasons":["2-4 short reasons citing numbers"],"serveReceive":["1-3 serve-receive tips"]}. Use only ids from the roster, each once; the libero must not be in the six. Keep the setter opposite the opposite hitter and the two middles opposite each other when the roster allows.\n\n${L.join("\n")}`;
}

export function practiceSuggestPrompt(focusText: string) {
  return `Suggest a 90-minute volleyball practice plan for a high school or club team. Reply with only JSON: {"title":"short title","blocks":[{"title":"drill name","category":"one of Warm-up, Serving, Serve receive, Setting, Attacking, Blocking, Defense, Transition, Game play, Conditioning, Team talk","minutes":number,"notes":"one sentence on how to run it and what to watch"}]} with 6-9 blocks that add up to 90 minutes. Base the focus on these numbers from recent matches:\n${focusText}`;
}

export { zoneOf };

/** Everything in the current Stats selection, compact enough to ask questions over. */
export function askPrompt(items: { m: Match; R: import("../sports/volleyball/engine").Replay }[], label: string, question: string, history: { q: string; a: string }[] = []) {
  const t = team()!, sorted = items.slice().sort((a, b) => a.m.date.localeCompare(b.m.date));
  const A = aggregate(sorted.flatMap((x) => x.R.sets));
  const L = [`TEAM: ${t.name} (${t.level}). SELECTION: ${label}, ${sorted.length} matches, ${A.sets} sets.`, "MATCHES:"];
  for (const { m, R } of sorted) { const a = aggregate(R.sets), M = teamMetrics(a); L.push(`- ${m.date} vs ${m.opp}${m.event ? " (" + m.event + ")" : ""}: ${R.wonUs}-${R.wonThem} (${R.sets.map((s) => s.us + "-" + s.them).join(", ")}); hitting ${fmtHit(M.hitting)}, side-out ${fmtPct(M.sideOut)}, pass ${fmtAvg(M.passAvg)}, serve in ${fmtPct(M.serveIn)}`); }
  L.push("TEAM TOTALS: " + teamLine(A));
  L.push("OUR ROTATIONS (won-lost, side-out, point-scoring): " + [1, 2, 3, 4, 5, 6].map((r) => { const x = A.rot[r]; return `R${r} ${x.w}-${x.l} SO ${pct(x.rw, x.rn)} PS ${pct(x.sw, x.sn)}`; }).join("; "));
  L.push("PLAYERS:");
  for (const p of teamPlayers()) {
    const s = A.ps[p.id]; if (!s) continue; const pm = playerMetrics(A, p.id);
    const rotA = [1, 2, 3, 4, 5, 6].map((r) => { const x = A.atkRot[r]?.[p.id]; return x && x.TA ? `R${r} ${x.K}K/${x.E}E/${x.TA}TA` : ""; }).filter(Boolean).join(" ");
    const rotP = [1, 2, 3, 4, 5, 6].map((r) => { const x = A.rcvRot[r]?.[p.id]; return x && x.R ? `R${r} ${fmtAvg(x.RS / x.R)} on ${x.R}` : ""; }).filter(Boolean).join(" ");
    L.push(`- #${p.num} ${p.first} (${p.pos}), ${pm.sets} sets, +/- ${pm.plusMinus ?? "n/a"}: ${statLine(s)}${rotA ? `; attacks by rotation: ${rotA}` : ""}${rotP ? `; passing by rotation: ${rotP}` : ""}`);
  }
  const opp = Object.entries(A.opp).sort((a, b) => b[1].K - a[1].K).slice(0, 8);
  if (opp.length) L.push("OPPONENT PLAYERS (kills/aces/errors): " + opp.map(([n, o]) => `#${n} ${o.K}/${o.A}/${o.E}`).join(", "));
  const convo = history.slice(-4).map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n\n");
  return `You are a volleyball analyst answering a coach's question about their own tracked stats. Answer directly in 2-6 short sentences or bullets, cite the exact numbers from the data, and say plainly when the data can't answer it (and what they'd need to track). Never invent stats. Name players by number and first name.\n\nDATA\n${L.join("\n")}${convo ? "\n\nEARLIER IN THIS CONVERSATION\n" + convo : ""}\n\nQUESTION: ${question}`;
}
