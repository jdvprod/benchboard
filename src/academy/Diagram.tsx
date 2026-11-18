/** Court diagrams for each skill, seen from above. Our side is the left half, facing the net (the right is the other team).
 * Facing the net from the left, a player's left is the top of the picture: zone 4 is top-front, zone 2 bottom-front,
 * zone 5 top-back, zone 1 bottom-back, zone 6 middle-back. Units are meters: the court is 18 by 9. */
type Pt = [number, number];
interface Spec {
  title: string;
  zones?: { n: number; at: Pt; hot?: boolean }[];
  us?: { at: Pt; label: string; key?: boolean }[];
  them?: { at: Pt; label: string }[];
  ball?: { from: Pt; to: Pt; bend?: number; label?: string }[];
  run?: { from: Pt; to: Pt; bend?: number }[];
  target?: Pt;
  shade?: Pt[];
  notes?: { at: Pt; text: string; anchor?: "start" | "middle" | "end" }[];
}
// zone centers on our side (left half, x 0..9) and theirs (x 9..18)
const Z: Record<number, Pt> = { 4: [7.5, 1.5], 3: [7.5, 4.5], 2: [7.5, 7.5], 5: [3, 1.5], 6: [3, 4.5], 1: [3, 7.5] };
const T: Record<number, Pt> = { 2: [10.5, 1.5], 3: [10.5, 4.5], 4: [10.5, 7.5], 1: [15, 1.5], 6: [15, 4.5], 5: [15, 7.5] };

const SPECS: Record<string, Spec> = {
  serving: {
    title: "Serving deep to zones 1 and 5, and the seam between passers",
    us: [{ at: [-1.2, 6.8], label: "S", key: true }],
    zones: [1, 2, 3, 4, 5, 6].map((n) => ({ n, at: T[n], hot: n === 1 || n === 5 })),
    them: [{ at: [14.2, 1.8], label: "P" }, { at: [14.6, 4.5], label: "P" }, { at: [14.2, 7.2], label: "P" }],
    ball: [{ from: [-1.2, 6.8], to: [16.4, 1.2], bend: -1.6 }, { from: [-1.2, 6.8], to: [16.4, 7.6], bend: 1.2 }, { from: [-1.2, 6.8], to: [14.6, 3.1], bend: -0.4 }],
    notes: [{ at: [16.9, 0.5], text: "Zone 1", anchor: "end" }, { at: [16.9, 8.9], text: "Zone 5", anchor: "end" }, { at: [13.2, 3.1], text: "Seam", anchor: "end" }],
  },
  passing: {
    title: "Three-person receive: passers share the court, the pass goes to the setter's spot",
    them: [{ at: [19.2, 2.4], label: "S" }],
    us: [{ at: [4.2, 1.8], label: "P" }, { at: [3.4, 4.5], label: "P", key: true }, { at: [4.2, 7.2], label: "P" }, { at: [8.2, 5.4], label: "S" }],
    ball: [{ from: [19.2, 2.4], to: [3.7, 4.3], bend: 1.2 }, { from: [3.4, 4.5], to: [7.9, 5.3], bend: -1.6, label: "Pass" }],
    target: [8.0, 5.4],
    notes: [{ at: [8.0, 6.8], text: "Target", anchor: "middle" }],
  },
  setting: {
    title: "From the setter's spot: high outside, quick middle, back set to the right side",
    us: [{ at: [8.1, 5.4], label: "S", key: true }, { at: [6.2, 0.6], label: "OH" }, { at: [6.9, 4.4], label: "M" }, { at: [6.4, 8.6], label: "RS" }],
    ball: [{ from: [8.1, 5.4], to: [8.1, 0.9], bend: -2.2, label: "High" }, { from: [8.1, 5.4], to: [8.2, 4.2], bend: -0.6, label: "Quick" }, { from: [8.1, 5.4], to: [8.1, 8.4], bend: 1.4, label: "Back" }],
    run: [{ from: [6.2, 0.6], to: [8.0, 1.2] }, { from: [6.9, 4.4], to: [8.3, 4.4] }, { from: [6.4, 8.6], to: [8.0, 8.1] }],
  },
  hitting: {
    title: "An outside hitter's approach from outside the court, and three shots",
    us: [{ at: [8.2, 1.0], label: "OH", key: true }],
    run: [{ from: [4.6, -0.8], to: [8.0, 0.9], bend: 0.4 }],
    them: [{ at: [9.6, 1.1], label: "B" }, { at: [9.6, 2.0], label: "B" }],
    ball: [{ from: [8.6, 0.6], to: [17.2, 0.6], label: "Line" }, { from: [8.6, 1.2], to: [16.6, 7.6], label: "Cross" }, { from: [8.6, 1.5], to: [11.2, 4.0], bend: -0.8, label: "Tip" }],
    notes: [{ at: [4.4, -0.2], text: "Start outside", anchor: "end" }],
  },
  defense: {
    title: "Perimeter defense against their outside hitter, around a two-person block",
    them: [{ at: [10.0, 8.2], label: "H" }],
    us: [{ at: [8.6, 7.9], label: "B" }, { at: [8.6, 7.0], label: "B" }, { at: [6.2, 2.2], label: "LF" }, { at: [1.6, 1.6], label: "LB", key: true }, { at: [1.0, 5.0], label: "MB" }, { at: [2.2, 8.2], label: "RB" }],
    ball: [{ from: [10.0, 8.2], to: [2.0, 2.0], label: "Cross" }, { from: [10.0, 8.6], to: [2.6, 8.6], label: "Line" }, { from: [10.0, 8.0], to: [6.4, 3.2], bend: 0.5, label: "Tip / sharp" }],
    notes: [{ at: [6.2, 1.0], text: "Off-blocker pulls off", anchor: "middle" }],
  },
};

