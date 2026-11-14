/** A volleyball court in 3D, seen from behind our end line: where our six stand in a rotation, serving or receiving.
 * Drawn as SVG with its own perspective math (no WebGL), so it prints, scales and works offline. */

export interface Peg { num: string; name: string; x: number; y: number; lib?: boolean; hl?: boolean }

// world: x across the court (0–9 m, left to right), y from our end line toward the net (9) and their end line (18), z up
const W = 760, H = 430, F = 900;
const CAM = [4.5, -12, 9], AT = [4.5, 6.2, 0];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const FW = norm(sub(AT, CAM)), RT = norm(cross(FW, [0, 0, 1])), UP = cross(RT, FW);
/** World point → screen [x, y, pixels per meter at that depth]. */
export function project(x: number, y: number, z = 0): [number, number, number] {
  const d = sub([x, y, z], CAM), cz = dot(d, FW), s = F / cz;
  return [W / 2 + dot(d, RT) * s, H * 0.5 - dot(d, UP) * s, s];
}
const poly = (pts: [number, number, number?][]) => pts.map(([x, y, z]) => project(x, y, z || 0).slice(0, 2).join(",")).join(" ");
const seg = (a: [number, number, number?], b: [number, number, number?]) => { const p = project(a[0], a[1], a[2] || 0), q = project(b[0], b[1], b[2] || 0); return { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }; };

/** Where the six stand: base spots by lineup index (0 = P1 right back … 3 = P4 left front), and a W serve-receive shape. */
export const BASE: [number, number][] = [[7.4, 2.2], [7.4, 7.4], [4.5, 7.6], [1.6, 7.4], [1.6, 2.2], [4.5, 2.6]];
export const RECEIVE: [number, number][] = [[7.3, 2.4], [7.9, 8.1], [6.6, 5.4], [2.4, 5.4], [1.7, 2.4], [4.5, 3.2]];
export const SERVE_SPOT: [number, number] = [7.6, -0.9];

export function Court3D({ pegs, label }: { pegs: Peg[]; label: string }) {
  const NET = 2.24, order = pegs.slice().sort((a, b) => b.y - a.y); // far players first
  return <svg className="c3d" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
    <defs>
      <linearGradient id="c3d-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B88A52" /><stop offset="1" stopColor="#E3B67C" /></linearGradient>
      <linearGradient id="c3d-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B1117" stopOpacity="0.55" /><stop offset="0.5" stopColor="#0B1117" stopOpacity="0" /></linearGradient>
      <pattern id="c3d-mesh" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0H7M0 0V7" stroke="#10181F" strokeWidth="0.8" opacity="0.6" /></pattern>
      <radialGradient id="c3d-sh"><stop offset="0" stopColor="#000" stopOpacity="0.4" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
    </defs>
    <rect width={W} height={H} fill="url(#c3d-floor)" />
    <rect width={W} height={Math.max(0, project(4.5, 60, 0)[1])} fill="#0F1720" />
    {/* their half, then ours */}
    <polygon points={poly([[0, 9], [9, 9], [9, 18], [0, 18]])} className="c3d-them" />
    <polygon points={poly([[0, 0], [9, 0], [9, 9], [0, 9]])} className="c3d-us" />
    <polygon points={poly([[0, 6], [9, 6], [9, 12], [0, 12]])} fill="#000" opacity="0.1" />
    <g className="c3d-lines">
      <polygon points={poly([[0, 0], [9, 0], [9, 18], [0, 18]])} fill="none" />
      <line {...seg([0, 9], [9, 9])} /><line {...seg([0, 6], [9, 6])} /><line {...seg([0, 12], [9, 12])} />
    </g>
    <rect width={W} height={H} fill="url(#c3d-fade)" pointerEvents="none" />
    {/* the net is beyond all six from this side, so it is drawn first and the players over it */}
    <polygon points={poly([[0, 9, 0], [9, 9, 0], [9, 9.5, 0], [0, 9.5, 0]])} fill="#000" opacity="0.18" />
    <polygon points={poly([[0, 9, 1.24], [9, 9, 1.24], [9, 9, NET], [0, 9, NET]])} fill="url(#c3d-mesh)" />
    <line {...seg([0, 9, NET], [9, 9, NET])} stroke="#F7F7F2" strokeWidth="3.2" />
    <line {...seg([0, 9, 1.24], [9, 9, 1.24])} stroke="#F7F7F2" strokeWidth="1.4" opacity="0.8" />
    {[-0.6, 9.6].map((x) => <line key={x} {...seg([x, 9, 0], [x, 9, 2.55])} stroke="#39424B" strokeWidth="5" strokeLinecap="round" />)}
    {[0, 9].map((x) => <line key={x} {...seg([x, 9, NET], [x, 9, NET + 0.8])} stroke="#D7263D" strokeWidth="2" strokeDasharray="5 4" />)}
    {order.map((p) => {
      const [fx, fy, s] = project(p.x, p.y, 0), [, hy] = project(p.x, p.y, 1.72), [, sy] = project(p.x, p.y, 1.42);
      const r = Math.max(9, s * 0.3), bw = s * 0.46, tag = p.name.toUpperCase().slice(0, 10), tw = tag.length * 6.4 + 12;
      return <g key={p.num + p.name} className={"c3d-p" + (p.lib ? " lib" : "") + (p.hl ? " hl" : "")}>
        <ellipse cx={fx} cy={fy} rx={s * 0.55} ry={s * 0.2} fill="url(#c3d-sh)" />
        <line x1={fx} y1={fy - bw * 0.3} x2={fx} y2={sy} strokeWidth={bw} strokeLinecap="round" className="c3d-body" />
        <circle cx={fx} cy={hy} r={r} className="c3d-head" />
        <text x={fx} y={hy} textAnchor="middle" dominantBaseline="central" style={{ fontSize: r * 1.05 }} className="c3d-num">{p.num}</text>
        <g transform={`translate(${fx} ${hy - r - 11})`}><rect x={-tw / 2} y={-8} width={tw} height={16} rx={8} className="c3d-tag" /><text textAnchor="middle" dominantBaseline="central" className="c3d-name">{tag}</text></g>
      </g>;
    })}
  </svg>;
}
