/** The flow of a set: the point differential rally by rally, drawn as a smooth line with each team's lead shaded
 * in its colour. Scoring runs of 3+ are labelled where they peak, timeouts are marked where they were called, and
 * tapping or hovering anywhere shows the score and what ended that rally. A new point draws in as it arrives.
 * Used on FloorCall Live (families) and the coach's Live page. */
import { useMemo, useRef, useState } from "react";
import type { Rally } from "../sports/volleyball/engine";
import { useWidth } from "./charts";
import "./momentum.css";

export interface FlowPoint { i: number; us: number; them: number; d: number; w: "us" | "them"; end: string; p: string | null; to: "us" | "them" | null }
export interface Run { side: "us" | "them"; len: number; from: number; to: number }

/** Score after each rally, plus the 0–0 start. Pure. */
export function flowOf(rallies: Rally[]): FlowPoint[] {
  let us = 0, them = 0;
  const out: FlowPoint[] = [{ i: 0, us: 0, them: 0, d: 0, w: "us", end: "", p: null, to: null }];
  rallies.forEach((r, k) => {
    if (typeof r.us === "number" && typeof r.them === "number") { us = r.us; them = r.them; } // the score before it, when known (fixes after edits)
    if (r.w === "us") us++; else them++;
    out.push({ i: k + 1, us, them, d: us - them, w: r.w, end: r.end, p: r.p, to: r.to || null });
  });
  return out;
}
/** Scoring runs of at least `min` points in a row. Pure. */
export function runsOf(f: FlowPoint[], min = 3): Run[] {
  const out: Run[] = [];
  for (let k = 1; k < f.length; ) {
    let j = k; while (j + 1 < f.length && f[j + 1].w === f[k].w) j++;
    if (j - k + 1 >= min) out.push({ side: f[k].w, len: j - k + 1, from: k, to: j });
    k = j + 1;
  }
  return out;
}

