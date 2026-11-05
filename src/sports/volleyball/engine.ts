/**
 * The volleyball match engine.
 *
 * A match is stored as an append-only list of events (every button tap). `replay` walks
 * the list and rebuilds everything: score, serve, rotation, lineups, and every stat.
 * Nothing derived is ever stored, so fixing or deleting an event always gives correct totals.
 */
import { ACTIONS, ActionCode, AttackContext, isAction, OPP_NUMBER, Side } from "./actions";

/* ---------- events ---------- */

export interface BaseEvent { id: string; ts: number; t: string; vt?: number /* seconds into the match video, when statted from film */ }
export interface StatEvent extends BaseEvent {
  t: ActionCode;
  p?: string; // player id
  op?: string; // opponent jersey number
  imp?: boolean; // imported from another app: player totals only, no rally context
  x?: number; y?: number; // where the ball landed, court meters (see zoneOf)
  s?: "a" | "b"; // scrimmage side of the player
  ns?: boolean; // stats only: counts for the player but never changes the score (a second coach's device)
}
export interface NewSetEvent extends BaseEvent { t: "NS"; serve: Side; lu?: string[]; lib?: string | null; libSrv?: string | null }
export interface LineupEvent extends BaseEvent { t: "LU"; lu: string[]; lib?: string | null; libSrv?: string | null }
export interface SubEvent extends BaseEvent { t: "SUB"; out: string; in: string }
export interface SimpleEvent extends BaseEvent { t: "ROT" | "SRV" | "TO"; v: any }
export interface AdjustEvent extends BaseEvent { t: "ADJ"; us: number; them: number }
export interface TagEvent extends BaseEvent { t: "TAG"; note: string; p?: string }
export interface DeleteEvent extends BaseEvent { t: "DEL"; ref: string }
export type MatchEvent = StatEvent | NewSetEvent | LineupEvent | SubEvent | SimpleEvent | AdjustEvent | TagEvent | DeleteEvent;

/** Sort by time, drop deleted events. Works across several devices' logs. */
export function mergeLogs(logs: MatchEvent[][]): MatchEvent[] {
  const all = ([] as MatchEvent[]).concat(...logs).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const deleted = new Set<string>();
  for (const e of all) if (e.t === "DEL") deleted.add((e as DeleteEvent).ref);
  return all.filter((e) => e.t !== "DEL" && !deleted.has(e.id));
}

/* ---------- stat lines ---------- */

