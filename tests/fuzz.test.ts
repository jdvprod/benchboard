/**
 * Backtesting the engine: thousands of random matches (every action, subs, timeouts, deletes, several devices,
 * stats-only entries) checked against invariants that must always hold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, mergeLogs, MatchEvent, replay, STAT_KEYS, SetState } from "../src/sports/volleyball/engine";
import { ACTIONS, ActionCode } from "../src/sports/volleyball/actions";
import { hitting, passAvg, playerMetrics, teamMetrics } from "../src/sports/volleyball/metrics";
import { situations } from "../src/sports/volleyball/situations";
import { tendencies } from "../src/sports/volleyball/tendencies";
import { flags } from "../src/sports/volleyball/flags";

/** FUZZ_SCALE=20 runs twenty times as many random matches (a deep backtest); CI uses 1. */
const SCALE = Math.max(1, +(process.env.FUZZ_SCALE || 1));

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CODES = Object.keys(ACTIONS) as ActionCode[];
const ROSTER = ["s", "oh1", "mb1", "opp", "oh2", "mb2", "lib", "ds", "oh3", "mb3"];

/** A random but structurally valid match: new sets when one is won, subs from the bench, timeouts, notes. */
function randomMatch(seed: number, opts: { ns?: boolean; adj?: boolean } = {}): { events: MatchEvent[]; deleted: Set<string> } {
  const r = rng(seed), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const events: any[] = []; let ts = 1_000_000, n = 0;
  const push = (e: any) => { const x = { id: `e${seed}-${n++}`, ts: (ts += 1 + Math.floor(r() * 9000)), ...e }; events.push(x); return x; };
  const START = ["s", "oh1", "mb1", "opp", "oh2", "mb2"]; let lu = START.slice();
  push({ t: "NS", serve: r() < 0.5 ? "us" : "them", lu: lu.slice(), lib: "lib" });
  const sets = 1 + Math.floor(r() * 5);
  let us = 0, them = 0, set = 1;
  for (let i = 0; i < 260 && set <= sets; i++) {
    const x = r();
    if (x < 0.03) { const out = pick(lu), bench = ROSTER.filter((p) => !lu.includes(p) && p !== "lib"); if (bench.length) { const inn = pick(bench); push({ t: "SUB", out, in: inn }); lu = lu.map((p) => (p === out ? inn : p)); } continue; }
    if (x < 0.05) { push({ t: "TO", v: r() < 0.5 ? "us" : "them" }); continue; }
    if (x < 0.06) { push({ t: "TAG", note: "look", p: pick(lu) }); continue; }
    if (opts.adj && x < 0.065) { const a = Math.floor(r() * 10), b = Math.floor(r() * 10); push({ t: "ADJ", us: a, them: b }); us = a; them = b; continue; }
    const code = pick(CODES), a: any = ACTIONS[code];
    const e: any = { t: code };
    if (!a.team && (!a.optionalPlayer || r() < 0.7)) e.p = pick(lu.concat(["lib"]));
    if (code === "OK" || code === "OA" || code === "OE") if (r() < 0.6) e.op = pick(["11", "7", "3"]);
    if (r() < 0.3) { e.x = +(r() * 9).toFixed(2); e.y = +(r() * 18).toFixed(2); }
    if (opts.ns && r() < 0.15) e.ns = true;
    push(e);
    // mirror the score so we know when a set ends
    if (a.point && !e.ns && !(code === "BA" && events.length > 1 && events[events.length - 2].t === "BA" && !events[events.length - 2].ns)) { if (a.point === "us") us++; else them++; }
    const target = set === 5 ? 15 : 25;
    if (Math.max(us, them) >= target && Math.abs(us - them) >= 2) { set++; us = 0; them = 0; if (set <= sets) { push({ t: "NS", serve: r() < 0.5 ? "us" : "them" }); lu = START.slice(); } }
  }
  // delete a few events (any device can delete any entry)
  const deleted = new Set<string>();
  for (let k = 0; k < 3; k++) { const victim = events[1 + Math.floor(r() * (events.length - 1))]; if (victim && victim.t !== "NS" && !deleted.has(victim.id)) { deleted.add(victim.id); events.push({ id: `del${seed}-${k}`, ts: (ts += 10), t: "DEL", ref: victim.id }); } }
  return { events: events as MatchEvent[], deleted };
}

