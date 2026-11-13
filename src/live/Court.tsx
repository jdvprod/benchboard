/** Gamecast court, broadcast style: a maple gym floor seen from above with a painted court, the net and posts, our six in their
 * spots, the last play called out, its flight drawn from where it was played to where it landed, and a chart of every marked play. */
import { useMemo, useState } from "react";
import { LogEntry, rotateLineup, SetState } from "../sports/volleyball/engine";
import { Avatar, TeamLogo } from "../ui/Logo";
import { playName, tr } from "../lib/i18n";
import { LPlayer, pname } from "./data";
import { liberoSpot } from "./OnCourt";
import { playText } from "./GameView";

type Stat = Extract<LogEntry, { kind: "stat" }>;

// Everything is drawn in meters × S. The court is 18 × 9 with a free zone around it, drawn sideways: our end on the left.
// A stat's spot (x 0–9 across, y 0–18 with their side y < 9) maps to H = left edge + (18 − y), V = top edge + (9 − x),
// which puts our right side (zones 1 and 2) at the bottom, as it is for a player facing the net to the right.
const S = 20, FX = 2.6, FY = 1.7;
const W = (18 + 2 * FX) * S, HT = (9 + 2 * FY) * S;
const cx = (m: number) => (FX + m) * S, cy = (m: number) => (FY + m) * S; // meters from our end line / top sideline → px
const H = (y: number) => cx(18 - y), V = (x: number) => cy(9 - x);
// our rotation spots by lineup index (0 = P1): meters from our end line, meters from the top sideline
const SPOT: [number, number][] = [[2.3, 7.2], [7, 7.2], [7, 4.5], [7, 1.8], [2.3, 1.8], [2.3, 4.5]];

const THEIRS = /^(OK|OA|OE|TP)$/;
const ERRORS = /^(AE|AB|SE|SEN|SEO|BE|BHE|DE|P0|CE|EE|PE|OE)$/;
const sideOf = (l: Stat): "us" | "them" => (THEIRS.test(l.t) ? "them" : "us");