/** Smooth path through points without overshooting (monotone cubic, Fritsch–Carlson). */
function smooth(xs: number[], ys: number[]): string {
  const n = xs.length; if (n < 2) return n ? `M${xs[0]},${ys[0]}` : "";
  const dx = xs.slice(1).map((x, i) => x - xs[i]), m = ys.slice(1).map((y, i) => (y - ys[i]) / dx[i]);
  const t = [m[0], ...m.slice(1).map((v, i) => (v * m[i] <= 0 ? 0 : (3 * (dx[i] + dx[i + 1])) / ((2 * dx[i + 1] + dx[i]) / m[i] + (dx[i + 1] + 2 * dx[i]) / v))), m[m.length - 1]];
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(xs[i] + h).toFixed(1)},${(ys[i] + h * t[i]).toFixed(1)} ${(xs[i + 1] - h).toFixed(1)},${(ys[i + 1] - h * t[i + 1]).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

export function Momentum({ rallies, us, them, height = 170, describe, live }: {
  rallies: Rally[]; us: string; them: string; height?: number;
  /** "Maya kill", "Their ace": what ended a rally, for the hover readout */
  describe?: (pt: FlowPoint) => string;
  /** the set is being played now: the newest point draws in */
  live?: boolean;
}) {
  const [ref, cw] = useWidth(640);
  const f = useMemo(() => flowOf(rallies), [rallies]);
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const id = useMemo(() => "m" + Math.random().toString(36).slice(2, 8), []);
  if (f.length < 2) return <p className="empty">The flow of the set shows up after the first rally.</p>;
  const W = Math.max(260, cw), narrow = W < 520, H = narrow ? Math.min(height, 140) : height;
  const L = narrow ? 26 : 32, R = narrow ? 12 : 16, T = 18, B = 26;
  const peak = Math.max(4, ...f.map((p) => Math.abs(p.d)));
  const lim = Math.ceil(peak / 2) * 2;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, f.length - 1), y = (d: number) => T + ((lim - d) / (2 * lim)) * (H - T - B);
  const xs = f.map((p) => x(p.i)), ys = f.map((p) => y(p.d)), zero = y(0);
  const line = smooth(xs, ys), area = `${line}L${xs[xs.length - 1].toFixed(1)},${zero.toFixed(1)}L${xs[0].toFixed(1)},${zero.toFixed(1)}Z`;
  const runs = runsOf(f).filter((r) => r.len >= 3);
  const last = f[f.length - 1], biggest = { us: Math.max(0, ...f.map((p) => p.d)), them: Math.max(0, ...f.map((p) => -p.d)) };
  const ties = f.filter((p, k) => k > 0 && p.d === 0).length;
  let changes = 0; for (let k = 1, lead = 0; k < f.length; k++) { const sgn = Math.sign(f[k].d); if (sgn && lead && sgn !== lead) changes++; if (sgn) lead = sgn; }
  const ticks = [lim, lim / 2, 0, -lim / 2, -lim].filter((v, k, a) => a.indexOf(v) === k);
  const pick = (clientX: number) => { const r = svg.current?.getBoundingClientRect(); if (!r) return; const px = ((clientX - r.left) / r.width) * W; setHover(Math.max(1, Math.min(f.length - 1, Math.round(((px - L) / (W - L - R)) * (f.length - 1))))); };
  const hp = hover != null ? f[hover] : null;
  const say = (p: FlowPoint) => describe?.(p) || (p.w === "us" ? `Point ${us}` : `Point ${them}`);
  const runLabel = (r: Run) => `${r.len}–0`;
  const label = `Flow of the set: ${us} ${last.us}, ${them} ${last.them}. Biggest lead ${us} ${biggest.us}, ${them} ${biggest.them}. ${runs.length ? "Runs: " + runs.map((r) => `${r.side === "us" ? us : them} ${r.len} straight`).join(", ") + "." : ""}`;
  return <div className="mo" ref={ref}>
    <div className="mo-sum">
      <span><i className="mo-sw us" />{us} biggest lead <b>{biggest.us}</b></span>
      <span><i className="mo-sw them" />{them} biggest lead <b>{biggest.them}</b></span>
      <span>Ties <b>{ties}</b></span>
      {changes > 0 && <span>Lead changes <b>{changes}</b></span>}
    </div>
    <svg ref={svg} className="mo-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}
      onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
      <defs>
        <clipPath id={id + "u"}><rect x={0} y={0} width={W} height={zero} /></clipPath>
        <clipPath id={id + "t"}><rect x={0} y={zero} width={W} height={H - zero} /></clipPath>
        <linearGradient id={id + "gu"} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--us)" stopOpacity="0.42" /><stop offset="1" stopColor="var(--us)" stopOpacity="0.06" /></linearGradient>
        <linearGradient id={id + "gt"} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--them)" stopOpacity="0.06" /><stop offset="1" stopColor="var(--them)" stopOpacity="0.38" /></linearGradient>
      </defs>
      {ticks.map((v) => <g key={v} className="mo-grid"><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "zero" : ""} />
        <text x={L - 6} y={y(v) + 3.5} textAnchor="end">{v > 0 ? "+" + v : v < 0 ? "−" + -v : "0"}</text></g>)}
      {f.filter((p) => p.to).map((p) => <g key={"to" + p.i} className={"mo-to " + p.to}><line x1={x(p.i - 1)} x2={x(p.i - 1)} y1={T - 4} y2={H - B} /><text x={x(p.i - 1)} y={H - B + 14} textAnchor="middle">TO</text></g>)}
      <path d={area} fill={`url(#${id}gu)`} clipPath={`url(#${id}u)`} />
      <path d={area} fill={`url(#${id}gt)`} clipPath={`url(#${id}t)`} />
      <path d={line} className="mo-line us" clipPath={`url(#${id}u)`} />
      <path d={line} className="mo-line them" clipPath={`url(#${id}t)`} />
      {runs.map((r) => { const top = r.side === "us" ? Math.max(...f.slice(r.from, r.to + 1).map((p) => p.d)) : Math.min(...f.slice(r.from, r.to + 1).map((p) => p.d));
        // inside the shaded area, halfway between the run's peak and the zero line, over the middle of the run
        const px = x((f[r.from].i + f[r.to].i) / 2), py = (y(top) + zero) / 2 + 4;
        const w = 30 + (r.len >= 10 ? 7 : 0), cx = Math.min(W - R - w / 2, Math.max(L + w / 2, px));
        return <g key={"r" + r.from} className={"mo-run " + r.side}><rect x={cx - w / 2} y={py - 11} width={w} height={15} rx={7.5} /><text x={cx} y={py}>{runLabel(r)}</text></g>; })}
      {live && <circle key={"p" + f.length} cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4.5} className={"mo-pulse " + last.w} />}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4.5} className={"mo-end " + (last.d > 0 ? "us" : last.d < 0 ? "them" : last.w)} />
      {hp && <g className="mo-hover"><line x1={x(hp.i)} x2={x(hp.i)} y1={T - 4} y2={H - B} /><circle cx={x(hp.i)} cy={y(hp.d)} r={5} className={hp.w} /></g>}
      <text x={L} y={H - 6} className="mo-axis">0–0</text>
      <text x={W - R} y={H - 6} textAnchor="end" className="mo-axis">{last.us}–{last.them}</text>
    </svg>
    <div className="mo-read" aria-live="polite">{hp ? <><b className="num">{hp.us}–{hp.them}</b><span><i className={"mo-sw " + hp.w} />{hp.w === "us" ? us : them} point · {say(hp)}{hp.to ? ` · after a ${hp.to === "us" ? us : them} timeout` : ""}</span></>
      : <span className="mo-hint">Tap the chart to see any point.</span>}</div>
  </div>;
}
