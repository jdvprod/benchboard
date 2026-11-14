/** A volleyball gym in 3D: a wood floor, a painted court, the net, and players as figures standing where they play.
 * Drag to move the camera around. Drawn as SVG with its own perspective math (no WebGL), so it scales, prints and works offline. */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";

export interface Peg { num: string; name: string; x: number; y: number; lib?: boolean; hl?: boolean; ball?: boolean; /** where this player moves to: drawn as a dashed arrow on the floor */ to?: [number, number] | null; /** a point the route bends through, for curved runs */ via?: [number, number] | null }

/** A point along a route: straight, or a curve that passes through `via` halfway. k runs 0 (start) to 1 (end). */
export function along(x: number, y: number, to: [number, number], via: [number, number] | null | undefined, k: number): [number, number] {
  if (!via) return [x + (to[0] - x) * k, y + (to[1] - y) * k];
  const cx = 2 * via[0] - (x + to[0]) / 2, cy = 2 * via[1] - (y + to[1]) / 2, a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
  return [a * x + b * cx + c * to[0], a * y + b * cy + c * to[1]];
}

// world: x across the court (0–9 m), y from our end line toward the net (9) and their end line (18), z up
const W = 900, H = 520, F = 1050;
type V = [number, number, number];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number) => (d * Math.PI) / 180;

/** A camera circling the court: az 0 = behind our end line, el = how high. Returns world → [screen x, screen y, px per meter, depth]. */
function camera(az: number, el: number) {
  const DIST = 22 + Math.max(0, el - 30) * 0.3;
  const C = [4.5, 6.4 - Math.max(0, el - 30) * 0.04, 0.5];
  const cam = [C[0] + DIST * Math.sin(rad(az)) * Math.cos(rad(el)), C[1] - DIST * Math.cos(rad(az)) * Math.cos(rad(el)), C[2] + DIST * Math.sin(rad(el))];
  const fw = norm(sub(C, cam)), rt = norm(cross(fw, [0, 0, 1])), up = cross(rt, fw);
  const pr = (x: number, y: number, z = 0): [number, number, number, number] => { const d = sub([x, y, z], cam), cz = Math.max(0.6, dot(d, fw)), s = F / cz; return [W / 2 + dot(d, rt) * s, H * 0.52 - dot(d, up) * s, s, cz]; };
  /** A point on screen back to the floor (z = 0). */
  const un = (sx: number, sy: number): [number, number] => { const d = [0, 1, 2].map((i) => fw[i] * F + rt[i] * (sx - W / 2) - up[i] * (sy - H * 0.52)); const t = d[2] < -1e-6 ? -cam[2] / d[2] : 0; return [cam[0] + d[0] * t, cam[1] + d[1] * t]; };
  return { cam, pr, un };
}

/** Where the six stand: base spots by lineup index (0 = P1 right back … 3 = P4 left front), and a W serve-receive shape. */
export const BASE: [number, number][] = [[7.4, 2.2], [7.4, 7.4], [4.5, 7.6], [1.6, 7.4], [1.6, 2.2], [4.5, 2.6]];
export const RECEIVE: [number, number][] = [[7.3, 2.4], [7.9, 8.1], [6.6, 5.4], [2.4, 5.4], [1.7, 2.4], [4.5, 3.2]];
export const SERVE_SPOT: [number, number] = [7.6, -1.1];
const THEM: [number, number][] = BASE.map(([x, y]) => [9 - x, 18 - y]);
const VIEWS: [string, number, number][] = [["Behind", 0, 24], ["Corner", -38, 22], ["Side", -78, 16], ["Above", 0, 58]];
const NET = 2.24, XMIN = -7, XMAX = 16, YMIN = -6, YMAX = 24, WALL = 7.5;

