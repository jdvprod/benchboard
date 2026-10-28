/** A team on Benchboard Live: live game up top, schedule and results, season stats, roster and player pages. */
import { aggregate, recordOf, resultOf, Stat } from "../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, hitting, passAvg, playerMetrics } from "../sports/volleyball/metrics";
import { GameScore } from "../ui/GameScore";
import { todayISO } from "../lib/dates";
import { fmtDay, fmtTime, Game, isLive, LPlayer, pname, SeasonData, seasonGames } from "./data";
import { GameView, playText } from "./GameView";

type Tab = "home" | "schedule" | "stats" | "roster";
export function TeamHub({ code, d, fresh, view }: { code: string; d: SeasonData; fresh: string; view: { tab?: string; match?: string; player?: string } }) {
  const team = d.team?.name || "Team", games = seasonGames(d), P = new Map(d.players.map((p) => [p.id, p]));
  const href = (rest = "") => `#/t/${code}${rest ? "/" + rest : ""}`;
  if (view.match) {
    const g = games.find((x) => x.m.id === view.match);
    if (g) return <GameView g={g} team={team} players={d.players} fresh={fresh} back={{ href: href(), label: team }} />;
  }
  if (view.player && P.has(view.player)) return <PlayerSeason p={P.get(view.player)!} games={games} team={team} season={d.season} back={href("roster")} />;
  const tab = (["home", "schedule", "stats", "roster"].includes(view.tab || "") ? view.tab : "home") as Tab;
  const rec = recordOf(games.map((g) => g.R));
  return <>
    <header className="lv-team">
      <div><h1>{team}</h1><p>{d.season || "Season"}{d.team?.level ? " · " + d.team.level : ""}</p></div>
      <div className="lv-rec"><b>{rec.text}</b><span>Record</span></div>
    </header>
    <nav className="lv-tabs" aria-label="Team sections">{([["home", "Home"], ["schedule", "Schedule"], ["stats", "Stats"], ["roster", "Roster"]] as [Tab, string][]).map(([k, l]) => <a key={k} href={href(k === "home" ? "" : k)} aria-current={tab === k ? "page" : undefined}>{l}</a>)}</nav>
    {tab === "home" && <Home d={d} games={games} team={team} code={code} fresh={fresh} P={P} />}
    {tab === "schedule" && <Schedule d={d} games={games} code={code} all />}
    {tab === "stats" && <SeasonStats games={games} P={P} code={code} />}
    {tab === "roster" && <Roster d={d} games={games} code={code} />}
  </>;
}

function Home({ d, games, team, code, fresh, P }: { d: SeasonData; games: Game[]; team: string; code: string; fresh: string; P: Map<string, LPlayer> }) {
  const live = games.find(isLive);
  const lastPts = live ? live.R.log.filter((l) => l.kind === "stat" && l.w).slice(-3).reverse() : [];
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const leader = (f: (s: Stat) => number, label: string) => { const top = Object.entries(A.ps).filter(([id]) => P.has(id)).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? <a className="lv-lead" key={label} href={`#/t/${code}/p/${top[0]}`}><span>{label}</span><b>{+top[1].toFixed(1)}</b><small>{pname(P.get(top[0]))}</small></a> : null; };
  const leaders = [leader((s) => s.K, "Kills"), leader((s) => s.SA, "Aces"), leader((s) => s.D, "Digs"), leader((s) => blocks(s), "Blocks"), leader((s) => s.AST, "Assists")].filter(Boolean);
  return <>
    {live && <section className="lv-card lv-livecard" aria-label="Live now">
      <div className="lv-h"><h2>Live now · {live.m.site === "away" ? "at " : "vs "}{live.m.opp}</h2><span className="lv-fresh">{fresh}</span></div>
      <GameScore R={live.R} us={team} them={live.m.opp || "Opponent"} live />
      {lastPts.length > 0 && <ul className="lv-pbp">{lastPts.map((l) => <li key={l.id}><span className={"lv-sc " + (l as any).w}>{(l as any).us}–{(l as any).them}</span><span>{playText(l, team, live.m.opp || "Opponent", P)}</span></li>)}</ul>}
      <a className="btn primary" href={`#/t/${code}/m/${live.m.id}`}>Open the gamecast</a>
    </section>}
    <Schedule d={d} games={games.slice(0, 5)} code={code} />
    {leaders.length > 0 && <section className="lv-card"><div className="lv-h"><h2>Season leaders</h2><a href={`#/t/${code}/stats`}>All stats ›</a></div><div className="lv-leads">{leaders}</div></section>}
  </>;
}