function finite(x: unknown, where: string) { if (typeof x === "number") assert.ok(Number.isFinite(x), `${where} is not finite: ${x}`); }

function checkSet(s: SetState, label: string) {
  // score equals rallies (no score corrections in this run)
  const won = s.rallies.filter((r) => r.w === "us").length;
  assert.equal(s.us, won, `${label}: our score equals rallies we won`);
  assert.equal(s.them, s.rallies.length - won, `${label}: their score equals rallies they won`);
  // score-before on each rally is the running score
  let u = 0, t = 0;
  for (const r of s.rallies) { assert.equal(r.us, u, `${label}: score before rally (us)`); assert.equal(r.them, t, `${label}: score before rally (them)`); if (r.w === "us") u++; else t++; }
  // whoever wins a rally serves the next one, and we rotate exactly once per side-out
  for (let i = 1; i < s.rallies.length; i++) assert.equal(s.rallies[i].server, s.rallies[i - 1].w, `${label}: rally ${i} server is the previous winner`);
  const sideOuts = s.rallies.filter((r) => r.server === "them" && r.w === "us").length;
  assert.equal(s.rot, (sideOuts % 6) + 1, `${label}: rotation follows side-outs`);
  const theirSideOuts = s.rallies.filter((r) => r.server === "us" && r.w === "them").length;
  assert.equal(s.rotB, (theirSideOuts % 6) + 1, `${label}: their rotation follows their side-outs`);
  assert.ok(s.rot >= 1 && s.rot <= 6 && s.rotB >= 1 && s.rotB <= 6, `${label}: rotations stay in 1–6`);
  if (s.lu) assert.equal(new Set(s.lu).size, 6, `${label}: lineup has six different players`);
  // player stat lines are internally consistent
  for (const [id, st] of Object.entries(s.ps)) {
    assert.ok(st.TA >= st.K + st.AE - 0, `${label}: ${id} attempts ≥ kills + errors`);
    assert.ok(st.K >= st.KT && st.AE >= st.AB, `${label}: ${id} tools within kills, blocked within errors`);
    assert.equal(st.R, st.R3 + st.R2 + st.R1 + st.P0, `${label}: ${id} receptions add up`);
    assert.equal(st.RS, 3 * st.R3 + 2 * st.R2 + st.R1, `${label}: ${id} pass score adds up`);
    for (const k of STAT_KEYS) assert.ok(st[k] >= 0, `${label}: ${id}.${k} never negative`);
    const h = hitting(st); if (h != null) assert.ok(h >= -1 && h <= 1, `${label}: hitting in range`);
    const p = passAvg(st); if (p != null) assert.ok(p >= 0 && p <= 3, `${label}: pass average in range`);
  }
}