const S = 30, PAD = 2.2 * S; // pixels per meter, padding around the court
const px = ([x, y]: Pt): Pt => [PAD + x * S, PAD * 0.6 + y * S];
const curve = (a: Pt, b: Pt, bend = 0) => { const [x1, y1] = px(a), [x2, y2] = px(b), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1; const cx = mx - (dy / l) * bend * S, cy = my + (dx / l) * bend * S; return { d: `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`, mid: [(x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4] as Pt }; };

export function Diagram({ id, small }: { id: string; small?: boolean }) {
  const d = SPECS[id]; if (!d) return null;
  const W = 18 * S + PAD * 2, H = 9 * S + PAD * 1.2, mk = "ad-arrow-" + id + (small ? "-s" : "");
  return <figure className={"ad" + (small ? " small" : "")}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={d.title}>
      <defs>
        <marker id={mk} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="ad-ah" /></marker>
        <marker id={mk + "r"} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="ad-ahr" /></marker>
      </defs>
      <rect x={px([0, 0])[0]} y={px([0, 0])[1]} width={18 * S} height={9 * S} className="ad-court" />
      <rect x={px([0, 0])[0]} y={px([0, 0])[1]} width={9 * S} height={9 * S} className="ad-ours" />
      <line x1={px([6, 0])[0]} y1={px([6, 0])[1]} x2={px([6, 9])[0]} y2={px([6, 9])[1]} className="ad-line" />
      <line x1={px([12, 0])[0]} y1={px([12, 0])[1]} x2={px([12, 9])[0]} y2={px([12, 9])[1]} className="ad-line" />
      <line x1={px([9, -0.6])[0]} y1={px([9, -0.6])[1]} x2={px([9, 9.6])[0]} y2={px([9, 9.6])[1]} className="ad-net" />
      {d.shade && <polygon points={d.shade.map((p) => px(p).join(",")).join(" ")} className="ad-shade" />}
      {d.zones?.map((z) => { const [x, y] = px(z.at); return <g key={z.n}>{z.hot && <rect x={x - 2.1 * S} y={y - 1.35 * S} width={4.2 * S} height={2.7 * S} rx={4} className="ad-hot" />}<text x={x} y={y + 5} className={"ad-zone" + (z.hot ? " hot" : "")}>{z.n}</text></g>; })}
      {d.target && (() => { const [x, y] = px(d.target!); return <circle cx={x} cy={y} r={0.75 * S} className="ad-target" />; })()}
      {d.run?.map((r, i) => <path key={i} d={curve(r.from, r.to, r.bend).d} className="ad-run" markerEnd={`url(#${mk}r)`} />)}
      {d.ball?.map((b, i) => { const c = curve(b.from, b.to, b.bend); return <g key={i}><path d={c.d} className="ad-ball" markerEnd={`url(#${mk})`} />{b.label && !small && <text x={c.mid[0]} y={c.mid[1] - 7} className="ad-blabel">{b.label}</text>}</g>; })}
      {d.them?.map((p, i) => { const [x, y] = px(p.at); return <g key={i} className="ad-them"><circle cx={x} cy={y} r={0.55 * S} /><text x={x} y={y + 4.5}>{p.label}</text></g>; })}
      {d.us?.map((p, i) => { const [x, y] = px(p.at); return <g key={i} className={"ad-us" + (p.key ? " key" : "")}><circle cx={x} cy={y} r={0.6 * S} /><text x={x} y={y + 4.5}>{p.label}</text></g>; })}
      {!small && d.notes?.map((n, i) => { const [x, y] = px(n.at); return <text key={i} x={x} y={y} className="ad-note" textAnchor={n.anchor || "start"}>{n.text}</text>; })}
      {!small && <><text x={px([4.5, 9])[0]} y={px([4.5, 9])[1] + 22} className="ad-side">Your side</text><text x={px([13.5, 9])[0]} y={px([13.5, 9])[1] + 22} className="ad-side">Their side</text></>}
    </svg>
    {!small && <figcaption>{d.title}</figcaption>}
  </figure>;
}
