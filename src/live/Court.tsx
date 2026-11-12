/** Gamecast court, broadcast style: the whole court from above, our six in their spots on the left, the net in the middle,
 * the last play called out on top, and where the ball landed on the last few marked plays. */
import { LogEntry, SetState } from "../sports/volleyball/engine";
import { TeamLogo } from "../ui/Logo";
import { tr } from "../lib/i18n";
import { LPlayer, pname } from "./data";
import { liberoSpot } from "./OnCourt";
import { playText } from "./GameView";

// Court in meters: 18 long, 9 wide. Drawn sideways: our end on the left (H 0), net at H 9, theirs on the right.
// A stat's spot (x 0–9 across, y 0–18 with their side y < 9) maps to H = 18 − y, V = 9 − x (our right side at the bottom).
const S = 10, M = 14; // px per meter in the SVG, margin around the court
const H = (y: number) => M + (18 - y) * S, V = (x: number) => M + (9 - x) * S;
// our rotation spots: [position index] → meters from our end line (h) and from the top sideline (v)
const SPOT: Record<number, [number, number]> = { 0: [2.2, 7.2], 1: [6.6, 7.2], 2: [6.6, 4.5], 3: [6.6, 1.8], 4: [2.2, 1.8], 5: [2.2, 4.5] };

export function GameCourt({ c, P, log, team, them, follow, logos, live }: { c: SetState | null; P: Map<string, LPlayer>; log: LogEntry[]; team: string; them: string; follow: string; logos: { us?: string | null; them?: string | null }; live: boolean }) {
  const stats = log.filter((l): l is Extract<LogEntry, { kind: "stat" }> => l.kind === "stat");
  const setN = c?.n, inSet = stats.filter((l) => l.set === setN);
  const last = [...log].reverse().find((l) => l.kind === "stat" || l.kind === "to" || l.kind === "sub");
  const marks = inSet.filter((l) => l.x != null && l.y != null).slice(-6);
  const newest = marks[marks.length - 1];
  const li = c?.lu && c.lu.length === 6 ? liberoSpot(c.lu, c.lib, c.libSrv, (id) => P.get(id)?.pos) : null;
  const serving = !!c && c.serve === "us" && !c.over;
  const W = 18 * S + 2 * M, HT = 9 * S + 2 * M;
  const lastBy = last && last.kind === "stat" ? (/^O[KAE]$|^TP$/.test(last.t) ? "them" : "us") : last && last.kind === "to" ? last.v : "us";

  return <section className="lv-card lv-gc">
    {last && <div className={"lv-gc-last " + lastBy}>
      <TeamLogo src={lastBy === "them" ? logos.them : logos.us} name={lastBy === "them" ? them : team} size={26} />
      <div className="lv-gc-last-t"><small>{live ? tr("Last play") : tr("Final play")}</small><b>{playText(last, team, them, P)}</b></div>
      {last.kind === "stat" && last.w && <span className="lv-gc-last-sc"><span className={last.w === "us" ? "on" : ""}>{last.us}</span>–<span className={last.w === "them" ? "on" : ""}>{last.them}</span></span>}
    </div>}
    <div className="lv-gc-court">
      <svg viewBox={`0 0 ${W} ${HT}`} role="img" aria-label={tr("Court: {team} on the left, {them} on the right", { team, them })}>
        <rect x={M} y={M} width={9 * S} height={9 * S} className="lv-gc-us" />
        <rect x={M + 9 * S} y={M} width={9 * S} height={9 * S} className="lv-gc-them" />
        <rect x={M} y={M} width={18 * S} height={9 * S} className="lv-gc-line" fill="none" />
        <line x1={M + 6 * S} y1={M} x2={M + 6 * S} y2={M + 9 * S} className="lv-gc-3m" />
        <line x1={M + 12 * S} y1={M} x2={M + 12 * S} y2={M + 9 * S} className="lv-gc-3m" />
        <line x1={M + 9 * S} y1={M - 8} x2={M + 9 * S} y2={M + 9 * S + 8} className="lv-gc-net" />
        <text x={M + 4.5 * S} y={M + 9 * S + 10} className="lv-gc-wm" textAnchor="middle">{short(team)}</text>
        <text x={M + 13.5 * S} y={M + 9 * S + 10} className="lv-gc-wm" textAnchor="middle">{short(them)}</text>
        {marks.map((l) => { const isNew = l === newest;
          return <g key={l.id} transform={`translate(${H(l.y!)} ${V(l.x!)})`} className={"lv-gc-mark " + (l.w === "them" ? "them" : "us") + (isNew ? " new" : "")} opacity={isNew ? 1 : 0.45}>
            {isNew && <circle r={9} className="lv-gc-ping" />}<circle r={isNew ? 5 : 3.5} /><title>{playText(l, team, them, P)}</title></g>; })}
        {c?.lu && c.lu.length === 6 && !c.over && [0, 1, 2, 3, 4, 5].map((i) => {
          const id = li === i && c.lib ? c.lib : c.lu![i], p = P.get(id), [h, v] = SPOT[i], srv = serving && i === 0;
          const x = srv ? M - 2 : M + h * S, y = M + v * S;
          return <g key={i} transform={`translate(${x} ${y})`} className={"lv-gc-pl" + (id === follow && follow ? " mine" : "") + (li === i ? " lib" : "") + (srv ? " srv" : "")}>
            <circle r={9.5} /><text y={3.6} textAnchor="middle">{p?.num ?? "?"}</text>
            <title>{pname(p) + (li === i ? " (libero)" : "") + (srv ? " · " + tr("Serving") : "")}</title>
          </g>; })}
      </svg>
    </div>
    <div className="lv-gc-key">
      {c?.lu && !c.over && <span>{tr("Rotation {n}", { n: c.rot })}{serving ? " · " + tr("{team} serving", { team }) : c ? " · " + tr("{team} serving", { team: them }) : ""}</span>}
      {marks.length > 0 && <span><i className="dot us" /> {tr("{team} point", { team: short(team) })} <i className="dot them" /> {tr("{team} point", { team: short(them) })}</span>}
    </div>
  </section>;
}

/** Short name for tight spots: first word or two. */
function short(n: string) { const w = n.replace(/\s+(high school|hs|volleyball club|volleyball|vbc|club|academy)$/i, "").split(/\s+/); return (w[0].length <= 4 && w[1] ? w.slice(0, 2).join(" ") : w[0]).slice(0, 14).toUpperCase(); }
