/** Our half of the court from above, flat: the six as numbered circles. The net is at the top. */
import type { Peg } from "./Court3D";

export function Court2D({ pegs, label }: { pegs: Peg[]; label: string }) {
  const X = (x: number) => 20 + x * 40, Y = (y: number) => 30 + (9 - y) * 40; // 40 px per meter
  return <svg className="c2d" viewBox="0 0 400 470" role="img" aria-label={label}>
    <rect x={0} y={0} width={400} height={470} rx={12} className="c2d-floor" />
    <rect x={X(0)} y={Y(9)} width={360} height={360} className="c2d-court" />
    <rect x={X(0)} y={Y(9)} width={360} height={120} className="c2d-front" />
    <g className="c2d-lines"><rect x={X(0)} y={Y(9)} width={360} height={360} fill="none" /><line x1={X(0)} y1={Y(6)} x2={X(9)} y2={Y(6)} /></g>
    <line x1={X(-0.3)} y1={Y(9)} x2={X(9.3)} y2={Y(9)} className="c2d-net" />
    <text x={200} y={18} textAnchor="middle" className="c2d-cap">Net</text>
    {pegs.map((p, i) => <g key={i} transform={`translate(${X(p.x)} ${Y(p.y)})`} className={"c2d-p" + (p.lib ? " lib" : "") + (p.hl ? " hl" : "")}>
      <circle r={19} /><text textAnchor="middle" dominantBaseline="central" className="c2d-num">{p.num}</text>
      <text y={33} textAnchor="middle" className="c2d-name">{p.name.slice(0, 10)}</text>
    </g>)}
  </svg>;
}
