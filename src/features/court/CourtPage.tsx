/** Court: tendency court (where the ball lands → how to defend, where to hit and serve) and drawing boards. */
import { PointerEvent as RPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { boardOf, currentMatch, get, matchesOf, oppKey, opponentsOf, playerName, replayOf, save, team, teamPlayers, state } from "../../data/store";
import { Board, Stroke } from "../../data/model";
import { aggregate, Loc, zoneOf } from "../../sports/volleyball/engine";
import { ALL_ZONES, tendencies, TendencyView, VIEW_INFO } from "../../sports/volleyball/tendencies";
import { CourtSvg, ZONE_POS } from "../../ui/court";
import { Card, Seg } from "../../ui/kit";
import { setUi, ui } from "../../app/ui";
import { useRoute } from "../../app/router";
import { Playbook } from "./Playbook";

export function CourtPage() {
  const route = useRoute();
  return <div className="page">
    <div className="pagehead"><h1>Court</h1>
      <Seg value={ui.courtTab} onChange={(v) => setUi({ courtTab: v })} options={[["tendency", "Tendencies"], ["playbook", "Playbook"], ["boards", "Drawing boards"]]} label="Court section" />
    </div>
    {ui.courtTab === "tendency" ? <Tendency oppId={route.id} /> : ui.courtTab === "playbook" ? <Playbook /> : <Boards />}
  </div>;
}

/* ---------- tendency court ---------- */
const COLOR: Record<string, string> = { K: "var(--us)", SA: "var(--us)", D: "var(--good)", P3: "var(--good)", P2: "var(--muted)", P1: "var(--warn)", OK: "var(--them)", OA: "var(--them)", P0: "var(--them)", TA: "var(--muted)", SI: "var(--muted)" };
const LEGEND: Record<TendencyView, [string, string][]> = {
  theirAttack: [["var(--them)", "Their kill"], ["var(--good)", "Our dig"]],
  theirServe: [["var(--them)", "Ace / 0 pass"], ["var(--warn)", "1 pass"], ["var(--muted)", "2 pass"], ["var(--good)", "3 pass"]],
  ourAttack: [["var(--us)", "Our kill"], ["var(--muted)", "Kept in play"]],
  ourServe: [["var(--us)", "Ace"], ["var(--muted)", "In, returned"]],
};

function Tendency({ oppId }: { oppId?: string }) {
  const t = team()!, cur = currentMatch();
  const opps = opponentsOf();
  const [view, setView] = useState<TendencyView>("theirAttack");
  const [src, setSrc] = useState<string>(oppId ? "o:" + oppId : cur && cur.kind === "match" ? "current" : "season");
  const [who, setWho] = useState(""), [rot, setRot] = useState(0);
  useEffect(() => { if (oppId) setSrc("o:" + oppId); }, [oppId]);

  const games = matchesOf().filter((m) => m.kind === "match");
  let list = games;
  if (src === "season") list = games.filter((m) => !t.activeSeasonId || m.seasonId === t.activeSeasonId);
  else if (src === "current") list = cur ? [cur] : [];
  else if (src.startsWith("o:")) { const o = get("opponents", src.slice(2)); list = o ? games.filter((m) => oppKey(m.opp) === oppKey(o.name)) : []; }
  else if (src.startsWith("m:")) list = games.filter((m) => m.id === src.slice(2));
  const A = aggregate(list.flatMap((m) => replayOf(m)?.sets || []));
  const info = VIEW_INFO[view], theirs = view === "theirAttack" || view === "theirServe";
  const filter = { p: !theirs && who ? who : undefined, op: theirs && who ? who : undefined, rot: rot || undefined };
  const T = tendencies(A.locs, view, filter);
  const byZone: Record<string, number> = {}; for (const z of ALL_ZONES) byZone[z] = T.zones[z]?.total || 0;
  const whoOpts: [string, string][] = theirs
    ? Object.keys(A.opp).sort((a, b) => +a - +b).map((n) => [n, "#" + n])
    : teamPlayers().filter((p) => A.locs.some((l) => l.p === p.id)).map((p) => [p.id, `#${p.num} ${p.first}`]);
  const srcLabel = src === "current" ? "this match" : src === "season" ? "this season" : src.startsWith("o:") ? "vs " + (get("opponents", src.slice(2))?.name || "opponent") : "that match";

  return <div className="grid2" style={{ alignItems: "start" }}>
    <Card>
      <div className="stack">
        <Seg value={view} onChange={(v) => { setView(v); setWho(""); }} options={(Object.keys(VIEW_INFO) as TendencyView[]).map((k) => [k, VIEW_INFO[k].label])} label="What to show" />
        <div className="row">
          <select className="input" style={{ width: "auto", maxWidth: 220 }} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Matches">
            {cur && cur.kind === "match" && <option value="current">This match (live)</option>}
            <option value="season">This season</option>
            {opps.length > 0 && <optgroup label="Every match vs">{opps.map((o) => <option key={o.id} value={"o:" + o.id}>{o.name}</option>)}</optgroup>}
            <optgroup label="One match">{games.slice(0, 30).map((m) => <option key={m.id} value={"m:" + m.id}>{m.date} vs {m.opp}</option>)}</optgroup>
          </select>
          <select className="input" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Player">
            <option value="">{theirs ? "All their players" : "Whole team"}</option>{whoOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="input" style={{ width: "auto" }} value={rot} onChange={(e) => setRot(+e.target.value)} aria-label="Our rotation">
            <option value={0}>All rotations</option>{[1, 2, 3, 4, 5, 6].map((r) => <option key={r} value={r}>Our rotation {r}</option>)}
          </select>
        </div>
        <CourtSvg half={info.half} counts={{ half: info.half, byZone, total: T.total, heat: true }} dots={T.points.filter((l) => l.x != null).map((l) => ({ x: l.x, y: l.y, color: COLOR[l.t] || "var(--muted)", r: 0.24, opacity: 0.8, title: `${l.t}${l.p ? " · " + playerName(l.p) : ""}${l.op ? " · their #" + l.op : ""} · set ${l.set}, R${l.rot}` }))}
          labels={info.half === "us" ? { bottom: t.name } : { top: theirs ? "" : "Opponent" }} label={info.label + " on court"} />
        <div className="keys">{LEGEND[view].map(([c, l]) => <span key={l}><span className="sw" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: c, marginRight: 4 }} />{l}</span>)}<span>· Shaded = most common zones</span></div>
      </div>
    </Card>
    <div className="stack">
      <Card title="What to do about it">
        <p className="small muted" style={{ marginBottom: 8 }}>{info.help} {T.total} marked {srcLabel}{T.out ? `, ${T.out} out` : ""}.</p>
        <ul className="recs">{T.recs.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </Card>
      <Card title="By zone">
        <div className="tbl"><table>
          <thead><tr><th className="l">Zone</th><th>Total</th><th>Share</th><th>{view === "theirAttack" ? "Their kills" : view === "theirServe" ? "Aced / 0" : view === "ourAttack" ? "Our kills" : "Aces"}</th><th>{view === "theirAttack" ? "Our digs" : view === "theirServe" ? "3 passes" : "Returned"}</th></tr></thead>
          <tbody>{ALL_ZONES.map((z) => { const c = T.zones[z] || { total: 0, good: 0, bad: 0 }; const hit = theirs ? c.bad : c.good, other = theirs ? c.good : c.total - c.good;
            return <tr key={z}><td className="l">Zone {z}</td><td>{c.total}</td><td>{T.total ? Math.round((100 * c.total) / T.total) + "%" : "—"}</td><td><b>{hit}</b></td><td>{other}</td></tr>; })}</tbody>
        </table></div>
        <p className="keys" style={{ marginTop: 8 }}>Zones from the court diagram: 1 right back, 2 right front, 3 middle front, 4 left front, 5 left back, 6 middle back. Locations come from tapping the court after a play; turn that on in Settings.</p>
      </Card>
      <RotationDefense locs={A.locs} />
    </div>
  </div>;
}

/** Their kills split by our rotation: where to shift defense in each rotation. */
function RotationDefense({ locs }: { locs: Loc[] }) {
  const rows = [1, 2, 3, 4, 5, 6].map((r) => {
    const ks = locs.filter((l) => l.t === "OK" && l.rot === r && l.x != null), c: Record<string, number> = {};
    for (const l of ks) { const z = zoneOf(l.x, l.y); if (z && z !== "out") c[z] = (c[z] || 0) + 1; }
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return { r, n: ks.length, top };
  });
  if (!rows.some((x) => x.n)) return null;
  return <Card title="Their kills by our rotation">
    <div className="tbl"><table><thead><tr><th className="l">Rotation</th><th>Kills against</th><th className="l">Hot zone</th></tr></thead>
      <tbody>{rows.map((x) => <tr key={x.r}><td className="l">R{x.r}</td><td>{x.n}</td><td className="l">{x.top && x.n >= 2 ? `Zone ${x.top[0]} (${x.top[1]} of ${x.n})` : "—"}</td></tr>)}</tbody></table></div>
    <p className="keys" style={{ marginTop: 8 }}>Use this to adjust base defense rotation by rotation, not just for the whole match.</p>
  </Card>;
}

/* ---------- drawing boards ---------- */
type Tool = Stroke["tool"] | "erase";
const PENS: [string, string][] = [["ink", "Black"], ["us", "Team"], ["them", "Opponent"], ["warn", "Yellow"], ["good", "Green"]];
const cssv = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#333";
const penColor = (c: string) => (c.startsWith("#") || c.startsWith("rgb") ? c : cssv("--" + c));
const segDist = (p: number[], a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };

function Boards() {
  const t = team()!;
  const [name, setName] = useState<Board["name"]>("def");
  const [tool, setTool] = useState<Tool>("pen"), [color, setColor] = useState("us");
  const stored = get("boards", t.id + ":" + name);
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const scale = useRef(20), strokes = useRef<Stroke[]>(boardOf(name).strokes.slice()), hist = useRef<Record<string, string[]>>({});
  const drawing = useRef<null | { s: Stroke | null; erase: boolean }>(null);
  const [, force] = useState(0);
  useEffect(() => { strokes.current = boardOf(name).strokes.slice(); paint(); force((n) => n + 1); }, [name, stored]);

  const paint = () => {
    const c = cv.current; if (!c) return; const x = c.getContext("2d"); if (!x) return;
    const dpr = window.devicePixelRatio || 1, k = scale.current * dpr;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.setTransform(k, 0, 0, k, 1.5 * k, 1.5 * k);
    const ink = cssv("--ink"), muted = cssv("--muted");
    x.fillStyle = cssv("--surface-2"); x.fillRect(-1.5, -1.5, 12, 21); x.fillStyle = cssv("--them-soft"); x.fillRect(0, 0, 9, 9); x.fillStyle = cssv("--us-soft"); x.fillRect(0, 9, 9, 9);
    if (!t.settings.hideZones) {
      x.save(); x.setLineDash([0.25, 0.2]); x.strokeStyle = muted; x.globalAlpha = 0.55; x.lineWidth = 0.04; for (const v of [3, 6]) { x.beginPath(); x.moveTo(v, 0); x.lineTo(v, 18); x.stroke(); } x.restore();
      x.save(); x.globalAlpha = 0.25; x.fillStyle = ink; x.font = "700 1.5px 'Barlow Semi Condensed', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      for (const h of ["them", "us"] as const) for (const z in ZONE_POS[h]) x.fillText(z, ZONE_POS[h][z][0], ZONE_POS[h][z][1]); x.restore();
    }
    x.strokeStyle = ink; x.lineWidth = 0.07; x.strokeRect(0, 0, 9, 18); x.beginPath(); x.moveTo(0, 6); x.lineTo(9, 6); x.moveTo(0, 12); x.lineTo(9, 12); x.stroke();
    x.lineWidth = 0.16; x.beginPath(); x.moveTo(-0.6, 9); x.lineTo(9.6, 9); x.stroke();
    x.font = "600 .55px 'Barlow Semi Condensed', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = cssv("--them"); x.fillText("OPPONENT", 4.5, -0.75); x.fillStyle = cssv("--us"); x.fillText(t.name.toUpperCase(), 4.5, 18.75);
    for (const s of strokes.current) drawStroke(x, s);
  };
  const size = () => {
    const c = cv.current, b = box.current; if (!c || !b) return;
    const avail = b.clientWidth || 340, maxH = Math.max(420, window.innerHeight - 220);
    const wd = Math.max(240, Math.min(avail, (maxH * 12) / 21, 560)), ht = (wd * 21) / 12, dpr = window.devicePixelRatio || 1;
    scale.current = wd / 12; c.style.width = wd + "px"; c.style.height = ht + "px"; c.width = Math.round(wd * dpr); c.height = Math.round(ht * dpr); paint();
  };
  useLayoutEffect(() => { size(); const on = () => size(); window.addEventListener("resize", on); const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener?.("change", on); return () => { window.removeEventListener("resize", on); mq.removeEventListener?.("change", on); }; }, []);
  useEffect(() => { paint(); }, [state.prefs.theme, t.color, t.settings.hideZones]);

  const persist = () => save("boards", { ...boardOf(name), strokes: strokes.current.slice() });
  const pushHist = () => { const h = (hist.current[name] ||= []); h.push(JSON.stringify(strokes.current)); if (h.length > 60) h.shift(); };
  const toM = (e: RPointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [+((e.clientX - r.left) / scale.current - 1.5).toFixed(2), +((e.clientY - r.top) / scale.current - 1.5).toFixed(2)] as [number, number]; };
  const eraseAt = (pt: number[]) => {
    const keep = strokes.current.filter((s) => { const pad = s.tool === "hl" ? 0.55 : s.tool === "dot" ? 0.28 : 0.1, r = 0.4 + pad, p = s.pts; if (p.length === 1) return Math.hypot(pt[0] - p[0][0], pt[1] - p[0][1]) > r; for (let i = 1; i < p.length; i++) if (segDist(pt, p[i - 1], p[i]) < r) return false; return true; });
    if (keep.length !== strokes.current.length) { strokes.current = keep; return true; } return false;
  };
  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault(); try { cv.current!.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const pt = toM(e); pushHist();
    if (tool === "erase") { drawing.current = { s: null, erase: true }; eraseAt(pt); paint(); return; }
    if (tool === "dot") { strokes.current.push({ tool: "dot", color, pts: [pt] }); paint(); persist(); return; }
    const s: Stroke = { tool, color, pts: [pt] }; strokes.current.push(s); drawing.current = { s, erase: false }; paint();
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current; if (!d) return; e.preventDefault(); const pt = toM(e);
    if (d.erase) { if (eraseAt(pt)) paint(); return; }
    const s = d.s!; if (s.tool === "arrow") s.pts[1] = pt; else { const l = s.pts[s.pts.length - 1]; if (Math.hypot(pt[0] - l[0], pt[1] - l[1]) < 0.08) return; s.pts.push(pt); }
    paint();
  };
  const up = () => {
    const d = drawing.current; if (!d) return; drawing.current = null;
    if (d.s && d.s.tool === "arrow" && d.s.pts.length < 2) { strokes.current.pop(); hist.current[name]?.pop(); paint(); return; }
    persist();
  };
  const undo = () => { const h = hist.current[name]; if (!h?.length) return; strokes.current = JSON.parse(h.pop()!); paint(); persist(); };
  const clear = () => { pushHist(); strokes.current = []; paint(); persist(); };

  return <div className="grid2" style={{ alignItems: "start" }}>
    <Card>
      <div ref={box} style={{ width: "100%" }}>
        <canvas id="court" ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Drawing board" style={{ margin: "0 auto" }} />
      </div>
    </Card>
    <div className="stack">
      <Card title="Board">
        <div className="stack">
          <Seg value={name} onChange={setName} options={[["def", `Defense${boardOf("def").strokes.length ? " ·" + boardOf("def").strokes.length : ""}`], ["hit", `Attack${boardOf("hit").strokes.length ? " ·" + boardOf("hit").strokes.length : ""}`], ["serve", `Serve${boardOf("serve").strokes.length ? " ·" + boardOf("serve").strokes.length : ""}`]]} label="Board" />
          <div><div className="label">Tool</div><Seg value={tool} onChange={setTool} options={[["pen", "Pen"], ["arrow", "Arrow"], ["dot", "Player dot"], ["hl", "Highlight zone"], ["erase", "Eraser"]]} label="Tool" /></div>
          <div><div className="label">Color</div><div className="row" style={{ marginTop: 6 }}>{PENS.map(([c, l]) => <button key={c} className="swatch" style={{ background: penColor(c) }} aria-pressed={color === c} aria-label={l} title={l} onClick={() => { setColor(c); if (tool === "erase") setTool("pen"); }} />)}</div></div>
          <div className="row"><button className="btn" disabled={!hist.current[name]?.length} onClick={undo}>Undo</button><button className="btn" disabled={!strokes.current.length} onClick={clear}>Clear board</button></div>
          <p className="small muted">Three saved boards: defense, attack and serve. Draw a base defense, hitting targets or serve zones; it's saved automatically. Highlight shades a zone; Eraser wipes whatever you drag over.</p>
        </div>
      </Card>
    </div>
  </div>;
}

function drawStroke(x: CanvasRenderingContext2D, s: Stroke) {
  const c = penColor(s.color), p = s.pts; if (!p || !p.length) return;
  x.save(); x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = c; x.fillStyle = c;
  if (s.tool === "dot") { x.beginPath(); x.arc(p[0][0], p[0][1], 0.28, 0, 7); x.fill(); x.restore(); return; }
  if (s.tool === "hl") { x.globalAlpha = 0.32; x.lineWidth = 1.1; } else x.lineWidth = 0.13;
  x.beginPath(); x.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]); if (p.length === 1) x.lineTo(p[0][0] + 0.001, p[0][1]); x.stroke();
  if (s.tool === "arrow" && p.length > 1) { const a = p[0], b = p[p.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 0.6; x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)); x.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)); x.closePath(); x.fill(); }
  x.restore();
}
