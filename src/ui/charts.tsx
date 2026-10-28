/** Small hand-drawn SVG charts that follow the theme colors. */
import { useCallback, useRef, useState } from "react";

/** Width of an element in CSS pixels, so charts draw at real size and text stays readable on phones. */
function useWidth(fallback: number): [(el: Element | null) => void, number] {
  const [w, setW] = useState(fallback), ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: Element | null) => {
    ro.current?.disconnect(); if (!el || typeof ResizeObserver === "undefined") return;
    ro.current = new ResizeObserver((es) => { const cw = Math.round(es[0].contentRect.width); if (cw > 0) setW(cw); }); ro.current.observe(el);
  }, []);
  return [ref, w];
}

export function LineChart({ points, format, height = 230 }: { points: { label: string; sub?: string; v: number | null }[]; format: (v: number) => string; height?: number }) {
  const [ref, cw] = useWidth(640);
  const vals = points.map((p) => p.v).filter((v): v is number => v != null);
  if (!vals.length) return <p className="empty">No data for this stat yet.</p>;
  const W = Math.max(280, cw), H = W < 480 ? Math.min(height, 200) : height, L = 46, R = 16, T = 22, B = 46;
  let lo = Math.min(0, ...vals), hi = Math.max(...vals); if (hi === lo) hi = lo + 1;
  const n = points.length, x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + 18 + (i * (W - L - R - 36)) / (n - 1)), y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let path = ""; points.forEach((p, i) => { if (p.v != null) path += (path ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1); });
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 80))));
  return (
    <div ref={ref} style={{ width: "100%" }}><svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: "100%", height: "auto" }} role="img" aria-label="Trend chart">
      {[0, 1, 2, 3, 4].map((i) => { const v = lo + ((hi - lo) * i) / 4, yy = y(v); return <g key={i}><line x1={L} x2={W - R} y1={yy} y2={yy} stroke="var(--line)" /><text x={L - 8} y={yy + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{format(v)}</text></g>; })}
      {path && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={i}>
          {p.v != null && <><circle cx={x(i)} cy={y(p.v)} r={i === n - 1 ? 5 : 3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
            {(n <= Math.floor(W / 60) || i === n - 1) && <text x={x(i)} y={y(p.v) - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">{format(p.v)}</text>}</>}
          {(i % every === 0 || i === n - 1) && <><text x={x(i)} y={H - B + 18} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{p.label}</text><text x={x(i)} y={H - B + 32} textAnchor="middle" fontSize={10} fill="var(--muted)">{p.sub}</text></>}
        </g>
      ))}
    </svg></div>
  );
}

/** Running point differential through a set: above the line = we lead. */
export function MomentumChart({ diffs, height = 140, labels }: { diffs: number[]; height?: number; labels?: [string, string] }) {
  const [ref, cw] = useWidth(640);
  if (!diffs.length) return <p className="empty">Momentum shows up after the first rally.</p>;
  const W = Math.max(260, cw), H = W < 480 ? Math.min(height, 110) : height, P = 10, mx = Math.max(3, ...diffs.map(Math.abs));
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, diffs.length - 1), y = (v: number) => H / 2 - (v / mx) * (H / 2 - P);
  const pts = diffs.map((d, i) => `${x(i).toFixed(1)},${y(d).toFixed(1)}`).join(" ");
  return (
    <div ref={ref} style={{ width: "100%" }}><svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: "100%", height: "auto" }} role="img" aria-label="Momentum">
      <rect x={0} y={0} width={W} height={H / 2} fill="var(--us-soft)" opacity={0.6} />
      <rect x={0} y={H / 2} width={W} height={H / 2} fill="var(--them-soft)" opacity={0.6} />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--muted)" strokeWidth={1} />
      <polyline points={`${x(0)},${H / 2} ${pts}`} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(diffs.length - 1)} cy={y(diffs[diffs.length - 1])} r={3.5} fill="var(--ink)" />
      <text x={6} y={14} fontSize={11} fill="var(--us)" fontWeight={700}>{labels?.[0] || "Ahead"}</text>
      <text x={6} y={H - 6} fontSize={11} fill="var(--them)" fontWeight={700}>{labels?.[1] || "Behind"}</text>
    </svg></div>
  );
}

export function StackBar({ segs }: { segs: { label: string; n: number; color: string; opacity?: number }[] }) {
  const tot = segs.reduce((a, s) => a + s.n, 0);
  if (!tot) return <p className="empty">No points yet.</p>;
  return <>
    <div className="bar">{segs.filter((s) => s.n).map((s) => <span key={s.label} title={`${s.label} ${s.n}`} style={{ width: (100 * s.n) / tot + "%", background: s.color, opacity: s.opacity ?? 1 }} />)}</div>
    <div className="keys" style={{ marginTop: 5 }}>{segs.filter((s) => s.n).map((s) => <span key={s.label}><span className="sw" style={{ background: s.color, opacity: s.opacity ?? 1 }} />{s.label} {s.n}</span>)}</div>
  </>;
}

/** Horizontal bar centered on zero, for rotation +/-. */
export function Diverge({ v, max }: { v: number; max: number }) {
  const w = (50 * Math.abs(v)) / Math.max(1, max);
  return <div style={{ position: "relative", height: 14, background: "var(--surface-2)", borderRadius: 4 }}>
    <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--muted)" }} />
    <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 3, background: v >= 0 ? "var(--us)" : "var(--them)", ...(v >= 0 ? { left: "50%", width: w + "%" } : { right: "50%", width: w + "%" }) }} />
  </div>;
}