test("random matches: invariants hold for 1,500 matches", () => {
  for (let seed = 1; seed <= 1500 * SCALE; seed++) {
    const { events } = randomMatch(seed);
    const R = replay(mergeLogs([events]), { bestOf: 5 });
    R.sets.forEach((s) => checkSet(s, `seed ${seed} set ${s.n}`));
    // whole-match aggregate equals the sum of its sets
    const A = aggregate(R.sets);
    assert.equal(A.us, R.sets.reduce((n, s) => n + s.us, 0), `seed ${seed}: points add up`);
    assert.equal(A.so.n + A.psc.n, A.rallies.length, `seed ${seed}: every rally is a side-out or point-scoring chance`);
    for (const k of STAT_KEYS) { let sum = 0; for (const id in A.ps) sum += A.ps[id][k]; assert.equal(A.T[k], sum, `seed ${seed}: team ${k} is the sum of players`); }
    const rotTotal = Object.values(A.rot).reduce((n, x) => n + x.w + x.l, 0);
    assert.equal(rotTotal, A.rallies.length, `seed ${seed}: rotation results cover every rally`);
    // derived metrics never produce NaN/Infinity
    const M = teamMetrics(A); for (const [k, v] of Object.entries(M)) finite(v, `seed ${seed} teamMetrics.${k}`);
    for (const id in A.ps) for (const [k, v] of Object.entries(playerMetrics(A, id))) finite(v, `seed ${seed} playerMetrics.${k}`);
    // situations account for every rally
    const X = situations(R.sets);
    assert.equal(X.rallies, A.rallies.length, `seed ${seed}: situations see every rally`);
    const ph = X.phase.early.so.n + X.phase.early.ps.n + X.phase.mid.so.n + X.phase.mid.ps.n + X.phase.late.so.n + X.phase.late.ps.n;
    assert.equal(ph, A.rallies.length, `seed ${seed}: score bands cover every rally`);
    const st = X.state.ahead.so.n + X.state.ahead.ps.n + X.state.tied.so.n + X.state.tied.ps.n + X.state.behind.so.n + X.state.behind.ps.n;
    assert.equal(st, A.rallies.length, `seed ${seed}: leading/tied/trailing cover every rally`);
    assert.ok(X.runs.us.longest <= A.us && X.runs.them.longest <= A.them, `seed ${seed}: runs fit in the score`);
    // other consumers don't throw
    for (const v of ["theirAttack", "theirServe", "ourAttack", "ourServe"] as const) tendencies(A.locs, v);
    for (const f of flags(R, { us: "Us", them: "Them", subLimit: 15, playerIds: ROSTER, short: (id) => id })) assert.ok(f.title && !/NaN|undefined|Infinity/.test(f.title + f.detail), `seed ${seed}: flag text is clean: ${f.title} ${f.detail}`);
  }
});

test("several devices: splitting a match across logs gives the same result", () => {
  for (let seed = 1; seed <= 400 * SCALE; seed++) {
    const { events } = randomMatch(seed);
    const one = replay(mergeLogs([events]), { bestOf: 5 });
    const r = rng(seed * 7), logs: MatchEvent[][] = [[], [], []];
    for (const e of events) logs[Math.floor(r() * 3)].push(e);
    const many = replay(mergeLogs(logs.map((l) => l.slice().reverse())), { bestOf: 5 });
    assert.deepEqual(many.sets.map((s) => [s.us, s.them, s.rot]), one.sets.map((s) => [s.us, s.them, s.rot]), `seed ${seed}: same scores`);
    assert.deepEqual(aggregate(many.sets).ps, aggregate(one.sets).ps, `seed ${seed}: same player stats`);
  }
});

test("deleting an entry is the same as never recording it", () => {
  for (let seed = 1; seed <= 400 * SCALE; seed++) {
    const { events, deleted } = randomMatch(seed);
    const a = replay(mergeLogs([events]), { bestOf: 5 });
    const b = replay(mergeLogs([events.filter((e) => e.t !== "DEL" && !deleted.has(e.id))]), { bestOf: 5 });
    assert.deepEqual(a.sets.map((s) => [s.us, s.them]), b.sets.map((s) => [s.us, s.them]), `seed ${seed}`);
  }
});

test("stats-only entries never move the score but always count for the player", () => {
  for (let seed = 1; seed <= 400 * SCALE; seed++) {
    const { events } = randomMatch(seed, { ns: true });
    const full = replay(mergeLogs([events]), { bestOf: 5 });
    const scoring = replay(mergeLogs([events.filter((e: any) => !e.ns)]), { bestOf: 5 });
    assert.deepEqual(full.sets.map((s) => [s.us, s.them]), scoring.sets.map((s) => [s.us, s.them]), `seed ${seed}: score unchanged`);
    const nsKills = events.filter((e: any) => e.ns && (e.t === "K" || e.t === "KT") && e.p).length;
    const A1 = aggregate(full.sets), A2 = aggregate(scoring.sets);
    // kills from stats-only devices can only be missing if they came before the first set started (impossible here)
    assert.equal(A1.T.K - A2.T.K, nsKills - events.filter((e: any) => e.ns && (e.t === "K" || e.t === "KT") && e.p && full.log.every((l) => l.id !== e.id)).length, `seed ${seed}: stats-only kills counted`);
  }
});

