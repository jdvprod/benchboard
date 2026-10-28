/** One game on Benchboard Live: scoreboard, then Gamecast · Box score · Play-by-play · Team stats. */
import { useState } from "react";
import { aggregate, LogEntry, momentum, serverOf, Stat } from "../sports/volleyball/engine";
import { ACTIONS } from "../sports/volleyball/actions";
import { blocks, fmtAvg, fmtHit, fmtPct, hitting, passAvg, ratio, serveErrors, serves, teamMetrics } from "../sports/volleyball/metrics";
import { MomentumChart } from "../ui/charts";
import { GameScore } from "../ui/GameScore";
import { fmtDay, Game, isLive, LPlayer, pname } from "./data";

type Tab = "cast" | "box" | "pbp" | "team";
const TABS: [Tab, string][] = [["cast", "Gamecast"], ["box", "Box score"], ["pbp", "Play-by-play"], ["team", "Team stats"]];

export function GameView({ g, team, players, fresh, back }: { g: Game; team: string; players: LPlayer[]; fresh?: string; back?: { href: string; label: string } }) {
  const { m, R } = g, c = R.cur, live = isLive(g), them = m.opp || "Opponent";
  const P = new Map(players.map((p) => [p.id, p]));
  const [tab, setTab] = useState<Tab>("cast");
  const fkey = "bbl-follow-" + m.id;
  const [follow, setF] = useState<string>(() => { try { return localStorage.getItem(fkey) || ""; } catch { return ""; } });
  const setFollow = (id: string) => { setF(id); try { if (id) localStorage.setItem(fkey, id); else localStorage.removeItem(fkey); } catch { /* private mode */ } };
  const srv = c ? serverOf(c) : null;
  return <div className="lv-game">
    {back && <a className="lv-back" href={back.href}>‹ {back.label}</a>}
    <GameScore R={R} us={team} them={them} live={m.status === "live"} server={c && c.serve === "us" && srv ? pname(P.get(srv), false) || undefined : undefined} meta={live ? fresh : undefined} />
    <p className="lv-when">{fmtDay(m.date)}{m.site === "away" ? " · Away" : m.site === "home" ? " · Home" : ""}{m.event ? " · " + m.event : ""}</p>
    <nav className="lv-tabs" aria-label="Game sections">{TABS.map(([k, l]) => <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{l}</button>)}</nav>
    {tab === "cast" && <Gamecast g={g} team={team} P={P} follow={follow} setFollow={setFollow} players={players} />}
    {tab === "box" && <BoxScore g={g} team={team} P={P} follow={follow} />}
    {tab === "pbp" && <PlayByPlay g={g} team={team} P={P} follow={follow} />}
    {tab === "team" && <TeamStats g={g} team={team} />}
  </div>;
}

/** Plain-language line for one play. */
export function playText(l: LogEntry, team: string, them: string, P: Map<string, LPlayer>): string {
  const nm = (id?: string | null) => pname(id ? P.get(id) : null, false);
  if (l.kind === "set") return `Set ${l.set} · ${l.serve === "us" ? team : them} serves first`;
  if (l.kind === "to") return `Timeout ${l.v === "us" ? team : them}`;
  if (l.kind === "sub") return `Sub: ${nm(l.in) || "player"} in for ${nm(l.out) || "player"}`;
  if (l.kind !== "stat") return "";
  const a: any = ACTIONS[l.t]; let s = (l.p && nm(l.p) ? nm(l.p) + " · " : "") + (a?.long || l.t);
  if (l.op) s += ` (their #${l.op})`;
  return s.replace(/^Opponent /, them + " ").replace(/^Their /, them + " ");
}

