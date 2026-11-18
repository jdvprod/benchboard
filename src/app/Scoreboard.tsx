import { currentMatch, playerName, replayOf, team } from "../data/store";
import { runOf, serverOf } from "../sports/volleyball/engine";
import { Ball } from "../ui/icons";
import { go } from "./router";
import { setUi } from "./ui";

export function sideNames(m: { scrim: any; opp: string }, teamName: string) {
  return m.scrim ? { us: m.scrim.a.name, them: m.scrim.b.name } : { us: teamName, them: m.opp };
}

export function Scoreboard() {
  const t = team(), m = currentMatch(), R = replayOf(m);
  if (!t || !m || !R || !R.cur) return null;
  const c = R.cur, names = sideNames(m, t.name), run = runOf(c), srv = serverOf(c);
  const dots = (n: number) => "●".repeat(Math.max(0, 2 - n)) + "○".repeat(Math.min(2, n));
  const fix = () => { setUi({ panel: "fix" }); go(m.kind === "match" ? "track" : "practice"); };
  const unit = m.scrim ? "Game" : "Set";
  return (
    <header className="board">
      <div className="score">
        <div className="side us"><div className="tname" title={names.us}><span className="tn">{names.us}</span>{c.serve === "us" && <Ball />}</div><button className="pts" onClick={fix} aria-label={`${names.us} ${c.us}. Tap to fix the score`}>{c.us}</button></div>
        <div className="mid"><div className="setno">{unit} {c.n}</div><div className="setswon"><span className="u">{R.wonUs}</span>–<span className="t">{R.wonThem}</span></div><div className="label">{m.kind === "match" ? "sets" : m.kind === "scrimmage" ? "scrimmage" : "practice"}</div></div>
        <div className="side them"><div className="tname">{c.serve === "them" && <Ball />}<span className="tn">{names.them}</span></div><button className="pts" onClick={fix} aria-label={`${names.them} ${c.them}. Tap to fix the score`}>{c.them}</button></div>
      </div>
      <div className="strip">
        {!m.scrim && <span className="chip"><span className="k">Rotation</span>{c.rot}</span>}
        {srv && <span className="chip"><span className="k">Server</span>{playerName(srv)}{srv === c.lib ? " · Libero" : ""}</span>}
        {!m.scrim && <span className="chip"><span className="k">Our TOs</span>{dots(c.to.us)}</span>}
        {!m.scrim && <span className="chip"><span className="k">Their TOs</span>{dots(c.to.them)}</span>}
        {!m.scrim && c.lu && <span className={"chip" + (t.settings.subLimit && c.subs >= t.settings.subLimit - 2 ? " warn" : "")}><span className="k">Subs</span>{c.subs}{t.settings.subLimit ? "/" + t.settings.subLimit : ""}</span>}
        {run.n >= 2 && <span className={"chip run-" + run.side}><span className="k">Run</span>{run.side === "us" ? names.us : names.them} {run.n}–0</span>}
        <a className="chip" href="#/live" style={{ textDecoration: "none" }}><span className="k">Live view</span>›</a>
      </div>
    </header>
  );
}
