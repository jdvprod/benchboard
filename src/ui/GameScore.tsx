/** ESPN-style scoreboard for the gamecast: one row per team (name, each set, current points), and a status line. */
import { Replay, runOf } from "../sports/volleyball/engine";

export function gameStatus(R: Replay, liveMatch: boolean, unit = "Set"): { text: string; live: boolean } {
  const c = R.cur;
  if (R.matchOver || !liveMatch) return { text: R.sets.length > 1 || R.matchOver ? "Final" : c && c.us + c.them ? "Final" : "Not started", live: false };
  if (!c) return { text: "Starting soon", live: true };
  if (c.over) return { text: `End of ${unit.toLowerCase()} ${c.n}`, live: true };
  return { text: `${unit} ${c.n}`, live: true };
}

export function GameScore({ R, us, them, live: liveMatch, server, unit = "Set", meta }: { R: Replay; us: string; them: string; live: boolean; server?: string; unit?: string; meta?: string }) {
  const c = R.cur, st = gameStatus(R, liveMatch, unit), over = R.matchOver || !liveMatch;
  const sets = R.sets.filter((s) => s.us + s.them > 0 || s === c);
  const serving = st.live && c && !c.over ? c.serve : null;
  const run = st.live && c && !c.over ? runOf(c) : { side: null, n: 0 };
  const srvText = serving ? (serving === "us" ? server || us : them) : "";
  const between = over || !!c?.over; // between sets or after the match the big number is sets won
  const row = (side: "us" | "them") => {
    const name = side === "us" ? us : them, big = between ? (side === "us" ? R.wonUs : R.wonThem) : c ? c[side] : 0;
    const won = over && (side === "us" ? R.wonUs > R.wonThem : R.wonThem > R.wonUs);
    return <div className={`gs-row ${side}${won ? " won" : ""}`}>
      <span className="gs-nm"><span className="gs-tn">{name}</span>{serving === side && <span className="gs-srv" title="Serving" aria-label="serving">●</span>}</span>
      <span className="gs-sets" aria-label={`${unit}s`}>{sets.map((s) => <span key={s.n} className={(s.winner === side ? "w" : "") + (s === c && !over && !c.over ? " cur" : "")}>{s === c && !over && !c.over ? "" : s[side]}</span>)}</span>
      <span className="gs-big" aria-label={between ? `${unit}s won` : "Points this set"}>{big}</span>
    </div>;
  };
  return <section className="gs" aria-label="Score">
    <div className="gs-top"><span className={"gs-status" + (st.live ? " live" : "")}>{st.live && <i aria-hidden="true" />}{st.live ? "Live · " : ""}{st.text}</span>
      <span className="gs-meta">{!between && sets.length > 1 ? `${unit}s ${R.wonUs}–${R.wonThem}` : ""}{meta ? (sets.length > 1 && !between ? " · " : "") + meta : ""}</span></div>
    <div className="gs-head" aria-hidden="true"><span />{<span className="gs-sets">{sets.map((s) => <span key={s.n}>{s.n}</span>)}</span>}<span className="gs-big-h">{between ? unit + "s" : "Pts"}</span></div>
    {row("us")}{row("them")}
    {(srvText || run.n >= 3) && <div className="gs-foot">{srvText && <span><span className="k">Serving</span> {srvText}</span>}{run.n >= 3 && <span className={"gs-run " + run.side}>{run.n}-0 run · {run.side === "us" ? us : them}</span>}</div>}
  </section>;
}

/** "2026-10-27" → "Tue, Oct 27" */
export function niceDate(iso: string): string {
  const d = new Date(iso + "T12:00:00"); return isNaN(+d) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