/** Seeded 0–1 random so the floor looks the same on every render. */
function rand(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/** The floor: maple planks (staggered joints, a few tones) as one pattern tile. */
function Planks() {
  const r = rand(7), plank = 0.3 * S, rows = 10, tile = 6 * S, tones = ["#E3B47A", "#DDAA6E", "#E8BD86", "#D9A468", "#E0B176", "#E6B880"];
  const out: any[] = [];
  for (let i = 0; i < rows; i++) {
    const y = i * plank, cut = Math.round(r() * tile);
    for (const [x0, x1] of [[cut - tile, cut], [cut, cut + tile]] as [number, number][]) {
      const a = Math.max(0, x0), b = Math.min(tile, x1); if (b <= a) continue;
      out.push(<rect key={i + "-" + x0} x={a} y={y} width={b - a} height={plank} fill={tones[Math.floor(r() * tones.length)]} />);
      if (x1 < tile && x1 > 0) out.push(<line key={i + "j" + x1} x1={x1} y1={y} x2={x1} y2={y + plank} stroke="#B5844D" strokeWidth={0.6} opacity={0.55} />);
    }
    out.push(<line key={"s" + i} x1={0} y1={y + plank} x2={tile} y2={y + plank} stroke="#B98A54" strokeWidth={0.5} opacity={0.5} />);
  }
  return <pattern id="fc-planks" width={tile} height={rows * plank} patternUnits="userSpaceOnUse">{out}</pattern>;
}

/** A volleyball, drawn small. */
function Ball({ r = 6 }: { r?: number }) {
  return <g className="fc-ball"><circle r={r} fill="#FDFBF4" stroke="#1E2A33" strokeWidth={0.9} />
    <path d={`M${-r} 0 Q 0 ${-r * 0.55} ${r} 0 M ${-r * 0.5} ${-r * 0.86} Q ${r * 0.15} 0 ${-r * 0.5} ${r * 0.86} M ${r * 0.5} ${-r * 0.86} Q ${-r * 0.15} 0 ${r * 0.5} ${r * 0.86}`} fill="none" stroke="#2B79B0" strokeWidth={0.9} />
  </g>;
}

/** Where a play started: the player's spot for our plays (the rotation they were in), their hitters or servers for theirs. */
function origin(l: Stat, c: SetState | null): [number, number] {
  const land: [number, number] = [l.x!, l.y!];
  if (/^(SA|SI|SE|SEN|SEO)$/.test(l.t)) return [1.6, 18.7]; // our server, behind our right back corner
  if (l.t === "OA" || /^P[0-3]$/.test(l.t)) return [7.4, -0.7]; // theirs, behind their right back corner
  if (sideOf(l) === "them" || l.t === "D" || l.t === "DE") return [Math.min(8, Math.max(1, 9 - land[0])), 7];
  if (c?.lu && l.p && l.rot) {
    const lu = rotateLineup(c.lu, (l.rot - c.rot + 6) % 6), i = lu.indexOf(l.p);
    if (i >= 0) { const [h, v] = SPOT[i]; return [9 - v, 18 - h]; }
  }
  return [4.5, 11];
}

type View = "last" | "set";
type Who = "both" | "us" | "them";

export function GameCourt({ c, P, log, team, them, follow, logos, live }: { c: SetState | null; P: Map<string, LPlayer>; log: LogEntry[]; team: string; them: string; follow: string; logos: { us?: string | null; them?: string | null }; live: boolean }) {
  const [view, setView] = useState<View>("last"), [who, setWho] = useState<Who>("both"), [pick, setPick] = useState<string>("");
  const reduce = useMemo(() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } }, []);
  const setN = c?.n;
  const last = [...log].reverse().find((l) => l.kind === "stat" || l.kind === "to" || l.kind === "sub");
  const placed = log.filter((l): l is Stat => l.kind === "stat" && l.set === setN && l.x != null && l.y != null);
  const shown = placed.filter((l) => who === "both" || sideOf(l) === who);
  const marks = view === "last" ? shown.slice(-1) : shown;
  const focus = (pick && marks.find((l) => l.id === pick)) || marks[marks.length - 1];
  const li = c?.lu && c.lu.length === 6 ? liberoSpot(c.lu, c.lib, c.libSrv, (id) => P.get(id)?.pos) : null;
  const serving = !!c && c.serve === "us" && !c.over;
  const lastStat = last && last.kind === "stat" ? last : null, lastSide = lastStat ? sideOf(lastStat) : last && last.kind === "to" ? last.v : "us";
  const lastP = lastStat?.p ? P.get(lastStat.p) : undefined;
  const isPoint = (l: Stat) => !!l.w, isErr = (l: Stat) => ERRORS.test(l.t);

  return <section className="lv-card lv-gc">
    {last && <div className={"lv-gc-last " + lastSide} aria-live="polite">
      {lastP ? <Avatar photo={lastP.photo} num={lastP.num} size={44} className="lv-gc-last-pic" /> : <TeamLogo src={lastSide === "them" ? logos.them : logos.us} name={lastSide === "them" ? them : team} size={40} />}
      <div className="lv-gc-last-t"><small>{live ? tr("Last play") : tr("Final play")}{setN ? " · " + tr("Set {n}", { n: setN }) : ""}</small>
        <b>{lastP ? <>{pname(lastP)} <span>{playName(lastStat!.t)}</span></> : playText(last, team, them, P)}</b>
        {lastStat?.z && lastStat.z !== "out" && <em>{tr("Landed in area {z}", { z: String(lastStat.z) })}</em>}</div>
      {lastStat?.w && <span className="lv-gc-last-sc"><span className={lastStat.w === "us" ? "on" : ""}>{lastStat.us}</span><i>–</i><span className={lastStat.w === "them" ? "on" : ""}>{lastStat.them}</span></span>}
    </div>}
    <div className="lv-gc-court">
      <svg viewBox={`0 0 ${W} ${HT}`} role="img" aria-label={tr("Court: {team} on the left, {them} on the right", { team, them })}>
        <defs>
          <Planks />
          <filter id="fc-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.75" numOctaves={2} seed={4} />
            <feColorMatrix values="0 0 0 0 0.32  0 0 0 0 0.18  0 0 0 0 0.06  0 0 0 0.9 -0.28" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          <filter id="fc-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx={0.6} dy={1.4} stdDeviation={1.3} floodColor="#000" floodOpacity={0.45} /></filter>
          <filter id="fc-blur"><feGaussianBlur stdDeviation={3} /></filter>
          <radialGradient id="fc-light" cx="50%" cy="45%" r="70%"><stop offset="0" stopColor="#fff" stopOpacity={0.1} /><stop offset="0.55" stopColor="#fff" stopOpacity={0} /><stop offset="1" stopColor="#000" stopOpacity={0.38} /></radialGradient>
          <linearGradient id="fc-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity={0} /><stop offset="0.48" stopColor="#fff" stopOpacity={0.09} /><stop offset="0.52" stopColor="#fff" stopOpacity={0.09} /><stop offset="1" stopColor="#fff" stopOpacity={0} /></linearGradient>
          <pattern id="fc-mesh" width={2.4} height={2.4} patternUnits="userSpaceOnUse"><path d="M0 0H2.4M0 0V2.4" stroke="#0E151B" strokeWidth={0.5} opacity={0.75} /></pattern>
          <clipPath id="fc-chip"><circle r={15} /></clipPath>
          <marker id="fc-arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#fff" /></marker>
        </defs>

        {/* floor */}
        <rect width={W} height={HT} fill="url(#fc-planks)" />
        <rect width={W} height={HT} filter="url(#fc-grain)" fill="#000" opacity={0.5} />
        {/* painted court: our half in our color, theirs in slate, the front zones a shade darker */}
        <rect x={cx(0)} y={cy(0)} width={9 * S} height={9 * S} className="fc-paint us" />
        <rect x={cx(9)} y={cy(0)} width={9 * S} height={9 * S} className="fc-paint them" />
        <rect x={cx(6)} y={cy(0)} width={6 * S} height={9 * S} fill="#000" opacity={0.09} />
        <rect x={cx(0)} y={cy(0)} width={18 * S} height={9 * S} filter="url(#fc-grain)" fill="#000" opacity={0.28} />
        {/* center-court logos and end-zone names */}
        <HalfMark x={cx(3.2)} y={cy(4.5)} src={logos.us} name={team} />
        <HalfMark x={cx(14.8)} y={cy(4.5)} src={logos.them} name={them} />
        <EndName x={cx(-1.25)} turn={-90} name={short(team)} side="us" />
        <EndName x={cx(19.25)} turn={90} name={short(them)} side="them" />

        {/* lines: boundary, center line, attack lines with their dashed extensions, service zone marks */}
        <g className="fc-lines">
          <rect x={cx(0)} y={cy(0)} width={18 * S} height={9 * S} fill="none" />
          <line x1={cx(9)} y1={cy(0)} x2={cx(9)} y2={cy(9)} />
          {[6, 12].map((m) => <line key={m} x1={cx(m)} y1={cy(0)} x2={cx(m)} y2={cy(9)} />)}
          {[6, 12].map((m) => [-1, 10].map((side) => [0, 1, 2, 3, 4].map((k) => { const y0 = side < 0 ? cy(-0.2 - k * 0.35) : cy(9.2 + k * 0.35); return <line key={m + "-" + side + "-" + k} x1={cx(m)} y1={y0} x2={cx(m)} y2={side < 0 ? y0 - 0.15 * S : y0 + 0.15 * S} />; })))}
          {[[-0.2, -0.35], [18.2, 18.35]].map(([a, b], i) => [0, 9].map((v) => <line key={i + "-" + v} x1={cx(a)} y1={cy(v)} x2={cx(b)} y2={cy(v)} />))}
        </g>

        {/* the net from above: shadow on the floor, posts, mesh, white tape, antennas */}
        <rect x={cx(9) + 4} y={cy(-1)} width={7} height={11 * S} fill="#000" opacity={0.32} filter="url(#fc-blur)" />
        <rect x={cx(9) - 3.5} y={cy(-1)} width={7} height={11 * S} fill="url(#fc-mesh)" />
        <rect x={cx(9) - 1.4} y={cy(-1)} width={2.8} height={11 * S} fill="#F7F7F2" />
        {[0, 9].map((v) => <g key={v}>{[0, 1, 2, 3].map((k) => <rect key={k} x={cx(9) - 1.2} y={cy(v) - 4.2 + k * 2.1} width={2.4} height={2.1} fill={k % 2 ? "#fff" : "#D7263D"} />)}</g>)}
        {[-1, 10].map((v) => <g key={v} filter="url(#fc-shadow)"><circle cx={cx(9)} cy={cy(v)} r={4.6} fill="#2A333B" /><circle cx={cx(9)} cy={cy(v)} r={2.4} fill="#59636C" /></g>)}

        {/* gym lights */}
        <rect width={W} height={HT} fill="url(#fc-light)" pointerEvents="none" />
        <rect width={W} height={HT} fill="url(#fc-sheen)" pointerEvents="none" />

        {/* our six (the chart view hides them so every play shows) */}
        {view === "last" && c?.lu && c.lu.length === 6 && !c.over && SPOT.map(([h, v], i) => {
          const id = li === i && c.lib ? c.lib : c.lu![i], p = P.get(id), srv = serving && i === 0;
          return <Chip key={i} x={srv ? cx(-0.9) : cx(h)} y={cy(v)} p={p} lib={li === i} srv={srv} mine={!!follow && id === follow} />;
        })}

        {/* the plays */}
        {marks.map((l) => <Mark key={l.id} l={l} on={l === focus} side={sideOf(l)} point={isPoint(l)} err={isErr(l)} select={() => setPick(l.id === pick ? "" : l.id)} label={playText(l, team, them, P)} />)}
        {focus && <Flight key={focus.id + view} l={focus} c={c} reduce={reduce} side={sideOf(focus)} />}
        {focus && <Callout l={focus} text={calloutText(focus, P, them)} side={sideOf(focus)} />}
        {focus && view === "last" && lastStat && focus.id !== lastStat.id && <g transform={`translate(${cx(0)} ${cy(-1.35)})`} className="fc-note"><rect width={112} height={16} rx={8} /><text x={56} y={8.5} textAnchor="middle" dominantBaseline="central">{tr("LAST MARKED PLAY")}</text></g>}
      </svg>
      {!placed.length && <p className="lv-gc-empty">{tr("Plays show here when the coach marks where the ball landed.")}</p>}
    </div>
    <div className="lv-gc-bar">
      <div className="lv-gc-seg" role="group" aria-label={tr("Show")}>
        {([["last", tr("Last play")], ["set", setN ? tr("Set {n} chart", { n: setN }) : tr("This set")]] as [View, string][]).map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => { setView(k); setPick(""); }}>{l}</button>)}
      </div>
      <div className="lv-gc-seg" role="group" aria-label={tr("Team")}>
        {([["both", tr("Both")], ["us", short(team)], ["them", short(them)]] as [Who, string][]).map(([k, l]) => <button key={k} aria-pressed={who === k} onClick={() => { setWho(k); setPick(""); }}>{l}</button>)}
      </div>
    </div>
    <div className="lv-gc-key">
      {c?.lu && !c.over ? <span><b>{tr("Rotation {n}", { n: c.rot })}</b> · {serving ? tr("{team} serving", { team }) : tr("{team} serving", { team: them })}</span> : <span />}
      <span className="lv-gc-legend">
        <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><circle r={4.5} className="fc-m-pt us" /></svg>{tr("Point")}
        <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><path d="M-4 -4L4 4M4 -4L-4 4" className="fc-m-x us" /></svg>{tr("Error")}
        <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><circle r={3.6} className="fc-m-ring us" /></svg>{tr("In play")}
      </span>
    </div>
  </section>;
}

