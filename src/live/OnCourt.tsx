/** Gamecast: who's on the court right now, in their rotation spots (front row at the net), with photos.
 * The libero shows in the back-row spot of the middle they replace; the server is marked when we're serving. */
import { SetState } from "../sports/volleyball/engine";
import { Avatar } from "../ui/Logo";
import { tr } from "../lib/i18n";
import { LPlayer } from "./data";

/** Which spot (0–5) the libero is playing: the back-row middle blocker's, else none. */
export function liberoSpot(lu: string[], lib: string | null, libSrv: string | null, pos: (id: string) => string | undefined): number | null {
  if (!lib) return null;
  for (const i of [4, 5, 0]) if (pos(lu[i]) === "MB") return i === 0 && libSrv !== lu[0] ? null : i;
  return libSrv && lu[0] === libSrv ? 0 : null;
}

export function OnCourt({ c, P, follow, team }: { c: SetState; P: Map<string, LPlayer>; follow: string; team: string }) {
  if (!c.lu || c.lu.length !== 6) return null;
  const li = liberoSpot(c.lu, c.lib, c.libSrv, (id) => P.get(id)?.pos), serving = c.serve === "us" && !c.over;
  // spots on the court: front row P4 P3 P2 (left to right), back row P5 P6 P1
  const order = [3, 2, 1, 4, 5, 0];
  const spot = (i: number) => {
    const id = li === i && c.lib ? c.lib : c.lu![i], p = P.get(id), isLib = li === i && !!c.lib;
    return <li key={i} className={"lv-spot" + (id === follow && follow ? " mine" : "") + (serving && i === 0 ? " srv" : "")}>
      <span className="lv-spot-pic"><Avatar photo={p?.photo} num={p?.num || "?"} size={46} />{isLib && <i className="lv-spot-tag">L</i>}{serving && i === 0 && <i className="lv-spot-tag srv" aria-label={tr("Serving")}>●</i>}</span>
      <b>{p ? (p.first ? `#${p.num} ${p.first}` : `#${p.num}`) : "—"}</b>
    </li>;
  };
  return <section className="lv-card"><div className="lv-h"><h2>{tr("On the court")}</h2><span className="lv-fresh">{tr("Rotation {n}", { n: c.rot })}{serving ? " · " + tr("{team} serving", { team }) : ""}</span></div>
    <div className="lv-court" aria-label={tr("On the court")}><span className="lv-net" aria-hidden="true">{tr("Net")}</span><ul>{order.map(spot)}</ul></div>
  </section>;
}
