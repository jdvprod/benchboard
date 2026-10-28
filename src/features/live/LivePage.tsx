/** Gamecast: big score, set boxes, momentum, play-by-play, leaders and team comparison. */
import { useState } from "react";
import { currentMatch, get, matchesOf, playerName, replayOf, team } from "../../data/store";
import { aggregate, momentum, runOf, serverOf, Stat } from "../../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtPct, ratio, serveErrors, teamMetrics } from "../../sports/volleyball/metrics";
import { Card, fmtDate } from "../../ui/kit";
import { MomentumChart } from "../../ui/charts";
import { logText } from "../track/Tracker";
import { sideNames } from "../../app/Scoreboard";
import { liveUrlFor, ShareLive } from "../../cloud/CloudCard";
import { qrSvg } from "../../lib/qr";
import { GameScore } from "../../ui/GameScore";

export function LivePage() {
  const t = team()!, cur = currentMatch();
  const games = matchesOf().filter((m) => m.kind === "match");
  const [pick, setPick] = useState<string>(""), [tv, setTv] = useState(false);
  const m = (pick && get("matches", pick)) || (cur && cur.kind === "match" ? cur : games[0]);
  if (!m) return <div className="page"><Card><p className="empty">No matches yet. Start one on the Track tab and it shows up here live.</p></Card></div>;
  const R = replayOf(m)!, c = R.cur, names = sideNames(m, t.name);
  const A = aggregate(R.sets), M = teamMetrics(A), live = m.status === "live" && !R.matchOver;
  const run = runOf(c), srv = c ? serverOf(c) : null;
  const plays = R.log.filter((l) => l.kind === "stat" || l.kind === "set" || l.kind === "to" || l.kind === "sub").slice(-60).reverse();
  const leader = (f: (s: Stat) => number, label: string) => { const top = Object.entries(A.ps).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? <div className="k" key={label}><div className="label">{label}</div><b style={{ fontFamily: "var(--display)", fontSize: 26 }}>{+top[1].toFixed(1)}</b><div className="small">{playerName(top[0], "full")}</div></div> : null; };
  const them = A.team, oppAces = them.OA, oppKills = them.OK;
  const cmp: [string, string, string][] = [
    ["Kills", String(A.T.K), String(oppKills)], ["Aces", String(A.T.SA), String(oppAces)], ["Blocks", String(blocks(A.T)), "—"],
    ["Errors given", String(M.freePoints.ours), String(M.freePoints.theirs)], ["Hitting %", fmtHit(M.hitting), "—"], ["Side-out %", fmtPct(M.sideOut), fmtPct(ratio(A.psc.n - A.psc.w, A.psc.n))], ["Pass average", fmtAvg(M.passAvg), "—"], ["Serve errors", String(serveErrors(A.T)), "—"],
  ];

  if (tv) {
    const close = () => { setTv(false); try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ } };
    const lastPlays = R.log.filter((l) => l.kind === "stat" && l.w).slice(-3).reverse();
    return <div className="tv" onClick={close} role="button" aria-label="Exit TV mode" tabIndex={0} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="tv-score">
        <div className="tv-side"><div className="tv-nm us">{names.us}</div><div className="tv-pts us">{c?.us ?? 0}</div><div className="tv-sets">Sets {R.wonUs}</div></div>
        <div className="tv-mid"><div>Set {c?.n ?? 1}</div>{live && c && <div className="tv-srv">{c.serve === "us" ? "◀ serving" : "serving ▶"}</div>}</div>
        <div className="tv-side"><div className="tv-nm them">{names.them}</div><div className="tv-pts them">{c?.them ?? 0}</div><div className="tv-sets">Sets {R.wonThem}</div></div>
      </div>
      <div className="tv-sets-row">{R.sets.map((s) => <span key={s.n}>Set {s.n}: <b>{s.us}–{s.them}</b></span>)}</div>
      <div className="tv-plays">{lastPlays.map((l) => <div key={l.id}>{logText(l, m, t.name)}</div>)}</div>
      {liveUrlFor(m.id) && <div className="tv-qr"><div dangerouslySetInnerHTML={{ __html: qrSvg(liveUrlFor(m.id)) }} /><span>Scan to follow live</span></div>}
      <div className="tv-hint">Tap anywhere to exit</div>
    </div>;
  }
  return <div className="page">
    <div className="row between">
      <div className="row"><span className="small muted">{fmtDate(m.date)}{m.event ? " · " + m.event : ""}{m.site ? " · " + m.site : ""}</span></div>
      <div className="row"><button className="btn sm" onClick={() => { setTv(true); try { document.documentElement.requestFullscreen?.(); } catch { /* ignore */ } }}>TV mode</button><ShareLive matchId={m.id} />
      <select className="input" style={{ width: "auto", maxWidth: 260 }} value={m.id} onChange={(e) => setPick(e.target.value)} aria-label="Match">{games.slice(0, 40).map((g) => <option key={g.id} value={g.id}>{fmtDate(g.date)} vs {g.opp}</option>)}</select></div>
    </div>
    <GameScore R={R} us={names.us} them={names.them} live={m.status === "live"} unit={m.scrim ? "Game" : "Set"} server={c && c.serve === "us" && srv ? playerName(srv) : undefined} />
    <div className="grid2" style={{ alignItems: "start" }}>
      <div className="stack">
        {c && c.rallies.length > 1 && <Card title={`Momentum · set ${c.n}`}><MomentumChart diffs={momentum(c)} labels={[names.us + " ahead", names.them + " ahead"]} /></Card>}
        <Card title="Leaders"><div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))" }}>
          {leader((s) => s.K, "Kills")}{leader((s) => s.SA, "Aces")}{leader((s) => s.D, "Digs")}{leader((s) => blocks(s), "Blocks")}{leader((s) => s.AST, "Assists")}
        </div></Card>
        <Card title="Team stats"><div className="tbl"><table>
          <thead><tr><th className="l" /><th style={{ color: "var(--us)" }}>{names.us}</th><th style={{ color: "var(--them)" }}>{names.them}</th></tr></thead>
          <tbody>{cmp.map(([l, a, b]) => <tr key={l}><td className="l">{l}</td><td>{a}</td><td>{b}</td></tr>)}</tbody></table></div></Card>
      </div>
      <Card title="Play by play" className="pbpcard">
        {plays.length ? <ul className="pbp">{plays.map((l) => {
          const score = l.kind === "stat" && l.w ? `${l.us}–${l.them}` : "";
          return <li key={l.id}><span className={"sc " + (l.kind === "stat" && l.w ? "pt-" + l.w : "")}>{score || (l.kind === "set" ? "Set " + l.set : "")}</span><span className={l.kind === "set" ? "small muted" : ""}>{logText(l, m, t.name)}</span></li>;
        })}</ul> : <p className="empty">Plays show up here as they're recorded.</p>}
      </Card>
    </div>
    <p className="small muted" style={{ textAlign: "center" }}>Put this screen on a TV or a second device for the bench and fans. It updates as plays are recorded.</p>
  </div>;
}
