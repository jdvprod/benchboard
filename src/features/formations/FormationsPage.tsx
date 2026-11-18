/** Formations: drag players into serve-receive, serving and base-defense spots for each rotation, with an overlap check. */
import { LineupTabs } from "../lineup/LineupTabs";
import { KeyboardEvent, PointerEvent as RPointerEvent, useRef, useState } from "react";
import { player, playerName, setTeamPatch, team, toast, uid } from "../../data/store";
import { rotateLineup } from "../../sports/volleyball/engine";
import { clampSpot, defaultFormations, defaultSpots, Formations, overlapFaults, Phase, PHASES, Spot, Spots } from "../../sports/volleyball/formations";
import { Card, ConfirmButton, Seg } from "../../ui/kit";
import { liberoFor } from "../lineup/LineupPage";
import { go } from "../../app/router";

const KEYS = ["1", "2", "3", "4", "5", "6"];
const VB = { x: -1.5, y: 7.8, w: 12, h: 12.4 };

interface Token { key: string; id: string | null; lib: boolean }
/** Who stands in each court position for rotation r (1-6), with the libero swapped in. */
function tokensFor(r: number): Token[] {
  const t = team()!, L = t.defLineup;
  if (!L || L.lu.length !== 6) return [];
  const lu = rotateLineup(L.lu, r - 1), li = liberoFor(lu, L.lib, L.libSrv);
  return KEYS.map((k, i) => ({ key: k, id: li === i ? L.lib : lu[i], lib: li === i }));
}