export const STAT_KEYS = ["K", "KT", "AE", "AB", "TA", "SATT", "AST", "BHE", "SA", "SE", "SEN", "SEO", "SI", "R", "RS", "R3", "R2", "R1", "P0", "D", "DE", "BS", "BA", "BE", "CE", "EE", "PE", "OVP", "FBS"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stat = Record<StatKey, number>;
export const blank = (): Stat => Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Stat;
export function addStat(into: Stat, s: Stat) { for (const k of STAT_KEYS) into[k] += s[k] || 0; }

export const TEAM_KEYS = ["OE", "OK", "OA", "UP", "TP", "REF", "CE", "EE", "PE", "FBR", "OVP", "FBS"] as const;
export type TeamStat = Record<(typeof TEAM_KEYS)[number], number>;
const teamBlank = (): TeamStat => Object.fromEntries(TEAM_KEYS.map((k) => [k, 0])) as TeamStat;

export function bump(st: Stat, t: ActionCode) {
  if (t === "K") { st.K++; st.TA++; }
  else if (t === "KT") { st.K++; st.KT++; st.TA++; } // a tool is a kill
  else if (t === "AE") { st.AE++; st.TA++; }
  else if (t === "AB") { st.AE++; st.AB++; st.TA++; } // blocked counts as an attack error
  else if (t === "TA") st.TA++;
  else if (t === "P3" || t === "P2" || t === "P1" || t === "P0") {
    st.R++; st.RS += +t[1];
    if (t === "P0") st.P0++; else st[("R" + t[1]) as "R3" | "R2" | "R1"]++;
  } else if (t in st) (st as any)[t]++;
}

/** Court geometry in meters: 9 wide, 18 long. Their half is y 0–9, ours 9–18. */
export type Zone = 1 | 2 | 3 | 4 | 5 | 6 | "out";
export function zoneOf(x?: number | null, y?: number | null): Zone | null {
  if (x == null || y == null) return null;
  if (x < 0 || x > 9 || y < 0 || y > 18) return "out";
  if (y < 9) { const front = y >= 6; if (x < 3) return front ? 2 : 1; if (x < 6) return front ? 3 : 6; return front ? 4 : 5; }
  const front = y < 12; if (x < 3) return front ? 4 : 5; if (x < 6) return front ? 3 : 6; return front ? 2 : 1;
}
/** Which team's side the point is on. */
export const halfOf = (y: number): Side => (y < 9 ? "them" : "us");

export function rotateLineup(lu: string[], steps: number): string[] {
  let a = lu.slice(); const n = ((steps % 6) + 6) % 6;
  for (let i = 0; i < n; i++) a = a.slice(1).concat(a[0]);
  return a;
}

/* ---------- replay ---------- */

export interface MatchInfo {
  id?: string;
  bestOf?: number;
  /** Points to win a set (default 25), the deciding set (default 15), and an optional cap (first to it wins, even by one). 2 sets = pool play: both sets are played. */
  setTo?: number; decider?: number; cap?: number | null;
  /** Scrimmage between two halves of our roster. */
  scrim?: { a: { name: string; ids: string[] }; b: { name: string; ids: string[] }; to?: number } | null;
}

export interface Rally {
  w: Side; server: Side; rot: number; rotB: number; srvP: string | null;
  /** Our first reception grade when they served (P3/P2/P1/P0), for side-out by pass quality. */
  pass: "P3" | "P2" | "P1" | "P0" | null;
  firstAtk: "K" | "AE" | "TA" | null;
  /** Players on court for us when the rally ended (lineup + libero), for +/-. */
  onCourt: string[];
  /** What ended it, e.g. "K", "OK", "SEN". */
  end: string;
  p: string | null;
  /** Score before the rally, and which side (if any) called a timeout just before it. */
  us?: number; them?: number; to?: Side | null;
}

export interface Loc { t: ActionCode; p: string | null; op: string | null; x: number; y: number; set: number; rot: number; serve: Side; mid?: string }
export interface Tag { id: string; note: string; p: string | null; ts: number; score: string; set: number }
export interface CtxLine { K: number; E: number; TA: number }
export interface OppPlayerLine { K: number; A: number; E: number; P: number; z: Record<string, number> }

export type LogEntry =
  | { id: string; set: number; kind: "stat"; t: ActionCode; p?: string; op?: string; w: Side | null; us: number; them: number; /** rotation, who served and attack context when the play happened; where the ball went */ rot?: number; sv?: Side; cx?: AttackContext; z?: Zone | null }
  | { id: string; set: number; kind: "set"; serve: Side }
  | { id: string; set: number; kind: "rot"; v: number }
  | { id: string; set: number; kind: "srv"; v: Side }
  | { id: string; set: number; kind: "to"; v: Side }
  | { id: string; set: number; kind: "adj"; us: number; them: number }
  | { id: string; set: number; kind: "lu" }
  | { id: string; set: number; kind: "sub"; in: string; out: string }
  | { id: string; set: number; kind: "tag"; note: string; p?: string };

export interface SetState {
  n: number; us: number; them: number; serve: Side; rot: number; rotB: number;
  lu: string[] | null; lib: string | null; libSrv: string | null;
  startLu: string[] | null; startLibSrv: string | null;
  subs: number; subLog: { out: string; in: string; score: string }[];
  to: Record<Side, number>;
  rallies: Rally[];
  ps: Record<string, Stat>;
  team: TeamStat;
  src: Record<Side, Record<string, number>>;
  ctx: Partial<Record<AttackContext, { team: CtxLine; p: Record<string, CtxLine> }>>;
  /** Attacks by our rotation and hitter: setter distribution. */
  atkRot: Record<number, Record<string, CtxLine>>;
  /** Serve-receive passes by our rotation and passer: count and grade total. */
  rcvRot: Record<number, Record<string, { R: number; RS: number }>>;
  srv: Record<string, { n: number; w: number }>;
  opp: Record<string, OppPlayerLine>;
  locs: Loc[];
  tags: Tag[];
  fbr: { n: number; w: number };
  fbso: { n: number; w: number };
  side: { a: Stat; b: Stat };
  pside: Record<string, "a" | "b">;
  pm: Record<string, { w: number; l: number }>;
  target: number; over: boolean; winner: Side | null;
}

export interface Replay {
  sets: SetState[];
  cur: SetState | null;
  log: LogEntry[];
  wonUs: number; wonThem: number; need: number; matchOver: boolean;
  firstTs: number | null;
}

function newSet(n: number, serve: Side, lu: string[] | null, lib: string | null): SetState {
  return {
    n, us: 0, them: 0, serve, rot: 1, rotB: 1, lu: lu ? lu.slice() : null, lib, libSrv: null, startLu: lu ? lu.slice() : null, startLibSrv: null,
    subs: 0, subLog: [], to: { us: 0, them: 0 }, rallies: [], ps: {}, team: teamBlank(), src: { us: {}, them: {} }, ctx: {}, atkRot: {}, rcvRot: {}, srv: {}, opp: {},
    locs: [], tags: [], fbr: { n: 0, w: 0 }, fbso: { n: 0, w: 0 }, side: { a: blank(), b: blank() }, pside: {}, pm: {},
    target: 25, over: false, winner: null,
  };
}

/** Who is serving for us right now (the libero if serving for the player in position 1). */
export function serverOf(c: SetState | null): string | null {
  if (!c || c.serve !== "us" || !c.lu) return null;
  const p = c.lu[0];
  return c.lib && c.libSrv && c.libSrv === p ? c.lib : p;
}

export function replay(events: MatchEvent[], info: MatchInfo = {}): Replay {
  const bestOf = info.bestOf || 5, scr = info.scrim || null;
  const sets: SetState[] = [], log: LogEntry[] = [];
  let cur: SetState | null = null, lastBA = false, lastTO: Side | null = null;
  let rally = { ctx: "OTH" as AttackContext, firstAtk: null as Rally["firstAtk"], hasFBR: false, pass: null as Rally["pass"] };
  const startRally = () => { rally = { ctx: "OTH", firstAtk: null, hasFBR: false, pass: null }; };

  for (const e of events) {
    if (e.t === "NS") {
      const prev = sets[sets.length - 1];
      const lu = e.lu || (prev && prev.startLu) || null;
      const lib = e.lu ? e.lib || null : e.lib || (prev && prev.lib) || null;
      cur = newSet(sets.length + 1, e.serve || "us", lu, lib);
      cur.libSrv = e.lu ? e.libSrv || null : e.libSrv !== undefined ? e.libSrv || null : (prev && prev.startLibSrv) || null;
      cur.startLibSrv = cur.libSrv;
      sets.push(cur); lastBA = false; lastTO = null; startRally();
      log.push({ id: e.id, set: cur.n, kind: "set", serve: cur.serve });
      continue;
    }
    if (!cur) continue;
    switch (e.t) {
      case "ROT": { const v = +e.v; const steps = (v - cur.rot + 6) % 6; cur.rot = v; if (cur.lu) cur.lu = rotateLineup(cur.lu, steps); log.push({ id: e.id, set: cur.n, kind: "rot", v }); continue; }
      case "SRV": cur.serve = e.v; log.push({ id: e.id, set: cur.n, kind: "srv", v: e.v }); continue;
      case "TO": cur.to[e.v as Side]++; lastTO = e.v as Side; log.push({ id: e.id, set: cur.n, kind: "to", v: e.v }); continue;
      case "ADJ": cur.us = Math.max(0, +e.us || 0); cur.them = Math.max(0, +e.them || 0); log.push({ id: e.id, set: cur.n, kind: "adj", us: cur.us, them: cur.them }); continue;
      case "LU":
        cur.lu = e.lu.slice(); cur.lib = e.lib || null; cur.libSrv = e.libSrv || null;
        if (!cur.rallies.length) { cur.startLu = e.lu.slice(); cur.rot = 1; cur.startLibSrv = cur.libSrv; }
        log.push({ id: e.id, set: cur.n, kind: "lu" }); continue;
      case "SUB":
        // A sub only applies if the player coming out is on court and the one going in isn't (two coaches can both
        // record the same sub, or an earlier sub can be deleted); otherwise the lineup would hold a player twice.
        if (cur.lu) { const i = cur.lu.indexOf(e.out); if (i < 0 || cur.lu.includes(e.in) || e.in === cur.lib) { log.push({ id: e.id, set: cur.n, kind: "sub", in: e.in, out: e.out }); continue; } cur.lu[i] = e.in; }
        cur.subs++; cur.subLog.push({ out: e.out, in: e.in, score: cur.us + "–" + cur.them });
        log.push({ id: e.id, set: cur.n, kind: "sub", in: e.in, out: e.out }); continue;
      case "TAG":
        cur.tags.push({ id: e.id, note: e.note || "", p: e.p || null, ts: e.ts, score: cur.us + "–" + cur.them, set: cur.n });
        log.push({ id: e.id, set: cur.n, kind: "tag", note: e.note || "", p: e.p }); continue;
    }
    if (!isAction(e.t)) continue;
    // Tools count as kills and blocked attacks as attack errors everywhere below; the detail stays on the player's line and in the log.
    const ev = e as StatEvent, raw = ev.t, t: ActionCode = raw === "KT" ? "K" : raw === "AB" ? "AE" : raw, a: any = ACTIONS[raw];
    const rotNow = cur.rot, svNow = cur.serve, cxNow: AttackContext | undefined = ev.imp ? undefined : rally.ctx;

    if (ev.p) {
      bump(cur.ps[ev.p] || (cur.ps[ev.p] = blank()), raw);
      if (scr) { const sd = ev.s === "b" ? "b" : "a"; bump(cur.side[sd], t); cur.pside[ev.p] = sd; }
    } else if (t in cur.team) (cur.team as any)[t]++;

    // imported totals (ev.imp) count on players' lines only: they carry no rally order, rotation or attack context
    if (!ev.imp) {
    if (t === "P3" || t === "P2" || t === "P1" || t === "P0") {
      if (!rally.pass && cur.serve === "them") rally.pass = t;
      if (cur.serve === "them" && ev.p) { const rr = cur.rcvRot[cur.rot] || (cur.rcvRot[cur.rot] = {}), q = rr[ev.p] || (rr[ev.p] = { R: 0, RS: 0 }); q.R++; q.RS += +t[1]; }
    }
    if (t === "P3" || t === "P2" || t === "P1") rally.ctx = t;
    else if (t === "D") rally.ctx = "DIG";
    else if (t === "FBR") { rally.ctx = "FREE"; rally.hasFBR = true; }

    if (t === "K" || t === "AE" || t === "TA") {
      if (!rally.firstAtk) rally.firstAtk = t;
      const c = cur.ctx[rally.ctx] || (cur.ctx[rally.ctx] = { team: { K: 0, E: 0, TA: 0 }, p: {} });
      const pk = c.p[ev.p || "_"] || (c.p[ev.p || "_"] = { K: 0, E: 0, TA: 0 });
      const ar = cur.atkRot[cur.rot] || (cur.atkRot[cur.rot] = {}), pa = ar[ev.p || "_"] || (ar[ev.p || "_"] = { K: 0, E: 0, TA: 0 });
      for (const o of [c.team, pk, pa]) { o.TA++; if (t === "K") o.K++; if (t === "AE") o.E++; }
      if (t === "TA") rally.ctx = "OTH";
    }
    }
    if (ev.op && OPP_NUMBER[t]) {
      const o = cur.opp[ev.op] || (cur.opp[ev.op] = { K: 0, A: 0, E: 0, P: 0, z: {} });
      if (t === "OK") { o.K++; const z = zoneOf(ev.x, ev.y); if (z) o.z[z] = (o.z[z] || 0) + 1; }
      else if (t === "OA") o.A++; else if (t === "OE") o.E++; else o.P++;
    }
    if (ev.x != null && ev.y != null) cur.locs.push({ t, p: ev.p || null, op: ev.op || null, x: ev.x, y: ev.y, set: cur.n, rot: cur.rot, serve: cur.serve, mid: info.id });

    let wn: Side | null = ev.ns ? null : a.point || null;
    if (t === "BA" && lastBA) wn = null;
    if (!ev.ns) lastBA = t === "BA" && wn !== null; // a stats-only entry in between doesn't split a two-person block
    if (scr && ev.s === "b" && wn && !a.team) wn = wn === "us" ? "them" : "us";

    if (wn) {
      const srvP = serverOf(cur);
      const onCourt = cur.lu ? cur.lu.concat(cur.lib ? [cur.lib] : []) : [];
      cur.rallies.push({ w: wn, server: cur.serve, rot: cur.rot, rotB: cur.rotB, srvP, pass: rally.pass, firstAtk: rally.firstAtk, onCourt, end: t, p: ev.p || null, us: cur.us, them: cur.them, to: lastTO }); lastTO = null;
      for (const id of onCourt) { const m = cur.pm[id] || (cur.pm[id] = { w: 0, l: 0 }); if (wn === "us") m.w++; else m.l++; }
      if (srvP) { const s = cur.srv[srvP] || (cur.srv[srvP] = { n: 0, w: 0 }); s.n++; if (wn === "us") s.w++; }
      if (cur.serve === "them") { cur.fbso.n++; if (wn === "us" && rally.firstAtk === "K") cur.fbso.w++; }
      if (rally.hasFBR) { cur.fbr.n++; if (wn === "us") cur.fbr.w++; }
      const key = !ev.p && (t === "CE" || t === "EE" || t === "PE") ? "MISC" : sourceKey(t);
      cur.src[wn][key] = (cur.src[wn][key] || 0) + 1;
      cur[wn]++;
      if (wn === "us" && cur.serve === "them") { cur.rot = (cur.rot % 6) + 1; cur.serve = "us"; if (cur.lu) cur.lu = rotateLineup(cur.lu, 1); }
      else if (wn === "them" && cur.serve === "us") { cur.serve = "them"; cur.rotB = (cur.rotB % 6) + 1; }
      startRally();
    }
    log.push({ id: e.id, set: cur.n, kind: "stat", t: raw, p: ev.p, op: ev.op, w: wn, us: cur.us, them: cur.them, ...(ev.imp ? {} : { rot: rotNow, sv: svNow, cx: cxNow }), ...(ev.x != null ? { z: zoneOf(ev.x, ev.y) } : {}) });
  }

  let wonUs = 0, wonThem = 0;
  const setTo = info.setTo || 25, decider = info.decider || 15, cap = info.cap || null;
  sets.forEach((s, i) => {
    const deciding = !scr && bestOf % 2 === 1 && bestOf > 1 && s.n === bestOf;
    s.target = scr ? +(scr.to || 25) : deciding ? decider : setTo;
    const hi = Math.max(s.us, s.them), capAt = cap && !deciding && !scr ? Math.max(cap, s.target) : null;
    // A set is over by the rules, at the cap, or when the coach started the next one (sets ended early, time limits).
    s.over = (hi >= s.target && Math.abs(s.us - s.them) >= 2) || (!!capAt && hi >= capAt && s.us !== s.them) || (i < sets.length - 1 && s.us !== s.them);
    s.winner = s.over ? (s.us > s.them ? "us" : "them") : null;
    if (s.winner === "us") wonUs++; if (s.winner === "them") wonThem++;
  });
  const need = Math.ceil(bestOf / 2);
  const matchOver = bestOf % 2 === 0 ? wonUs + wonThem >= bestOf : wonUs >= need || wonThem >= need;
  return { sets, cur: sets[sets.length - 1] || null, log, wonUs, wonThem, need, matchOver, firstTs: events.length ? events[0].ts : null };
}

export function sourceKey(t: string): string {
  if (t === "BS" || t === "BA") return "BLK";
  if (t === "SEN" || t === "SEO" || t === "SE") return "SE";
  if (t === "CE" || t === "EE" || t === "PE") return "MISC";
  return t;
}

/* ---------- aggregation ---------- */

export interface RotationLine { w: number; l: number; rw: number; rn: number; sw: number; sn: number }
export interface Agg {
  sets: number;
  ps: Record<string, Stat>; T: Stat; team: TeamStat;
  rot: Record<number, RotationLine>;
  src: Record<Side, Record<string, number>>;
  so: { w: number; n: number }; psc: { w: number; n: number };
  soByPass: Record<"P3" | "P2" | "P1" | "P0" | "none", { w: number; n: number }>;
  ctx: Partial<Record<AttackContext, { team: CtxLine; p: Record<string, CtxLine> }>>;
  atkRot: Record<number, Record<string, CtxLine>>;
  rcvRot: Record<number, Record<string, { R: number; RS: number }>>;
  srv: Record<string, { n: number; w: number; best: number }>;
  opp: Record<string, OppPlayerLine>;
  locs: Loc[]; tags: Tag[];
  fbr: { n: number; w: number }; fbso: { n: number; w: number };
  us: number; them: number;
  side: { a: Stat; b: Stat }; pside: Record<string, "a" | "b">;
  pm: Record<string, { w: number; l: number }>;
  /** Sets each player recorded a stat or was on court in. */
  setsPlayed: Record<string, number>;
  rallies: Rally[];
}

export function aggregate(list: SetState[]): Agg {
  const A: Agg = {
    sets: list.length, ps: {}, T: blank(), team: teamBlank(), rot: {}, src: { us: {}, them: {} }, so: { w: 0, n: 0 }, psc: { w: 0, n: 0 },
    soByPass: { P3: { w: 0, n: 0 }, P2: { w: 0, n: 0 }, P1: { w: 0, n: 0 }, P0: { w: 0, n: 0 }, none: { w: 0, n: 0 } },
    ctx: {}, atkRot: {}, rcvRot: {}, srv: {}, opp: {}, locs: [], tags: [], fbr: { n: 0, w: 0 }, fbso: { n: 0, w: 0 }, us: 0, them: 0,
    side: { a: blank(), b: blank() }, pside: {}, pm: {}, setsPlayed: {}, rallies: [],
  };
  for (let r = 1; r <= 6; r++) A.rot[r] = { w: 0, l: 0, rw: 0, rn: 0, sw: 0, sn: 0 };
  for (const s of list) {
    A.us += s.us; A.them += s.them;
    const played = new Set<string>();
    for (const id in s.ps) { addStat(A.ps[id] || (A.ps[id] = blank()), s.ps[id]); played.add(id); }
    for (const id in s.pm) { const m = A.pm[id] || (A.pm[id] = { w: 0, l: 0 }); m.w += s.pm[id].w; m.l += s.pm[id].l; played.add(id); }
    played.forEach((id) => (A.setsPlayed[id] = (A.setsPlayed[id] || 0) + 1));
    for (const k of TEAM_KEYS) A.team[k] += s.team[k] || 0;
    for (const side of ["us", "them"] as Side[]) for (const k in s.src[side]) A.src[side][k] = (A.src[side][k] || 0) + s.src[side][k];
    let run: { p: string | null; n: number } = { p: null, n: 0 };
    for (const r of s.rallies) {
      A.rallies.push(r);
      const R = A.rot[r.rot]; if (r.w === "us") R.w++; else R.l++;
      if (r.server === "them") {
        A.so.n++; R.rn++; if (r.w === "us") { A.so.w++; R.rw++; }
        const b = A.soByPass[r.pass || "none"]; b.n++; if (r.w === "us") b.w++;
      } else { A.psc.n++; R.sn++; if (r.w === "us") { A.psc.w++; R.sw++; } }
      // longest serving run per server
      if (r.server === "us" && r.srvP && r.w === "us") { run = run.p === r.srvP ? { p: r.srvP, n: run.n + 1 } : { p: r.srvP, n: 1 }; const S = A.srv[r.srvP] || (A.srv[r.srvP] = { n: 0, w: 0, best: 0 }); S.best = Math.max(S.best, run.n); }
      else run = { p: null, n: 0 };
    }
    for (const c in s.ctx) {
      const src = s.ctx[c as AttackContext]!, C = A.ctx[c as AttackContext] || (A.ctx[c as AttackContext] = { team: { K: 0, E: 0, TA: 0 }, p: {} });
      C.team.K += src.team.K; C.team.E += src.team.E; C.team.TA += src.team.TA;
      for (const p in src.p) { const P = C.p[p] || (C.p[p] = { K: 0, E: 0, TA: 0 }); P.K += src.p[p].K; P.E += src.p[p].E; P.TA += src.p[p].TA; }
    }
    for (const r in s.atkRot || {}) { const D = A.atkRot[+r] || (A.atkRot[+r] = {}); for (const p in s.atkRot[+r]) { const x = s.atkRot[+r][p], P = D[p] || (D[p] = { K: 0, E: 0, TA: 0 }); P.K += x.K; P.E += x.E; P.TA += x.TA; } }
    for (const r in s.rcvRot || {}) { const D = A.rcvRot[+r] || (A.rcvRot[+r] = {}); for (const p in s.rcvRot[+r]) { const x = s.rcvRot[+r][p], P = D[p] || (D[p] = { R: 0, RS: 0 }); P.R += x.R; P.RS += x.RS; } }
    for (const p in s.srv) { const S = A.srv[p] || (A.srv[p] = { n: 0, w: 0, best: 0 }); S.n += s.srv[p].n; S.w += s.srv[p].w; }
    for (const o in s.opp) {
      const O = A.opp[o] || (A.opp[o] = { K: 0, A: 0, E: 0, P: 0, z: {} }), so = s.opp[o];
      O.K += so.K; O.A += so.A; O.E += so.E; O.P += so.P; for (const z in so.z) O.z[z] = (O.z[z] || 0) + so.z[z];
    }
    A.locs.push(...s.locs); A.tags.push(...s.tags);
    addStat(A.side.a, s.side.a); addStat(A.side.b, s.side.b); Object.assign(A.pside, s.pside);
    A.fbr.n += s.fbr.n; A.fbr.w += s.fbr.w; A.fbso.n += s.fbso.n; A.fbso.w += s.fbso.w;
  }
  for (const id in A.ps) addStat(A.T, A.ps[id]);
  return A;
}

export function runOf(set: SetState | null): { side: Side | null; n: number } {
  if (!set || !set.rallies.length) return { side: null, n: 0 };
  const r = set.rallies, side = r[r.length - 1].w; let n = 0;
  for (let i = r.length - 1; i >= 0 && r[i].w === side; i--) n++;
  return { side, n };
}

/** Point differential after every rally, for momentum charts. */
export function momentum(set: SetState): number[] {
  let d = 0; return set.rallies.map((r) => (d += r.w === "us" ? 1 : -1));
}

/** Win, loss or tie (two-set pool play can split 1–1); null while the match is still going. */
export function resultOf(R: Replay): "W" | "L" | "T" | null {
  if (!R.matchOver) return null;
  return R.wonUs > R.wonThem ? "W" : R.wonThem > R.wonUs ? "L" : "T";
}
/** A team's record over finished matches, "12–3" or "12–3–1" when there are ties. */
export function recordOf(list: Replay[]): { w: number; l: number; t: number; text: string } {
  let w = 0, l = 0, t = 0;
  for (const R of list) { const r = resultOf(R); if (r === "W") w++; else if (r === "L") l++; else if (r === "T") t++; }
  return { w, l, t, text: `${w}–${l}${t ? "–" + t : ""}` };
}
