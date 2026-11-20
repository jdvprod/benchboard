/** Rotation wheel: the six starters in serving order around a circle, with the court drawn over it (net and front
 * row on top, the serving spot at the lower right). Each step turns the wheel one rotation, the way players move on
 * the court, so a coach sees who's front row, who serves, where the setter is and what the libero does, and the
 * results for that rotation. Arrow keys step through; it respects reduced motion. */
import { useState } from "react";
import { player } from "../../data/store";
import { fmtPct, fmtSigned, ratio } from "../../sports/volleyball/metrics";
import { Card } from "../../ui/kit";
import "./wheel.css";

/** Where each court position sits on the wheel, in degrees clockwise from the top (the net). */
export const POS_ANGLE: Record<number, number> = { 3: 0, 2: 60, 1: 120, 6: 180, 5: 240, 4: 300 };
/** The court position (1–6) of starter k (0–5, serving order) in rotation r (1–6). Players move clockwise. Pure. */
export const posOf = (k: number, r: number) => ((((k - (r - 1)) % 6) + 6) % 6) + 1;
type RotStat = { w: number; l: number; rw: number; rn: number; sw: number; sn: number } | null;
/** libIn(r): the starter the libero replaces in rotation r (the lineup page's rule), or null. */
export function RotationWheel({ lu, lib, libSrv, rotStat, libIn }: { lu: string[]; lib: string | null; libSrv: string | null; rotStat: (r: number) => RotStat; libIn: (r: number) => string | null }) {
  const [r, setR] = useState(1);
  const full = lu.every(Boolean);
  if (!full) return null;
  const step = (n: number) => setR((x) => ((x - 1 + n + 6) % 6) + 1);
  const C = 150, RAD = 104, NODE = 30;
  const at = (deg: number, rad = RAD) => { const a = ((deg - 90) * Math.PI) / 180; return [C + rad * Math.cos(a), C + rad * Math.sin(a)]; };
  const swapId = libIn(r), swap = swapId ? lu.indexOf(swapId) : -1;
  const setterK = lu.findIndex((id) => player(id)?.pos === "S");
  const front = lu.map((id, k) => ({ id, k, p: posOf(k, r) })).filter((x) => [2, 3, 4].includes(x.p));
  const setterFront = setterK >= 0 && [2, 3, 4].includes(posOf(setterK, r));
  const hitters = front.filter((x) => x.k !== setterK).length;
  const server = lu.findIndex((_, k) => posOf(k, r) === 1);
  const st = rotStat(r), net = st ? st.w - st.l : null;
  const name = (id: string | null) => { const p = player(id); return p ? `#${p.num} ${p.first || p.last}` : "—"; };
  return <Card title="Rotation wheel" actions={<span className="small muted">Tap a number or use ← →</span>}>
    <div className="rw" onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}>
      <div className="rw-stage">
        <svg viewBox="0 0 300 300" className="rw-svg" role="img" aria-label={`Rotation ${r}: ${name(lu[server])} serves; front row ${front.map((x) => name(x.id)).join(", ")}`}>
          {/* the court: front row (net side) on top, back row below */}
          <path d={`M${C - 132},${C} A132,132 0 0 1 ${C + 132},${C} Z`} className="rw-front" />
          <path d={`M${C - 132},${C} A132,132 0 0 0 ${C + 132},${C} Z`} className="rw-back" />
          <line x1={C - 140} x2={C + 140} y1={C} y2={C} className="rw-split" />
          <line x1={C - 70} x2={C + 70} y1={8} y2={8} className="rw-net" />
          <text x={C} y={24} className="rw-lbl">NET</text>
          <text x={C} y={C - 10} className="rw-lbl dim">FRONT ROW</text>
          <text x={C} y={C + 20} className="rw-lbl dim">BACK ROW</text>
          {/* the serving spot */}
          {(() => { const [sx, sy] = at(120, RAD - 50); return <g className="rw-serve"><text x={sx} y={sy + 4} textAnchor="middle">SERVES ↘</text></g>; })()}
          {/* serving order arrows between seats */}
          {[0, 60, 120, 180, 240, 300].map((d) => { const [x1, y1] = at(d + 14, RAD), [x2, y2] = at(d + 46, RAD); return <path key={d} d={`M${x1},${y1} A${RAD},${RAD} 0 0 1 ${x2},${y2}`} className="rw-arc" markerEnd="url(#rw-arrow)" />; })}
          <defs><marker id="rw-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1,1 L7,4 L1,7" className="rw-arrowhead" /></marker></defs>
          {/* the players, turned to this rotation */}
          <g className="rw-ring" style={{ transform: `rotate(${(r - 1) * 60}deg)` }}>
            {lu.map((id, k) => {
              const base = POS_ANGLE[k + 1], [x, y] = at(base), p = player(id), isS = k === setterK, isL = k === swap, srv = posOf(k, r) === 1;
              return <g key={id} transform={`translate(${x},${y})`}>
                <g className="rw-up" style={{ transform: `rotate(${-(r - 1) * 60}deg)` }}>
                  <circle r={NODE} className={"rw-node" + (isS ? " setter" : "") + (srv ? " srv" : "") + (isL ? " lib" : "")} />
                  <text y={-3} className="rw-num">{isL ? player(lib)?.num ?? "L" : p?.num ?? "?"}</text>
                  <text y={13} className="rw-nm">{isL ? "Libero" : (p?.first || p?.last || "").slice(0, 9)}</text>
                  {p?.pos && !isL && <text y={-NODE - 6} className="rw-pos">{p.pos}</text>}
                </g>
              </g>; })}
          </g>
        </svg>
        <div className="rw-steps" role="group" aria-label="Rotation">
          <button className="rw-arrow" onClick={() => step(-1)} aria-label="Previous rotation">‹</button>
          {[1, 2, 3, 4, 5, 6].map((n) => <button key={n} aria-pressed={n === r} onClick={() => setR(n)}>{n}</button>)}
          <button className="rw-arrow" onClick={() => step(1)} aria-label="Next rotation">›</button>
        </div>
      </div>
      <div className="rw-info" aria-live="polite">
        <h3>Rotation {r}</h3>
        <dl>
          <div><dt>Serving</dt><dd>{name(swap === server && libSrv ? lib : lu[server])}</dd></div>
          <div><dt>Front row</dt><dd>{front.sort((a, b) => b.p - a.p).map((x) => name(x.id)).join(", ")}</dd></div>
          {setterK >= 0 && <div><dt>Setter</dt><dd>{setterFront ? `Front row: ${hitters} front-row hitters` : `Back row: ${hitters} front-row hitters`}</dd></div>}
          {lib && <div><dt>Libero</dt><dd>{swap >= 0 ? `In for ${name(lu[swap])}` : "Off the court"}</dd></div>}
          <div><dt>Results</dt><dd>{st && st.w + st.l ? <><b className={net! > 0 ? "up" : ""}>{fmtSigned(net!)}</b> points{st.rn ? ` · side-out ${fmtPct(ratio(st.rw, st.rn))}` : ""}{st.sn ? ` · scoring on serve ${fmtPct(ratio(st.sw, st.sn))}` : ""}</> : <span className="muted">No rallies in this rotation yet</span>}</dd></div>
        </dl>
        <p className="keys">The wheel turns clockwise one spot each time you side out, the same way players rotate on the court.</p>
      </div>
    </div>
  </Card>;
}