function Schedule({ d, games, code, all }: { d: SeasonData; games: Game[]; code: string; all?: boolean }) {
  const today = todayISO();
  const upcoming = (d.team?.schedule || []).filter((x) => x.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, all ? 50 : 3);
  return <>
    {upcoming.length > 0 && <section className="lv-card"><div className="lv-h"><h2>Coming up</h2>{!all && <a href={`#/t/${code}/schedule`}>Full schedule ›</a>}</div>
      <ul className="lv-games">{upcoming.map((x) => <li key={x.id}><span className="lv-date">{fmtDay(x.date)}{x.time ? <small>{fmtTime(x.time)}</small> : null}</span><b>{x.site === "away" ? "at " : "vs "}{x.opp}</b><span className="lv-ev">{x.event}</span></li>)}</ul></section>}
    <section className="lv-card"><div className="lv-h"><h2>Results</h2>{!all && games.length >= 5 && <a href={`#/t/${code}/schedule`}>All results ›</a>}</div>
      {games.length ? <ul className="lv-games">{games.map((g) => { const r = resultOf(g.R), live = isLive(g); return <li key={g.m.id}><a href={`#/t/${code}/m/${g.m.id}`}>
        <span className="lv-date">{fmtDay(g.m.date)}</span>
        <b>{g.m.site === "away" ? "at " : "vs "}{g.m.opp}<small>{g.R.sets.filter((s) => s.us + s.them).map((s) => `${s.us}-${s.them}`).join(", ")}</small></b>
        <span className={"lv-res " + (live ? "live" : r === "W" ? "w" : r === "L" ? "l" : "")}>{live ? `Live · ${g.R.cur?.us ?? 0}–${g.R.cur?.them ?? 0}` : r ? `${r} ${g.R.wonUs}–${g.R.wonThem}` : `${g.R.wonUs}–${g.R.wonThem}`}</span></a></li>; })}</ul>
        : <p className="lv-note">No results yet. Scores show up here as soon as the first point is recorded.</p>}
    </section>
  </>;
}

function SeasonStats({ games, P, code }: { games: Game[]; P: Map<string, LPlayer>; code: string }) {
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const ids = Object.keys(A.ps).filter((id) => P.has(id)).sort((a, b) => (+P.get(a)!.num || 0) - (+P.get(b)!.num || 0));
  if (!ids.length) return <section className="lv-card"><p className="lv-note">Season stats show up after the first match.</p></section>;
  return <section className="lv-card"><div className="lv-h"><h2>Season stats</h2><span className="lv-fresh">{games.length} {games.length === 1 ? "match" : "matches"} · {A.sets} sets</span></div>
    <div className="tbl lv-box"><table>
      <thead><tr><th className="l">Player</th><th>SP</th><th>K</th><th>K/S</th><th>Hit%</th><th>A</th><th>Srv%</th><th>Pass</th><th>D</th><th>D/S</th><th>Blk</th><th>Ast</th></tr></thead>
      <tbody>{ids.map((id) => { const s = A.ps[id], pm = playerMetrics(A, id); return <tr key={id}><td className="l"><a href={`#/t/${code}/p/${id}`}>{pname(P.get(id))}</a></td><td>{pm.sets}</td><td>{s.K}</td><td>{fmtNum(pm.kps, 2)}</td><td>{s.TA ? fmtHit(hitting(s)) : "–"}</td><td>{s.SA}</td><td>{fmtPct(pm.serveIn)}</td><td>{s.R ? fmtAvg(passAvg(s)) : "–"}</td><td>{s.D}</td><td>{fmtNum(pm.dps, 2)}</td><td>{fmtNum(blocks(s))}</td><td>{s.AST}</td></tr>; })}</tbody>
    </table></div>
    <p className="lv-note">SP sets played · K/S kills per set · Hit% (kills − errors) ÷ attempts · Pass on a 0–3 scale · D/S digs per set.</p>
  </section>;
}