function Gamecast({ g, team, P, follow, setFollow, players }: { g: Game; team: string; P: Map<string, LPlayer>; follow: string; setFollow: (id: string) => void; players: LPlayer[] }) {
  const { m, R } = g, c = R.cur, A = aggregate(R.sets), them = m.opp || "Opponent";
  const points = R.log.filter((l) => l.kind === "stat" && l.w).slice(-6).reverse();
  const fp = follow ? P.get(follow) : undefined, fs: Stat | undefined = fp ? A.ps[follow] : undefined;
  const leader = (f: (s: Stat) => number, label: string) => { const top = Object.entries(A.ps).filter(([id]) => P.has(id)).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? <div className="lv-lead" key={label}><span>{label}</span><b>{+top[1].toFixed(1)}</b><small>{pname(P.get(top[0]))}</small></div> : null; };
  const leaders = [leader((s) => s.K, "Kills"), leader((s) => s.SA, "Aces"), leader((s) => s.D, "Digs"), leader((s) => blocks(s), "Blocks"), leader((s) => s.AST, "Assists")].filter(Boolean);
  return <>
    <section className="lv-card">
      <div className="lv-h"><h2>Follow a player</h2>
        <select className="input" value={follow} onChange={(e) => setFollow(e.target.value)} aria-label="Follow a player"><option value="">Choose…</option>{players.slice().sort((a, b) => (+a.num || 0) - (+b.num || 0)).map((p) => <option key={p.id} value={p.id}>{pname(p)}</option>)}</select></div>
      {fp ? <div className="lv-follow">
        <div className="lv-follow-nm"><span className="lv-jersey">{fp.num}</span><div><b>{fp.first || "Player #" + fp.num}</b><small>{fp.pos}{c && (c.lu?.includes(follow) || c.lib === follow) && isLive(g) ? " · on the court now" : ""}</small></div></div>
        <div className="lv-follow-k">{([["Kills", fs?.K || 0], ["Aces", fs?.SA || 0], ["Digs", fs?.D || 0], ["Blocks", fs ? +blocks(fs).toFixed(1) : 0], ["Assists", fs?.AST || 0]] as [string, number][]).map(([l, v]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
        {fs && fs.TA > 0 && <p className="lv-note">Hitting {fmtHit(hitting(fs))} on {fs.TA} swings{fs.R ? ` · passing ${fmtAvg(passAvg(fs))} on ${fs.R}` : ""}</p>}
      </div> : <p className="lv-note">Pick a player to see their numbers update with every point.</p>}
    </section>
    {points.length > 0 && <section className="lv-card"><div className="lv-h"><h2>Latest points</h2></div>
      <ul className="lv-pbp">{points.map((l) => <li key={l.id} className={(l as any).p === follow && follow ? "mine" : undefined}><span className={"lv-sc " + (l as any).w}>{(l as any).us}–{(l as any).them}</span><span>{playText(l, team, them, P)}</span></li>)}</ul></section>}
    {c && c.rallies.length > 1 && <section className="lv-card"><div className="lv-h"><h2>Momentum · set {c.n}</h2></div><MomentumChart diffs={momentum(c)} height={120} labels={[team + " ahead", them + " ahead"]} /></section>}
    {leaders.length > 0 && <section className="lv-card"><div className="lv-h"><h2>Leaders</h2></div><div className="lv-leads">{leaders}</div></section>}
  </>;
}

function BoxScore({ g, team, P, follow }: { g: Game; team: string; P: Map<string, LPlayer>; follow: string }) {
  const A = aggregate(g.R.sets), them = g.m.opp || "Opponent";
  const ids = Object.keys(A.ps).filter((id) => P.has(id)).sort((a, b) => (+P.get(a)!.num || 0) - (+P.get(b)!.num || 0));
  const row = (s: Stat, served: number) => [s.K, s.AE, s.TA, fmtHit(hitting(s)), s.SA, serveErrors(s), serves(s, served), s.R, s.R ? fmtAvg(passAvg(s)) : "–", s.D, s.BS, s.BA, s.AST];
  return <section className="lv-card"><div className="lv-h"><h2>{team}</h2></div>
    <div className="tbl lv-box"><table>
      <thead><tr><th className="l">Player</th><th>SP</th><th title="Kills">K</th><th title="Attack errors">E</th><th title="Attack attempts">TA</th><th title="Hitting percentage">Hit%</th><th title="Aces">A</th><th title="Serve errors">SE</th><th title="Serves">Srv</th><th title="Serve receptions">Rec</th><th title="Pass average, 0–3">Pass</th><th title="Digs">D</th><th title="Solo blocks">BS</th><th title="Block assists">BA</th><th title="Assists">Ast</th></tr></thead>
      <tbody>{ids.map((id) => <tr key={id} className={id === follow ? "mine" : undefined}><td className="l">{pname(P.get(id))}</td><td>{A.setsPlayed[id] || 0}</td>{row(A.ps[id], A.srv[id]?.n || 0).map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
      <tfoot><tr><td className="l">Team</td><td>{A.sets}</td>{row(A.T, A.psc.n).map((v, i) => <td key={i}>{v}</td>)}</tr></tfoot>
    </table></div>
    <p className="lv-note">{them}: {A.team.OK} kills, {A.team.OA} aces, {A.team.OE} errors. SP = sets played. Hit% = (kills − errors) ÷ attempts.</p>
  </section>;
}

function PlayByPlay({ g, team, P, follow }: { g: Game; team: string; P: Map<string, LPlayer>; follow: string }) {
  const { m, R } = g, them = m.opp || "Opponent";
  const [all, setAll] = useState(false), [mine, setMine] = useState(false);
  const fp = follow ? P.get(follow) : undefined;
  const keep = (l: LogEntry) => {
    if (l.kind === "set") return true;
    if (mine && fp) return (l.kind === "stat" && l.p === follow) || (l.kind === "sub" && (l.in === follow || l.out === follow));
    return l.kind === "to" || l.kind === "sub" || (l.kind === "stat" && (all || !!l.w));
  };
  // newest set first, newest play first within each set
  const sets: { n: number; items: LogEntry[] }[] = [];
  for (const l of R.log) { if (l.kind === "set") sets.push({ n: l.set, items: [] }); if (sets.length && keep(l) && l.kind !== "set") sets[sets.length - 1].items.push(l); }
  return <section className="lv-card">
    <div className="lv-h"><h2>Play-by-play</h2><div className="lv-filters">
      <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Every touch</label>
      {fp && <label><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only {pname(fp, false)}</label>}</div></div>
    {sets.slice().reverse().map((s) => { const st = R.sets.find((x) => x.n === s.n); return <div key={s.n} className="lv-set">
      <h3>Set {s.n}{st ? <span>{team} {st.us} · {them} {st.them}{st.winner ? "" : g.m.status === "live" ? " · in progress" : ""}</span> : null}</h3>
      <ul className="lv-pbp">{s.items.slice().reverse().map((l) => { const pt = l.kind === "stat" && l.w; return <li key={l.id} className={(follow && ((l as any).p === follow) ? "mine " : "") + (pt ? "" : "minor")}>
        <span className={"lv-sc " + (pt ? (l as any).w : "")}>{pt ? `${(l as any).us}–${(l as any).them}` : ""}</span><span>{playText(l, team, them, P)}</span></li>; })}</ul>
    </div>; })}
  </section>;
}

function TeamStats({ g, team }: { g: Game; team: string }) {
  const A = aggregate(g.R.sets), M = teamMetrics(A), them = g.m.opp || "Opponent";
  const rows: [string, number | null, number | null, (v: number | null) => string, boolean][] = [
    ["Points", A.us, A.them, (v) => String(v ?? "—"), true],
    ["Kills", A.T.K, A.team.OK, (v) => String(v ?? "—"), true],
    ["Aces", A.T.SA, A.team.OA, (v) => String(v ?? "—"), true],
    ["Blocks", blocks(A.T), null, (v) => (v == null ? "—" : String(+v.toFixed(1))), true],
    ["Errors (points given)", M.freePoints.ours, M.freePoints.theirs, (v) => String(v ?? "—"), false],
    ["Side-out %", M.sideOut, ratio(A.psc.n - A.psc.w, A.psc.n), fmtPct, true],
    ["Serve in %", M.serveIn, null, fmtPct, true],
    ["Hitting %", M.hitting, null, fmtHit, true],
    ["Pass average", M.passAvg, null, fmtAvg, true],
  ];
  return <section className="lv-card"><div className="lv-h"><h2>Team stats</h2></div>
    <div className="lv-cmp"><div className="lv-cmp-h"><b className="us">{team}</b><b className="them">{them}</b></div>
      {rows.map(([label, a, b, f, higher]) => { const both = a != null && b != null && a + b > 0, ua = both ? (a as number) / ((a as number) + (b as number)) : null;
        const better = both && a !== b ? ((a as number) > (b as number)) === higher : null;
        return <div key={label} className="lv-cmp-r"><span className={"v" + (better === true ? " lead" : "")}>{f(a)}</span><span className="k">{label}</span><span className={"v" + (better === false ? " lead" : "")}>{f(b)}</span>
          {ua != null && <i className="bar" aria-hidden="true"><i style={{ width: `${Math.round(ua * 100)}%` }} /></i>}</div>; })}
    </div>
    <p className="lv-note">Opponent numbers come from what {team}'s staff recorded; some only exist for {team}.</p>
  </section>;
}