/** A team name painted in the free zone behind an end line, sized to fit. */
function EndName({ x, turn, name, side }: { x: number; turn: number; name: string; side: "us" | "them" }) {
  const fit = Math.min(25, (8.6 * S) / Math.max(1, name.length * 0.92));
  return <text transform={`translate(${x} ${cy(4.5)}) rotate(${turn})`} className={"fc-endname " + side} style={{ fontSize: fit, letterSpacing: fit > 20 ? "0.24em" : "0.12em" }} textAnchor="middle" dominantBaseline="central">{name}</text>;
}

/** A team mark painted in the middle of its half: the logo, or big initials. */
function HalfMark({ x, y, src, name }: { x: number; y: number; src?: string | null; name: string }) {
  const r = 2.1 * S;
  return <g transform={`translate(${x} ${y})`} className="fc-halfmark">
    {src ? <image href={src} x={-r * 0.78} y={-r * 0.78} width={r * 1.56} height={r * 1.56} opacity={0.32} preserveAspectRatio="xMidYMid meet" />
      : null}
  </g>;
}

function Chip({ x, y, p, lib, srv, mine }: { x: number; y: number; p?: LPlayer; lib: boolean; srv: boolean; mine: boolean }) {
  return <g transform={`translate(${x} ${y})`} className={"fc-chip" + (lib ? " lib" : "") + (mine ? " mine" : "") + (srv ? " srv" : "")}>
    <title>{pname(p) + (lib ? " (libero)" : "") + (srv ? " · " + tr("Serving") : "")}</title>
    <g filter="url(#fc-shadow)"><circle r={16.5} className="fc-chip-ring" /></g>
    {p?.photo ? <image href={p.photo} x={-15} y={-15} width={30} height={30} clipPath="url(#fc-chip)" preserveAspectRatio="xMidYMid slice" />
      : <><circle r={15} className="fc-chip-jersey" /><text y={0.5} textAnchor="middle" dominantBaseline="central" className="fc-chip-num">{p?.num ?? "?"}</text></>}
    {p?.photo && <g transform="translate(11 -11)"><circle r={7} className="fc-chip-badge" /><text textAnchor="middle" dominantBaseline="central" className="fc-chip-badge-n">{p.num}</text></g>}
    {srv && <g transform="translate(-19 -14)"><Ball r={6} /></g>}
    {lib && <g transform="translate(-12 -12)"><circle r={6.5} className="fc-chip-badge lib" /><text textAnchor="middle" dominantBaseline="central" className="fc-chip-badge-n">L</text></g>}
  </g>;
}

