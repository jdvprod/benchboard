/** Realistic sample matches so a new coach can see every screen filled in. */
import type { MatchEvent } from "./engine";

export interface SamplePlayer { id: string; num: string; first: string; last: string; pos: string; grad: number }

/** The sample opponent's roster (fictional players), for the sample season and the Live demo. */
export const SAMPLE_OPP_ROSTER: Record<string, { name: string; pos: string }> = { "11": { name: "Kayla Moore", pos: "OH" }, "7": { name: "Tess Rivera", pos: "MB" }, "3": { name: "Jada Kim", pos: "S" }, "15": { name: "Brooke Hale", pos: "OPP" }, "9": { name: "Nina Cole", pos: "OH" } };
export const SAMPLE_ROSTER: SamplePlayer[] = [
  ["1", "Ava", "Ramirez", "S", 2027], ["4", "Jordan", "Lee", "OH", 2028], ["7", "Maya", "Chen", "OH", 2027], ["9", "Riley", "Brooks", "MB", 2027],
  ["12", "Sofia", "Nguyen", "MB", 2028], ["14", "Kenzie", "Park", "OPP", 2027], ["3", "Lily", "Torres", "L", 2029], ["10", "Emma", "Diaz", "DS", 2028],
  ["15", "Harper", "Kim", "OH", 2029], ["8", "Zoe", "Grant", "MB", 2029],
].map(([num, first, last, pos, grad]) => ({ id: "sp" + num, num: String(num), first: String(first), last: String(last), pos: String(pos), grad: +grad }));

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Generate a full sample match. `strength` nudges how good our team is (0.8 weak – 1.2 strong). */
export function sampleMatch(seed: number, startTs: number, opts: { sets?: number; strength?: number; finished?: boolean } = {}): MatchEvent[] {
  const r = mulberry(seed), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)], rnd = (a: number, b: number) => +(a + r() * (b - a)).toFixed(2);
  const k = opts.strength ?? 1;
  const ev: any[] = []; let ts = startTs, n = 0;
  const push = (t: string, p?: string | null, loc?: number[] | null, extra?: object) => {
    const e: any = { id: "smp" + seed + "-" + n++, t, ts: (ts += 7000) };
    if (p) e.p = p; if (loc) { e.x = loc[0]; e.y = loc[1]; } if (extra) Object.assign(e, extra); ev.push(e);
  };
  const P = (x: string) => "sp" + x;
  const LU = ["1", "7", "9", "14", "4", "12"].map(P); let lu = LU.slice(), serve: "us" | "them" = seed % 2 ? "us" : "them";
  push("NS", null, null, { serve, lu: LU.slice(), lib: P("3"), libSrv: null });
  const atk: Record<string, { k: number; e: number }> = { [P("7")]: { k: 0.36, e: 0.13 }, [P("4")]: { k: 0.22, e: 0.2 }, [P("14")]: { k: 0.3, e: 0.15 }, [P("9")]: { k: 0.34, e: 0.12 }, [P("12")]: { k: 0.28, e: 0.15 }, [P("15")]: { k: 0.27, e: 0.16 }, [P("8")]: { k: 0.25, e: 0.15 } };
  const oppN = ["11", "11", "11", "7", "7", "3", "15", "9"];
  const locThem = () => [rnd(0.2, 8.8), rnd(0.3, 8.6)], locUs = () => [rnd(0.2, 8.8), rnd(9.6, 17.6)];
  const front = () => [lu[1], lu[2], lu[3]];
  const server = () => lu[0];
  function rally(): "us" | "them" {
    const passers = [P("3"), P("4"), P("7")];
    if (serve === "us") {
      const s = server(), x = r();
      if (x < 0.09 / k) { push(r() < 0.5 ? "SEN" : "SEO", s); return "them"; }
      if (x < 0.09 / k + 0.07 * k) { push("SA", s, [rnd(0.2, 3), rnd(0.3, 5.5)]); return "us"; }
      push("SI", s, r() < 0.6 ? [rnd(0.2, 3.2), rnd(0.3, 6)] : locThem());
    } else {
      const x = r(), p = pick(passers);
      if (x < 0.07) { push("OE", null, null, { op: pick(oppN) }); return "us"; }
      if (x < 0.13 / k) { push("P0", p, locUs()); return "them"; }
      const y = r() * k;
      push(p === P("4") ? (y < 0.25 ? "P3" : y < 0.6 ? "P2" : "P1") : y < 0.45 ? "P3" : y < 0.85 ? "P2" : "P1", p, locUs());
    }
    for (let i = 0; i < 4; i++) {
      if (r() < 0.6) {
        const cand = front().filter((id) => atk[id]); const a = cand.length ? pick(cand) : P("7"), A = atk[a], z = r() / k;
        if (z < A.k) { push("AST", P("1")); push("K", a, a === P("7") ? [rnd(0.2, 3.5), rnd(0.5, 5)] : locThem()); return "us"; }
        push("SATT", P("1"));
        if (r() < A.e * 1.15) { push("AE", a); return "them"; }
        push("TA", a, locThem());
      }
      const w = r();
      if (w < 0.3 / k) {
        if (r() < 0.25) push("DE", pick([P("3"), P("10"), P("4"), P("7")]), locUs());
        else { const op = pick(oppN); push("OK", null, op === "11" ? [rnd(6.2, 8.8), rnd(13, 17.6)] : locUs(), { op }); }
        return "them";
      }
      if (w < 0.315) { push(pick(["CE", "EE", "PE"]), pick([P("3"), P("4"), P("7")])); return "them"; }
      if (w < 0.42) { push("OE", null, null, { op: pick(oppN) }); return "us"; }
      if (w < 0.5) {
        const fr = front().filter((id) => [P("9"), P("12"), P("14"), P("8")].includes(id));
        if (r() < 0.5 || fr.length < 2) push("BS", fr[0] || P("9")); else { push("BA", fr[0]); push("BA", fr[1]); }
        return "us";
      }
      if (w < 0.53) { push("BE", pick([P("9"), P("12")])); return "them"; }
      if (w < 0.55) { push("BHE", P("1")); return "them"; }
      if (w < 0.6) { push("FBR"); continue; }
      if (w < 0.62) push("OVP", pick([P("3"), P("4")]));
      push("D", pick([P("3"), P("10"), P("4"), P("7")]), r() < 0.5 ? locUs() : null);
    }
    push("OK", null, locUs(), { op: pick(oppN) }); return "them";
  }
  const sets = opts.sets ?? 2;
  let wonUs = 0, wonThem = 0;
  for (let s = 1; s <= sets; s++) {
    if (s > 1) { serve = serve === "us" ? "them" : "us"; lu = LU.slice(); push("NS", null, null, { serve, lu: LU.slice(), lib: P("3"), libSrv: null }); }
    const last = !opts.finished && s === sets;
    let us = 0, them = 0;
    const to = s === 5 ? 15 : 25;
    const stop = () => (last ? us + them >= 27 : Math.max(us, them) >= to && Math.abs(us - them) >= 2);
    while (!stop()) {
      const w = rally();
      if (w === "us") { us++; if (serve === "them") { serve = "us"; lu = lu.slice(1).concat(lu[0]); } }
      else { them++; if (serve === "us") serve = "them"; }
      if (s === 2 && us + them === 16) push("TO", null, null, { v: "them" });
      if (s === 2 && us + them === 10) { const i = lu.indexOf(P("4")); if (i >= 0) { push("SUB", null, null, { out: P("4"), in: P("15") }); lu[i] = P("15"); } }
    }
    if (us > them) wonUs++; else wonThem++;
    if (opts.finished && (wonUs === 3 || wonThem === 3)) break;
  }
  return ev as MatchEvent[];
}