export function FormationsPage() {
  const t = team()!;
  const [phase, setPhase] = useState<Phase>("receive");
  const [rot, setRot] = useState(1);
  const [moves, setMoves] = useState(true);
  const [drag, setDrag] = useState<null | { key: string; spots: Spots }>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const F: Formations = t.formations || defaultFormations();
  const saved = F[phase][rot - 1] || defaultSpots(phase);
  const spots = drag ? drag.spots : saved;
  const tokens = tokensFor(rot);

  if (!t.defLineup || t.defLineup.lu.length !== 6) return <div className="page">
    <div className="lu-tabs"><LineupTabs here="formations" /></div>
    <div className="pagehead"><h1>Formations</h1></div>
    <Card><p>Set your starting six on the Lineup tab first. Formations follow that lineup through all six rotations.</p><button className="btn primary" style={{ marginTop: 10 }} onClick={() => go("lineup")}>Go to Lineup</button></Card>
  </div>;

  const commit = (next: Spots, r = rot, ph = phase) => {
    const f: Formations = JSON.parse(JSON.stringify(F));
    f[ph][r - 1] = next; setTeamPatch({ formations: f });
  };
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const el = svg.current!, pt = el.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse()); return clampSpot(p.x, p.y);
  };
  const down = (key: string) => (e: RPointerEvent) => { e.preventDefault(); setSel(key); try { svg.current!.setPointerCapture(e.pointerId); } catch { /* ignore */ } setDrag({ key, spots: { ...saved } }); };
  const move = (e: RPointerEvent) => { if (!drag) return; e.preventDefault(); setDrag({ ...drag, spots: { ...drag.spots, [drag.key]: toSvg(e) } }); };
  const up = () => { if (!drag) return; commit(drag.spots); setDrag(null); };
  const nudge = (key: string) => (e: KeyboardEvent) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, -0.25], ArrowDown: [0, 0.25] };
    const v = d[e.key]; if (!v) return; e.preventDefault();
    const s = saved[key]; commit({ ...saved, [key]: clampSpot(s[0] + v[0], s[1] + v[1]) });
  };

  const faults = overlapFaults(spots, phase), bad = new Set(faults.flatMap((f) => [f.a, f.b]));
  const base = F.base[rot - 1] || defaultSpots("base");
  const faultRots = [1, 2, 3, 4, 5, 6].filter((r) => phase !== "base" && overlapFaults(F[phase][r - 1] || defaultSpots(phase), phase).length);
  const presets = t.formationPresets || [];

  return <div className="page">
    <div className="lu-tabs"><LineupTabs here="formations" /></div>
    <div className="pagehead"><h1>Formations</h1>
      <Seg value={phase} onChange={setPhase} options={PHASES} label="Phase" />
    </div>
    <div className="grid2" style={{ alignItems: "start" }}>
      <Card>
        <div className="stack">
          <Seg value={rot} onChange={setRot} options={[1, 2, 3, 4, 5, 6].map((r) => [r, (faultRots.includes(r) ? "⚠ " : "") + "R" + r] as [number, string])} label="Rotation" />
          <svg ref={svg} className="formsvg" viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="img" aria-label={`Rotation ${rot} ${phase} formation`}>
            <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="var(--surface-2)" />
            <rect x={0} y={9} width={9} height={9} fill="var(--us-soft)" />
            <rect x={0} y={VB.y} width={9} height={9 - VB.y} fill="var(--them-soft)" opacity={0.6} />
            {[3, 6].map((x) => <line key={x} x1={x} y1={9} x2={x} y2={18} stroke="var(--muted)" strokeWidth={0.03} strokeDasharray=".2 .2" opacity={0.5} />)}
            <line x1={0} y1={12} x2={9} y2={12} stroke="var(--ink)" strokeWidth={0.06} />
            <rect x={0} y={9} width={9} height={9} fill="none" stroke="var(--ink)" strokeWidth={0.07} />
            <line x1={-0.6} y1={9} x2={9.6} y2={9} stroke="var(--ink)" strokeWidth={0.18} />
            <text x={9.75} y={8.75} fontSize={0.38} fill="var(--muted)">NET</text>
            <text x={4.5} y={19.4} textAnchor="middle" fontSize={0.34} fill="var(--muted)" letterSpacing=".05">SERVE ZONE</text>
            {moves && phase !== "base" && tokens.map((tk) => { const a = spots[tk.key], b = base[tk.key]; if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.4) return null;
              return <g key={"m" + tk.key} opacity={0.55}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--muted)" strokeWidth={0.06} strokeDasharray=".18 .14" markerEnd="url(#arr)" /><circle cx={b[0]} cy={b[1]} r={0.5} fill="none" stroke="var(--muted)" strokeWidth={0.05} strokeDasharray=".15 .12" /></g>; })}
            <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--muted)" /></marker></defs>
            {tokens.map((tk) => { const s = spots[tk.key] || [4.5, 13]; const p = player(tk.id), f = bad.has(tk.key), server = phase === "serve" && tk.key === "1";
              return <g key={tk.key} className="ftoken" transform={`translate(${s[0]} ${s[1]})`} onPointerDown={down(tk.key)} onKeyDown={nudge(tk.key)} tabIndex={0} role="button" aria-label={`${playerName(tk.id, "full")}, position ${tk.key}. Drag or use arrow keys to move.`} style={{ cursor: "grab", touchAction: "none" }}>
                <circle r={0.66} fill={f ? "var(--bad)" : tk.lib ? "var(--surface)" : server ? "var(--accent)" : "var(--bar)"} stroke={sel === tk.key ? "var(--accent)" : f ? "var(--bad)" : "var(--us)"} strokeWidth={tk.lib ? 0.1 : 0.07} strokeDasharray={tk.lib ? ".2 .12" : undefined} />
                <text y={0.2} textAnchor="middle" fontSize={0.6} fontWeight={700} fontFamily="var(--display)" fill={tk.lib ? "var(--ink)" : f ? "#fff" : server ? "var(--accent-ink)" : "var(--bar-ink)"}>{p?.num ?? "?"}</text>
                <text y={1.12} textAnchor="middle" fontSize={0.36} fontWeight={600} fill="var(--ink)">{(p?.first || p?.last || "") + (p ? " · " + (tk.lib ? "L" : p.pos) : "")}</text>
                <text x={-0.62} y={-0.5} fontSize={0.3} fontWeight={800} fill="var(--muted)">P{tk.key}</text>
              </g>; })}
          </svg>
          <div className="row between">
            <span className="small muted">Drag players, or tap one and use the arrow keys. Saved as you go.</span>
            {phase !== "base" && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={moves} onChange={(e) => setMoves(e.target.checked)} /> Show where they move after the serve</label>}
          </div>
        </div>
      </Card>
      <div className="stack">
        <Card title={phase === "base" ? "Base defense" : "Legal at the serve?"}>
          {phase === "base" ? <p className="small muted">Overlap rules only apply at the moment of the serve. Base defense is where each player goes once the ball is in play.</p>
            : faults.length ? <ul className="flags">{faults.map((f, i) => <li key={i} className="flag bad"><span><b>Overlap:</b> {f.text}</span></li>)}</ul>
              : <p className="hint">✓ Legal. No overlaps in rotation {rot}.</p>}
          {faultRots.length > 0 && phase !== "base" && <p className="small" style={{ marginTop: 8 }}>Rotations with overlaps: {faultRots.map((r) => "R" + r).join(", ")}</p>}
          <p className="keys" style={{ marginTop: 8 }}>Rule: each front-row player must be closer to the net than the back-row player behind them, and players in a row keep their left-to-right order. {phase === "serve" ? "The server is exempt." : ""} The libero takes the spot of the player she replaces.</p>
        </Card>
        <Card title="Tools">
          <div className="stack">
            <div className="row">
              <button className="btn sm" onClick={() => commit(defaultSpots(phase))}>Reset R{rot}</button>
              <ConfirmButton confirmText="Tap again: copy to R1–R6" onConfirm={() => { const f: Formations = JSON.parse(JSON.stringify(F)); f[phase] = f[phase].map(() => ({ ...saved })); setTeamPatch({ formations: f }); toast("Copied to all rotations"); }}>Use this shape in every rotation</ConfirmButton>
              {phase !== "base" && <button className="btn sm" onClick={() => { commit({ ...spots }, rot, "base"); toast("Saved as base defense too"); }}>Also use for base defense</button>}
            </div>
            <div className="label">Saved sets</div>
            <div className="row">
              <input className="input" style={{ maxWidth: 220 }} value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="e.g. 5-1 three-passer" aria-label="Preset name" />
              <button className="btn sm primary" disabled={!presetName.trim()} onClick={() => { setTeamPatch({ formationPresets: presets.concat({ id: uid("fp"), name: presetName.trim(), f: F }) }); setPresetName(""); toast("Saved"); }}>Save all formations</button>
            </div>
            {presets.length ? <ul className="log">{presets.map((p) => <li key={p.id} style={{ gridTemplateColumns: "1fr auto" }}><span>{p.name}</span><span className="row" style={{ flexWrap: "nowrap" }}>
              <button className="btn sm" onClick={() => { setTeamPatch({ formations: JSON.parse(JSON.stringify(p.f)) }); toast(`Loaded "${p.name}"`); }}>Load</button>
              <ConfirmButton className="btn sm ghost" confirmText="Delete?" onConfirm={() => setTeamPatch({ formationPresets: presets.filter((x) => x.id !== p.id) })}>✕</ConfirmButton></span></li>)}</ul>
              : <p className="small muted">Save your whole set of formations (all rotations, all three phases) under a name, like a 5-1 vs a 6-2, or a three-passer vs a four-passer system.</p>}
          </div>
        </Card>
      </div>
    </div>
    <Card title={`All rotations · ${PHASES.find((p) => p[0] === phase)![1]}`}>
      <div className="rots minis">{[1, 2, 3, 4, 5, 6].map((r) => { const sp = F[phase][r - 1] || defaultSpots(phase), tk = tokensFor(r), fl = new Set(overlapFaults(sp, phase).flatMap((f) => [f.a, f.b]));
        return <button key={r} className={"rotcard" + (r === rot ? " sel" : "")} onClick={() => setRot(r)} style={{ textAlign: "left" }}>
          <div className="hd"><span>Rotation {r}</span>{fl.size ? <span style={{ color: "var(--bad)" }}>Overlap</span> : phase !== "base" ? <span style={{ color: "var(--good)" }}>Legal</span> : null}</div>
          <svg viewBox={`${VB.x} 8.6 ${VB.w} 11`} style={{ width: "100%", display: "block" }} aria-hidden="true">
            <rect x={0} y={9} width={9} height={9} fill="var(--us-soft)" stroke="var(--ink)" strokeWidth={0.07} /><line x1={0} y1={12} x2={9} y2={12} stroke="var(--ink)" strokeWidth={0.05} /><line x1={-0.5} y1={9} x2={9.5} y2={9} stroke="var(--ink)" strokeWidth={0.18} />
            {tk.map((x) => { const s = sp[x.key]; return <g key={x.key} transform={`translate(${s[0]} ${s[1]})`}><circle r={0.75} fill={fl.has(x.key) ? "var(--bad)" : x.lib ? "var(--surface)" : "var(--bar)"} stroke="var(--us)" strokeWidth={0.08} strokeDasharray={x.lib ? ".2 .12" : undefined} /><text y={0.28} textAnchor="middle" fontSize={0.8} fontWeight={700} fontFamily="var(--display)" fill={x.lib ? "var(--ink)" : "var(--bar-ink)"}>{player(x.id)?.num ?? "?"}</text></g>; })}
          </svg>
        </button>; })}</div>
      <p className="keys" style={{ marginTop: 8 }}>Follows your starting lineup from the Lineup tab ({t.defLineup.lu.map((id) => playerName(id)).join(", ")}). Change the lineup there and these update.</p>
    </Card>
  </div>;
}