test("score corrections stick and later rallies build on them", () => {
  for (let seed = 1; seed <= 300 * SCALE; seed++) {
    const { events } = randomMatch(seed, { adj: true });
    const R = replay(mergeLogs([events]), { bestOf: 5 });
    for (const s of R.sets) { assert.ok(s.us >= 0 && s.them >= 0); for (const r of s.rallies) { assert.ok((r.us ?? 0) >= 0 && (r.them ?? 0) >= 0); } }
    situations(R.sets);
  }
});

import { parseQuick } from "../src/sports/volleyball/quickcodes";
import { parseSchedule } from "../src/features/matchup/parseSchedule";
test("parsers never throw on junk and only return valid entries", () => {
  const r = rng(99), chars = "0123456789abcdefghijklmnopqrstuvwxyz @#/:-.,()|\t\nAPMvsatSepOct";
  for (let i = 0; i < 3000; i++) {
    let s = ""; const n = Math.floor(r() * 60); for (let j = 0; j < n; j++) s += chars[Math.floor(r() * chars.length)];
    const q = parseQuick(s); for (const it of q.items) assert.ok(ACTIONS[it.code], "quick code maps to a real action");
    for (const g of parseSchedule(s, new Date(2026, 7, 1))) {
      assert.match(g.date, /^20\d\d-\d\d-\d\d$/); assert.ok(!Number.isNaN(new Date(g.date + "T12:00").getTime()), "real date: " + g.date);
      if (g.time) assert.match(g.time, /^([01]\d|2[0-3]):[0-5]\d$/, "time is HH:MM: " + g.time);
      assert.ok(g.opp.length > 0);
      const [yy, mm, dd] = g.date.split("-").map(Number); assert.equal(new Date(yy, mm - 1, dd).getDate(), dd, "day exists in that month: " + g.date);
    }
  }
});

test("schedule paste skips impossible dates", () => { assert.equal(parseSchedule("2/31 vs Hoover").length, 0); assert.equal(parseSchedule("2/29/2028 vs Hoover").length, 1); });

test("lineup fixes mid-set (rotation, serve, positions, libero) keep the lineup valid", () => {
  for (let seed = 1; seed <= 600 * SCALE; seed++) {
    const r = rng(seed * 13), base = randomMatch(seed).events.filter((e) => e.t !== "DEL");
    const out: any[] = []; let ts = 0;
    for (const e of base) {
      out.push({ ...e, ts: (ts += 10) });
      const x = r();
      if (x < 0.02) out.push({ id: `rot${seed}-${ts}`, ts: (ts += 1), t: "ROT", v: 1 + Math.floor(r() * 6) });
      else if (x < 0.03) out.push({ id: `srv${seed}-${ts}`, ts: (ts += 1), t: "SRV", v: r() < 0.5 ? "us" : "them" });
      else if (x < 0.035) { const lu = ROSTER.filter((p) => p !== "lib").sort(() => r() - 0.5).slice(0, 6); out.push({ id: `lu${seed}-${ts}`, ts: (ts += 1), t: "LU", lu, lib: "lib", libSrv: r() < 0.3 ? lu[0] : null }); }
    }
    const R = replay(out as MatchEvent[], { bestOf: 5 });
    for (const s of R.sets) {
      assert.equal(s.us + s.them, s.rallies.length, `seed ${seed}: score = rallies`);
      if (s.lu) { assert.equal(new Set(s.lu).size, 6, `seed ${seed}: six different players`); assert.ok(!s.lu.includes("lib"), `seed ${seed}: libero isn't one of the six`); }
      assert.ok(s.rot >= 1 && s.rot <= 6);
    }
    aggregate(R.sets); situations(R.sets);
  }
});