function Mark({ l, on, side, point, err, select, label }: { l: Stat; on: boolean; side: "us" | "them"; point: boolean; err: boolean; select: () => void; label: string }) {
  const x = H(l.y!), y = V(l.x!), cls = (k: string) => k + " " + side;
  return <g transform={`translate(${x} ${y})`} className={"fc-mark" + (on ? " on" : "")} role="button" tabIndex={0} aria-label={label}
    onClick={select} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}>
    <circle r={12} fill="transparent" />
    {on && <circle r={on ? 10 : 0} className={cls("fc-ping")} />}
    {err ? <path d="M-5 -5L5 5M5 -5L-5 5" className={cls("fc-m-x")} /> : point ? <circle r={on ? 6.5 : 5} className={cls("fc-m-pt")} /> : <circle r={on ? 5.5 : 4.2} className={cls("fc-m-ring")} />}
  </g>;
}

/** The ball's flight for the play in focus: a curve from where it was played to where it landed, the ball riding it once. */
function Flight({ l, c, reduce, side }: { l: Stat; c: SetState | null; reduce: boolean; side: "us" | "them" }) {
  const [ox, oy] = origin(l, c), x0 = H(oy), y0 = V(ox), x1 = H(l.y!), y1 = V(l.x!);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, bend = Math.min(60, len * 0.28);
  // bow the flight toward the middle of the court so it never swings off the floor
  const nx = -dy / len, ny = dx / len, toward = (nx * (cx(9) - mx) + ny * (cy(4.5) - my)) >= 0 ? 1 : -1;
  const qx = mx + nx * bend * toward, qy = my + ny * bend * toward;
  const d = `M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}`;
  return <g className={"fc-flight " + side} pointerEvents="none">
    <path d={d} className="fc-flight-shadow" transform="translate(3 5)" />
    <path d={d} className={"fc-flight-path" + (reduce ? "" : " draw")} pathLength={1} markerEnd="url(#fc-arrow)" />
    {!reduce && <g><Ball r={5.5} /><animateMotion dur="0.9s" fill="freeze" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.3 0 0.4 1" /></g>}
  </g>;
}

function calloutText(l: Stat, P: Map<string, LPlayer>, them: string): [string, string] {
  const p = l.p ? P.get(l.p) : undefined;
  const who = p ? `#${p.num} ${(p.first || "").split(/\s+/)[0]}` : sideOf(l) === "them" ? (l.op ? `${them} #${l.op}` : them) : "";
  return [who, playName(l.t) + (l.z && l.z !== "out" ? " · " + tr("area {z}", { z: String(l.z) }) : l.z === "out" ? " · " + tr("out") : "")];
}

/** A label beside the play in focus, kept inside the court picture. */
function Callout({ l, text, side }: { l: Stat; text: [string, string]; side: "us" | "them" }) {
  const x = H(l.y!), y = V(l.x!), w = Math.max(text[0].length * 6.6, text[1].length * 5.6) + 18, h = text[0] ? 34 : 22;
  const left = x + 14 + w > W - 4 ? x - 14 - w : x + 14, top = Math.min(HT - h - 4, Math.max(4, y - h / 2));
  return <g className={"fc-callout " + side} pointerEvents="none" transform={`translate(${left} ${top})`}>
    <rect width={w} height={h} rx={6} filter="url(#fc-shadow)" />
    <rect width={4} height={h} rx={2} className="fc-callout-bar" />
    {text[0] && <text x={11} y={13} className="fc-callout-who">{text[0]}</text>}
    <text x={11} y={text[0] ? 26 : 14.5} className="fc-callout-what">{text[1]}</text>
  </g>;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
/** Short name for tight spots: first word or two. */
export function short(n: string) { const w = n.replace(/\s+(high school|hs|volleyball club|volleyball|vbc|club|academy)$/i, "").split(/\s+/); return (w[0].length <= 4 && w[1] ? w.slice(0, 2).join(" ") : w[0]).slice(0, 14).toUpperCase(); }