/** A player as a simple figure in a ready stance, drawn upright at a floor spot. u = pixels per meter there. */
function Figure({ x, y, u, k, cls, num, back }: { x: number; y: number; u: number; k: number; cls: string; num?: string; back: boolean }) {
  // k squashes height as the camera climbs, so figures foreshorten instead of lying flat on the floor
  const p = (dx: number, h: number) => `${(x + dx * u).toFixed(1)} ${(y - h * u * k).toFixed(1)}`;
  const limb = u * 0.105;
  return <g className={"c3d-fig " + cls}>
    <path d={`M${p(-0.2, 0.03)} L${p(-0.17, 0.5)} L${p(-0.1, 0.92)} M${p(0.2, 0.03)} L${p(0.17, 0.5)} L${p(0.1, 0.92)}`} className="c3d-limb" strokeWidth={limb} />
    <path d={`M${p(-0.24, 0.02)} L${p(-0.14, 0.02)} M${p(0.14, 0.02)} L${p(0.24, 0.02)}`} className="c3d-shoe" strokeWidth={limb * 1.15} />
    <path d={`M${p(-0.2, 0.98)} L${p(0.2, 0.98)} L${p(0.21, 0.7)} L${p(0.04, 0.68)} L${p(0, 0.8)} L${p(-0.04, 0.68)} L${p(-0.21, 0.7)} Z`} className="c3d-shorts" />
    <path d={`M${p(-0.23, 1.4)} L${p(-0.34, 1.16)} L${p(-0.3, 0.98)} M${p(0.23, 1.4)} L${p(0.34, 1.16)} L${p(0.3, 0.98)}`} className="c3d-limb" strokeWidth={limb * 0.85} />
    <path d={`M${p(-0.25, 1.46)} Q${p(0, 1.52)} ${p(0.25, 1.46)} L${p(0.19, 0.95)} Q${p(0, 0.92)} ${p(-0.19, 0.95)} Z`} className="c3d-jersey" />
    <path d={`M${p(-0.25, 1.46)} L${p(-0.33, 1.3)} L${p(-0.24, 1.25)} Z M${p(0.25, 1.46)} L${p(0.33, 1.3)} L${p(0.24, 1.25)} Z`} className="c3d-jersey" />
    {num && <text x={x} y={y - 1.2 * u * k} textAnchor="middle" dominantBaseline="central" style={{ fontSize: u * (num.length > 1 ? 0.27 : 0.32) }} className="c3d-num">{num}</text>}
    <circle cx={x} cy={y - 1.64 * u * k} r={u * 0.125} className="c3d-head" />
    {back && <path d={`M${p(-0.125, 1.66)} A${u * 0.125} ${u * 0.125} 0 0 1 ${p(0.125, 1.66)} L${p(0.1, 1.58)} L${p(-0.1, 1.58)} Z`} className="c3d-hair" />}
  </g>;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** With onMove / onRoute the court is a board: drag a player to move her, or (tool "route") drag from a player to draw where she goes. */
export function Court3D({ pegs, label, ball, tool = "move", onMove, onRoute }: { pegs: Peg[]; label: string; ball?: [number, number, number] | null; tool?: "move" | "route";
  onMove?: (i: number, x: number, y: number) => void; onRoute?: (i: number, to: [number, number] | null, via?: [number, number] | null) => void }) {
  const svg = useRef<SVGSVGElement>(null), grab = useRef<{ i: number; dx: number; dy: number; path?: [number, number][] } | null>(null);
  const edit = !!(onMove || onRoute);
  // on a phone, trim the empty gym at the sides so the court and players are bigger
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 640px)").matches);
  useEffect(() => { const q = matchMedia("(max-width: 640px)"), f = () => setNarrow(q.matches); q.addEventListener("change", f); return () => q.removeEventListener("change", f); }, []);
  const vx = narrow ? 120 : 0, vw = narrow ? 660 : W;
  const [az, setAz] = useState(0), [el, setEl] = useState(24);
  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const { cam, pr, un } = useMemo(() => camera(az, el), [az, el]);
  const pt = (x: number, y: number, z = 0) => { const q = pr(x, y, z); return q[0].toFixed(1) + "," + q[1].toFixed(1); };
  const poly = (v: V[]) => v.map(([x, y, z]) => pt(x, y, z)).join(" ");
  const seg = (a: V, b: V) => { const p = pr(...a), q = pr(...b); return { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }; };
  const dist = (x: number, y: number) => Math.hypot(x - cam[0], y - cam[1]);
  const ours = pegs.map((p, i) => ({ ...p, i })).sort((a, b) => dist(b.x, b.y) - dist(a.x, a.y));
  const theirs = THEM.slice().sort((a, b) => dist(b[0], b[1]) - dist(a[0], a[1]));
  const k = Math.max(0.6, Math.cos(rad(el)) / Math.cos(rad(24)) > 1 ? 1 : Math.cos(rad(el)) / Math.cos(rad(24)));
  const planks: number[] = []; for (let x = XMIN; x <= XMAX + 0.01; x += 0.5) planks.push(x);
  const meshV: number[] = []; for (let x = 0; x <= 9.01; x += 0.45) meshV.push(x);
  const floor = (e: RPE): [number, number] => { const r = svg.current!.getBoundingClientRect(); return un(vx + ((e.clientX - r.left) / r.width) * vw, ((e.clientY - r.top) / r.height) * H); };
  const down = (e: RPE) => {
    const hit = edit ? (e.target as Element).closest?.("[data-i]") : null;
    if (hit) { const i = +hit.getAttribute("data-i")!, f = floor(e), p = pegs[i]; grab.current = tool === "move" ? { i, dx: p.x - f[0], dy: p.y - f[1] } : { i, dx: 0, dy: 0, path: [] }; }
    else drag.current = { x: e.clientX, y: e.clientY, az, el };
    svg.current?.setPointerCapture?.(e.pointerId);
  };
  const up = () => { const g = grab.current; if (g && tool === "route" && onRoute) { const p = pegs[g.i]; if (!g.path?.length || (p.to && Math.hypot(p.to[0] - p.x, p.to[1] - p.y) < 0.5)) onRoute(g.i, null); } grab.current = null; drag.current = null; };
  const move = (e: RPE) => {
    const g = grab.current;
    if (g) { const f = floor(e), x = clamp(f[0] + g.dx, -1.4, 10.4), y = clamp(f[1] + g.dy, -2.4, 8.9); if (tool === "move") onMove?.(g.i, +x.toFixed(2), +y.toFixed(2)); else {
      // the route bends through whichever point of the drag strayed furthest from a straight line (if it strayed at all)
      const p = pegs[g.i], path = g.path!; path.push([x, y]);
      const dx = x - p.x, dy = y - p.y, len = Math.hypot(dx, dy) || 1; let far = 0, via: [number, number] | null = null;
      for (const q of path) { const d = Math.abs((q[0] - p.x) * dy - (q[1] - p.y) * dx) / len; if (d > far) { far = d; via = q; } }
      onRoute?.(g.i, [+x.toFixed(2), +y.toFixed(2)], far > 0.6 && via ? [+via[0].toFixed(2), +via[1].toFixed(2)] : null);
    } return; }
    const d = drag.current; if (!d) return; setAz(Math.max(-85, Math.min(85, d.az - (e.clientX - d.x) * 0.35))); setEl(Math.max(10, Math.min(64, d.el + (e.clientY - d.y) * 0.25))); };

  return <div className="c3d-box">
    <svg ref={svg} className={"c3d" + (edit ? " edit" : "")} viewBox={`${vx} 0 ${vw} ${H}`} role="img" aria-label={label}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <defs>
        <linearGradient id="c3d-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141C24" /><stop offset="1" stopColor="#2A3642" /></linearGradient>
        <linearGradient id="c3d-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B4844D" /><stop offset="1" stopColor="#E6BA80" /></linearGradient>
        <radialGradient id="c3d-light" cx="50%" cy="58%" r="75%"><stop offset="0" stopColor="#fff" stopOpacity="0.16" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.5" /></radialGradient>
        <radialGradient id="c3d-sh"><stop offset="0" stopColor="#000" stopOpacity="0.5" /><stop offset="0.6" stopColor="#000" stopOpacity="0.2" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <filter id="c3d-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id="c3d-drop" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.5" /></filter>
      </defs>
      <rect width={W} height={H} fill="#0B1117" />
      {/* the gym: far wall with a band of bleachers, side walls when the camera is inside them */}
      <polygon points={poly([[XMIN, YMAX, 0], [XMAX, YMAX, 0], [XMAX, YMAX, WALL], [XMIN, YMAX, WALL]])} fill="url(#c3d-wall)" />
      {[0.9, 1.5, 2.1, 2.7].map((z) => <line key={z} {...seg([XMIN, YMAX - 0.05, z], [XMAX, YMAX - 0.05, z])} stroke="#3A4856" strokeWidth={2.2} opacity={0.7} />)}
      <polygon points={poly([[XMIN, YMAX - 0.04, 4.2], [XMAX, YMAX - 0.04, 4.2], [XMAX, YMAX - 0.04, 4.9], [XMIN, YMAX - 0.04, 4.9]])} className="c3d-banner" />
      {cam[0] > XMIN + 1 && <polygon points={poly([[XMIN, YMIN, 0], [XMIN, YMAX, 0], [XMIN, YMAX, WALL], [XMIN, YMIN, WALL]])} fill="#18222C" />}
      {cam[0] < XMAX - 1 && <polygon points={poly([[XMAX, YMIN, 0], [XMAX, YMAX, 0], [XMAX, YMAX, WALL], [XMAX, YMIN, WALL]])} fill="#18222C" />}
      {/* wood floor with plank seams */}
      <polygon points={poly([[XMIN, YMIN, 0], [XMAX, YMIN, 0], [XMAX, YMAX, 0], [XMIN, YMAX, 0]])} fill="url(#c3d-wood)" />
      <g stroke="#8A5F30" strokeWidth={0.7} opacity={0.45}>{planks.map((x) => <line key={x} {...seg([x, YMIN, 0], [x, YMAX, 0])} />)}</g>
      {/* painted court: one color, front zones a shade deeper, a lighter border of free zone */}
      <polygon points={poly([[-1.6, -2.6, 0], [10.6, -2.6, 0], [10.6, 20.6, 0], [-1.6, 20.6, 0]])} className="c3d-apron" />
      <polygon points={poly([[0, 0, 0], [9, 0, 0], [9, 18, 0], [0, 18, 0]])} className="c3d-paint" />
      <polygon points={poly([[0, 6, 0], [9, 6, 0], [9, 12, 0], [0, 12, 0]])} className="c3d-front" />
      <g className="c3d-lines">
        <polygon points={poly([[0, 0, 0], [9, 0, 0], [9, 18, 0], [0, 18, 0]])} fill="none" />
        <line {...seg([0, 9, 0], [9, 9, 0])} /><line {...seg([0, 6, 0], [9, 6, 0])} /><line {...seg([0, 12, 0], [9, 12, 0])} />
        {[6, 12].map((y) => [-1, 1].map((sd) => [0, 1, 2].map((k) => { const x0 = sd < 0 ? -0.25 - k * 0.4 : 9.25 + k * 0.4; return <line key={y + "-" + sd + "-" + k} {...seg([x0, y, 0], [x0 + sd * 0.2, y, 0])} />; })))}
      </g>
      {/* soft light on the floor, then the net's shadow */}
      <polygon points={poly([[1, 1.5, 0], [8, 1.5, 0], [8, 16.5, 0], [1, 16.5, 0]])} fill="#fff" opacity={0.06} filter="url(#c3d-soft)" />
      <polygon points={poly([[-0.4, 9, 0], [9.4, 9, 0], [9.4, 9.9, 0], [-0.4, 9.9, 0]])} fill="#000" opacity={0.2} filter="url(#c3d-soft)" />
      {/* the other team, faint, behind the net */}
      {theirs.map(([x, y], i) => { const q = pr(x, y, 0); return <g key={"t" + i} opacity={0.5}>
        <ellipse cx={q[0]} cy={q[1]} rx={q[2] * 0.42} ry={q[2] * 0.42 * Math.sin(rad(el))} fill="url(#c3d-sh)" /><Figure x={q[0]} y={q[1]} u={q[2]} k={k} cls="them" back={false} /></g>; })}
      {/* the net: posts with pads, mesh, tapes, antennas */}
      {[-0.9, 9.9].map((x) => <g key={x}><line {...seg([x, 9, 0], [x, 9, 2.55])} stroke="#27313B" strokeWidth={pr(x, 9, 1)[2] * 0.16} strokeLinecap="round" />
        <line {...seg([x, 9, 0.1], [x, 9, 1.9])} className="c3d-pad" strokeWidth={pr(x, 9, 1)[2] * 0.34} strokeLinecap="round" /></g>)}
      <polygon points={poly([[0, 9, NET - 1], [9, 9, NET - 1], [9, 9, NET], [0, 9, NET]])} fill="#0B1117" opacity={0.28} />
      <g stroke="#0E151B" strokeWidth={0.7} opacity={0.75}>
        {meshV.map((x) => <line key={x} {...seg([x, 9, NET - 1], [x, 9, NET])} />)}
        {[0.2, 0.4, 0.6, 0.8].map((k) => <line key={k} {...seg([0, 9, NET - 1 + k], [9, 9, NET - 1 + k])} />)}
      </g>
      <line {...seg([-0.9, 9, NET], [9.9, 9, NET])} stroke="#1B242C" strokeWidth={1} />
      <line {...seg([0, 9, NET - 0.035], [9, 9, NET - 0.035])} stroke="#FBFBF6" strokeWidth={Math.max(3, pr(4.5, 9, NET)[2] * 0.07)} />
      <line {...seg([0, 9, NET - 1], [9, 9, NET - 1])} stroke="#FBFBF6" strokeWidth={Math.max(1.5, pr(4.5, 9, NET)[2] * 0.035)} />
      {[0, 9].map((x) => <g key={x}><line {...seg([x, 9, NET - 1], [x, 9, NET])} stroke="#FBFBF6" strokeWidth={Math.max(2, pr(x, 9, NET)[2] * 0.05)} />
        <line {...seg([x, 9, NET - 1], [x, 9, NET + 0.8])} stroke="#F4F4F0" strokeWidth={2.2} /><line {...seg([x, 9, NET - 1], [x, 9, NET + 0.8])} stroke="#D7263D" strokeWidth={2.2} strokeDasharray="5 5" /></g>)}
      {/* routes: a dashed path on the floor, an arrowhead, and a ring where she ends up */}
      {pegs.map((p, i) => { if (!p.to) return null; const [tx, ty] = p.to; if (Math.hypot(tx - p.x, ty - p.y) < 0.3) return null;
        const N = p.via ? 18 : 2, pts: [number, number][] = []; for (let n = 0; n <= N; n++) pts.push(along(p.x, p.y, p.to, p.via, n / N));
        // start just clear of her feet, stop where the arrowhead begins
        const [qx, qy] = pts[N - 1], dl = Math.hypot(tx - qx, ty - qy) || 1, ux = (tx - qx) / dl, uy = (ty - qy) / dl, hx = tx - ux * 0.55, hy = ty - uy * 0.55, c = pr(tx, ty, 0);
        const line = pts.filter(([x, y], n) => n === 0 || Math.hypot(tx - x, ty - y) > 0.55).map(([x, y], n) => n === 0 && !p.via ? [x + ux * 0.3, y + uy * 0.3] : [x, y]).concat([[hx, hy]]);
        return <g key={"r" + i} className={"c3d-route" + (p.lib ? " lib" : "")}>
          <ellipse cx={c[0]} cy={c[1]} rx={c[2] * 0.36} ry={Math.max(2, c[2] * 0.36 * Math.sin(rad(el)))} />
          <polyline points={line.map(([x, y]) => pt(x, y)).join(" ")} strokeDasharray="9 7" />
          <polygon points={poly([[tx, ty, 0], [hx - uy * 0.28, hy + ux * 0.28, 0], [hx + uy * 0.28, hy - ux * 0.28, 0]])} />
        </g>; })}
      {ball && (() => { const g = pr(ball[0], ball[1], 0), b = pr(ball[0], ball[1], ball[2]); return <g>
        <ellipse cx={g[0]} cy={g[1]} rx={g[2] * 0.14} ry={Math.max(1.5, g[2] * 0.14 * Math.sin(rad(el)))} fill="#000" opacity={0.35} />
        <circle cx={b[0]} cy={b[1]} r={b[2] * 0.11} fill="#FDFBF4" stroke="#1E2A33" strokeWidth={0.8} /><path d={`M${b[0] - b[2] * 0.11} ${b[1]} Q${b[0]} ${b[1] - b[2] * 0.07} ${b[0] + b[2] * 0.11} ${b[1]}`} fill="none" stroke="#2B79B0" strokeWidth={1} /></g>; })()}
      {/* our six */}
      {ours.map((p) => { const q = pr(p.x, p.y, 0), u = q[2], top = q[1] - 1.92 * u * k, tag = p.name.toUpperCase().slice(0, 10), tw = tag.length * 7 + 14;
        return <g key={p.i} data-i={p.i} className={edit ? "c3d-grab" : undefined}>
          <ellipse cx={q[0]} cy={q[1]} rx={u * 0.46} ry={Math.max(2, u * 0.46 * Math.sin(rad(el)))} fill="url(#c3d-sh)" />
          <Figure x={q[0]} y={q[1]} u={u} k={k} cls={(p.lib ? "lib" : "us") + (p.hl ? " hl" : "")} num={p.num} back={Math.abs(az) < 60} />
          {p.ball && <g transform={`translate(${q[0] + u * 0.36} ${q[1] - u * 1.05 * k})`}><circle r={u * 0.105} fill="#FDFBF4" stroke="#1E2A33" strokeWidth={0.8} /><path d={`M${-u * 0.105} 0 Q0 ${-u * 0.06} ${u * 0.105} 0`} fill="none" stroke="#2B79B0" strokeWidth={1} /></g>}
          {edit && <rect x={q[0] - u * 0.5} y={q[1] - 2.1 * u * k} width={u} height={2.2 * u * k} fill="transparent" />}
          <g transform={`translate(${q[0]} ${top})`} filter="url(#c3d-drop)"><rect x={-tw / 2} y={-9} width={tw} height={18} rx={9} className={"c3d-tag" + (p.hl ? " hl" : "")} /><text textAnchor="middle" dominantBaseline="central" className="c3d-name">{tag}</text></g>
        </g>; })}
      <rect width={W} height={H} fill="url(#c3d-light)" pointerEvents="none" />
    </svg>
    <div className="c3d-views" role="group" aria-label="Camera">
      {VIEWS.map(([l, a, e]) => <button key={l} aria-pressed={Math.abs(az - a) < 1 && Math.abs(el - e) < 1} onClick={() => { setAz(a); setEl(e); }}>{l}</button>)}
      <span>{edit ? (tool === "move" ? "Drag a player to move her. Drag the floor to turn the court." : "Drag from a player to draw her route; curve the drag to bend it. Tap her to clear it.") : "Drag the court to turn it"}</span>
    </div>
  </div>;
}