function Roster({ d, games, code }: { d: SeasonData; games: Game[]; code: string }) {
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const ps = d.players.slice().sort((a, b) => (+a.num || 0) - (+b.num || 0));
  return <section className="lv-card"><div className="lv-h"><h2>Roster</h2></div>
    <div className="lv-roster">{ps.map((p) => <a key={p.id} className="lv-rp" href={`#/t/${code}/p/${p.id}`}><span className="lv-jersey">{p.num}</span><span><b>{p.first ? `${p.first}${p.last ? " " + p.last + "." : ""}` : "Player"}</b><small>{p.pos}{A.ps[p.id] ? ` · ${A.ps[p.id].K} K · ${A.ps[p.id].D} D` : ""}</small></span></a>)}</div>
  </section>;
}

function PlayerSeason({ p, games, team, season, back }: { p: LPlayer; games: Game[]; team: string; season: string | null; back: string }) {
  const A = aggregate(games.flatMap((g) => g.R.sets)), s: Stat | undefined = A.ps[p.id], pm = playerMetrics(A, p.id);
  const rows = games.map((g) => ({ g, s: aggregate(g.R.sets).ps[p.id] })).filter((x) => x.s);
  const k: [string, string | number, string][] = [["Kills", s?.K ?? 0, pm.kps != null ? fmtNum(pm.kps, 2) + " per set" : ""], ["Hitting", s && s.TA ? fmtHit(hitting(s)) : "—", s ? `${s.TA} swings` : ""], ["Aces", s?.SA ?? 0, pm.serveIn != null ? fmtPct(pm.serveIn) + " serves in" : ""], ["Passing", s && s.R ? fmtAvg(passAvg(s)) : "—", s?.R ? s.R + " passes" : ""], ["Digs", s?.D ?? 0, pm.dps != null ? fmtNum(pm.dps, 2) + " per set" : ""], ["Blocks", s ? fmtNum(blocks(s)) : 0, ""], ["Assists", s?.AST ?? 0, ""], ["Sets played", pm.sets, ""]];
  return <>
    <a className="lv-back" href={back}>‹ Roster</a>
    <header className="lv-player"><span className="lv-jersey big">{p.num}</span><div><h1>{p.first ? `${p.first} ${p.last ? p.last + "." : ""}` : `Player #${p.num}`}</h1><p>{p.pos} · {team} · {season || "This season"}</p></div></header>
    <section className="lv-card"><div className="lv-k">{k.map(([l, v, sub]) => <div key={l}><span>{l}</span><b>{v}</b>{sub ? <small>{sub}</small> : null}</div>)}</div></section>
    <section className="lv-card"><div className="lv-h"><h2>Game log</h2></div>{rows.length ? <div className="tbl lv-box"><table>
      <thead><tr><th className="l">Date</th><th className="l">Opponent</th><th>K</th><th>Hit%</th><th>A</th><th>Pass</th><th>D</th><th>Blk</th><th>Ast</th></tr></thead>
      <tbody>{rows.map(({ g, s }) => <tr key={g.m.id}><td className="l">{fmtDay(g.m.date)}</td><td className="l">{g.m.opp}</td><td>{s!.K}</td><td>{s!.TA ? fmtHit(hitting(s!)) : "–"}</td><td>{s!.SA}</td><td>{s!.R ? fmtAvg(passAvg(s!)) : "–"}</td><td>{s!.D}</td><td>{fmtNum(blocks(s!))}</td><td>{s!.AST}</td></tr>)}</tbody>
    </table></div> : <p className="lv-note">No stats yet this season.</p>}</section>
  </>;
}
