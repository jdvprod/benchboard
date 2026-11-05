/** A team on Benchboard Live: live game up top, schedule and results, season stats, roster and player pages. */
import { aggregate, recordOf, resultOf, Stat } from "../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, hitting, passAvg, playerMetrics } from "../sports/volleyball/metrics";
import { GameScore } from "../ui/GameScore";
import { todayISO } from "../lib/dates";
import { fmtDay, fmtTime, Game, isLive, isResult, LPlayer, pname, SeasonData, seasonGames } from "./data";
import { GameView, playText } from "./GameView";
import { TournamentCard } from "./TournamentCard";
import { Avatar, TeamLogo } from "../ui/Logo";
import { NotifyCard } from "./Notify";
import { tr } from "../lib/i18n";
import { icsFile, CalItem } from "../lib/ics";
import { seasonSummary } from "../sports/volleyball/seasonSummary";

type Tab = "home" | "schedule" | "stats" | "roster";
export function TeamHub({ code, d, fresh, view }: { code: string; d: SeasonData; fresh: string; view: { tab?: string; match?: string; player?: string } }) {
  const team = d.team?.name || "Team", games = seasonGames(d), P = new Map(d.players.map((p) => [p.id, p]));
  const href = (rest = "") => `#/t/${code}${rest ? "/" + rest : ""}`;
  if (view.match) {
    const g = games.find((x) => x.m.id === view.match);
    if (g) return <GameView g={g} team={team} players={d.players} fresh={fresh} back={{ href: href(), label: team }} logo={d.team?.logo} />;
  }
  if (view.player && P.has(view.player)) return <PlayerSeason p={P.get(view.player)!} games={games} team={team} season={d.season} back={href("roster")} />;
  const tab = (["home", "schedule", "stats", "roster"].includes(view.tab || "") ? view.tab : "home") as Tab;
  const rec = recordOf(games.filter(isResult).map((g) => g.R));
  return <>
    <header className="lv-team">
      {d.team?.logo && <TeamLogo src={d.team.logo} name={team} size={72} className="lv-team-logo" />}
      <div className="grow"><h1>{team}</h1><p>{d.season || tr("Season")}{d.team?.level ? " · " + d.team.level : ""}</p></div>
      <div className="lv-rec"><b>{rec.text}</b><span>{tr("Record")}</span></div>
    </header>
    <nav className="lv-tabs" aria-label={tr("Team sections")}>{([["home", "Home"], ["schedule", "Schedule"], ["stats", "Stats"], ["roster", "Roster"]] as [Tab, string][]).map(([k, l]) => <a key={k} href={href(k === "home" ? "" : k)} aria-current={tab === k ? "page" : undefined}>{tr(l)}</a>)}</nav>
    {tab === "home" && <Home d={d} games={games} team={team} code={code} fresh={fresh} P={P} />}
    {tab === "schedule" && <Schedule d={d} games={games.filter(isResult)} code={code} all />}
    {tab === "stats" && <SeasonStats games={games} P={P} code={code} />}
    {tab === "roster" && <Roster d={d} games={games} code={code} />}
  </>;
}

function Home({ d, games, team, code, fresh, P }: { d: SeasonData; games: Game[]; team: string; code: string; fresh: string; P: Map<string, LPlayer> }) {
  const live = games.find(isLive), today = todayISO();
  // a tournament happening now (or within the last day, so results stay up the evening after)
  const tn = (d.team?.tournaments || []).filter((t) => today >= t.start && today <= addDays(t.end || t.start, 1)).sort((a, b) => b.start.localeCompare(a.start))[0];
  const lastPts = live ? live.R.log.filter((l) => l.kind === "stat" && l.w).slice(-3).reverse() : [];
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const leader = (f: (s: Stat) => number, label: string) => { const top = Object.entries(A.ps).filter(([id]) => P.has(id)).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? <a className="lv-lead" key={label} href={`#/t/${code}/p/${top[0]}`}><span>{label}</span><b>{+top[1].toFixed(1)}</b><small>{pname(P.get(top[0]))}</small></a> : null; };
  const leaders = [leader((s) => s.K, tr("Kills")), leader((s) => s.SA, tr("Aces")), leader((s) => s.D, tr("Digs")), leader((s) => blocks(s), tr("Blocks")), leader((s) => s.AST, tr("Assists"))].filter(Boolean);
  return <>
    {live && <section className="lv-card lv-livecard" aria-label={tr("Live now")}>
      <div className="lv-h"><h2>{tr("Live now · {where}{opp}", { where: tr(live.m.site === "away" ? "at " : "vs "), opp: live.m.opp })}</h2><span className="lv-fresh">{fresh}</span></div>
      <GameScore R={live.R} us={team} them={live.m.opp || "Opponent"} live logos={{ us: d.team?.logo, them: live.m.oppLogo }} />
      {lastPts.length > 0 && <ul className="lv-pbp">{lastPts.map((l) => <li key={l.id}><span className={"lv-sc " + (l as any).w}>{(l as any).us}–{(l as any).them}</span><span>{playText(l, team, live.m.opp || "Opponent", P)}</span></li>)}</ul>}
      <a className="btn primary" href={`#/t/${code}/m/${live.m.id}`}>{tr("Open the gamecast")}</a>
    </section>}
    {tn && <TournamentCard t={tn} team={team} games={games} code={code} />}
    <Schedule d={d} games={games.filter(isResult).slice(0, 5)} code={code} />
    <SeasonReview games={games.filter(isResult)} P={P} code={code} />
    <NotifyCard code={code} team={team} players={d.players} />
    {leaders.length > 0 && <section className="lv-card"><div className="lv-h"><h2>{tr("Season leaders")}</h2><a href={`#/t/${code}/stats`}>{tr("All stats ›")}</a></div><div className="lv-leads">{leaders}</div></section>}
  </>;
}

/** The season so far, once there are a few results: record, streak, biggest win and the best single-match lines. */
function SeasonReview({ games, P, code }: { games: Game[]; P: Map<string, LPlayer>; code: string }) {
  const S = seasonSummary(games.map((g) => ({ id: g.m.id, opp: g.m.opp, date: g.m.date, R: g.R })), (id) => !!P.get(id)?.first);
  if (S.played < 3) return null;
  const streak = S.streak.n >= 2 && !(S.streak.kind === "W" && S.streak.n === S.bestStreak) ? tr(S.streak.kind === "W" ? "Won {n} straight" : "Lost {n} straight", { n: S.streak.n }) : "";
  return <section className="lv-card lv-review"><div className="lv-h"><h2>{tr("Season in review")}</h2><span className="lv-fresh">{tr("{n} matches", { n: S.played })}</span></div>
    <div className="lv-review-k">
      <div><b>{S.w}–{S.l}{S.t ? "–" + S.t : ""}</b><span>{tr("Record")}</span></div>
      <div><b>{S.setsW}–{S.setsL}</b><span>{tr("Sets")}</span></div>
      <div><b>{S.bestStreak || "—"}</b><span>{tr("Longest win streak")}</span></div>
    </div>
    {streak && <p className="lv-note" style={{ marginTop: 6 }}>{streak}</p>}
    {S.biggestWin && <p className="lv-review-best"><span>{tr("Biggest win")}</span><a href={`#/t/${code}/m/${S.biggestWin.gameId}`}>vs {S.biggestWin.opp} · {S.biggestWin.sets}</a></p>}
    {S.highs.length > 0 && <><h3 className="lv-sub">{tr("Best in a match")}</h3>
      <ul className="lv-review-highs">{S.highs.map((h) => <li key={h.key}><span>{tr(h.label)}</span><b>{h.v}</b><a href={`#/t/${code}/p/${h.pid}`}>{pname(P.get(h.pid))}</a><small>vs {h.opp} · {fmtDay(h.date)}</small></li>)}</ul></>}
  </section>;
}

/** Every upcoming match and tournament game as a calendar file the phone opens in its calendar app. */
function addToCalendar(d: SeasonData, code: string) {
  const today = todayISO(), team = d.team?.name || "Team", page = location.href.split("#")[0] + "#/t/" + code;
  const items: CalItem[] = (d.team?.schedule || []).filter((x) => x.date >= today).map((x) => ({ uid: "s-" + x.id, date: x.date, time: x.time, title: `${team} ${x.site === "away" ? "at" : "vs"} ${x.opp}`, where: x.event || undefined, note: page }));
  for (const t of d.team?.tournaments || []) {
    if ((t.end || t.start) < today) continue;
    const ours = t.games.filter((g) => g.stage !== "work");
    if (!ours.length) items.push({ uid: "t-" + t.id, date: t.start, title: `${team} · ${t.name}`, where: t.site, note: page });
    for (const g of ours) items.push({ uid: "g-" + g.id, date: g.day || t.start, time: g.time, title: `${team} vs ${g.opp} · ${t.name}`, where: [t.site, g.court ? tr("Court {n}", { n: g.court }) : ""].filter(Boolean).join(" · ") || undefined, note: page, minutes: 60 });
  }
  const blob = new Blob([icsFile(team, items)], { type: "text/calendar" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${team} schedule.ics`.replace(/[^\w\- .]+/g, ""); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const addDays = (iso: string, n: number) => { const x = new Date(iso + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

function Schedule({ d, games, code, all }: { d: SeasonData; games: Game[]; code: string; all?: boolean }) {
  const today = todayISO();
  const upcoming = (d.team?.schedule || []).filter((x) => x.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, all ? 50 : 3);
  const tns = all ? (d.team?.tournaments || []).filter((t) => (t.end || t.start) >= today).sort((a, b) => a.start.localeCompare(b.start)) : [];
  return <>
    {tns.map((t) => <TournamentCard key={t.id} t={t} team={d.team?.name || "Team"} games={seasonGames(d)} code={code} />)}
    {upcoming.length > 0 && <section className="lv-card"><div className="lv-h"><h2>{tr("Coming up")}</h2>{!all ? <a href={`#/t/${code}/schedule`}>{tr("Full schedule ›")}</a> : <button className="btn sm" onClick={() => addToCalendar(d, code)}>{tr("Add to calendar")}</button>}</div>
      <ul className="lv-games">{upcoming.map((x) => <li key={x.id}><span className="lv-date">{fmtDay(x.date)}{x.time ? <small>{fmtTime(x.time)}</small> : null}</span><b>{tr(x.site === "away" ? "at " : "vs ")}{x.opp}</b><span className="lv-ev">{x.event}</span></li>)}</ul></section>}
    <section className="lv-card"><div className="lv-h"><h2>{tr("Results")}</h2>{!all && games.length >= 5 && <a href={`#/t/${code}/schedule`}>{tr("All results ›")}</a>}</div>
      {games.length ? <ul className="lv-games">{games.map((g) => { const r = resultOf(g.R), live = isLive(g); return <li key={g.m.id}><a href={`#/t/${code}/m/${g.m.id}`}>
        <span className="lv-date">{fmtDay(g.m.date)}</span>
        <b>{g.m.oppLogo && <TeamLogo src={g.m.oppLogo} name={g.m.opp} size={22} className="lv-opp-logo" />}{tr(g.m.site === "away" ? "at " : "vs ")}{g.m.opp}<small>{g.R.sets.filter((s) => s.us + s.them).map((s) => `${s.us}-${s.them}`).join(", ")}</small></b>
        <span className={"lv-res " + (live ? "live" : r === "W" ? "w" : r === "L" ? "l" : "")}>{live ? `${tr("Live · ")}${g.R.cur?.us ?? 0}–${g.R.cur?.them ?? 0}` : r ? `${tr(r)} ${g.R.wonUs}–${g.R.wonThem}` : g.R.sets.some((s) => s.us + s.them) ? `${g.R.wonUs}–${g.R.wonThem}` : tr("Stats only")}</span></a></li>; })}</ul>
        : <p className="lv-note">{tr("No results yet. Scores show up here as soon as the first point is recorded.")}</p>}
    </section>
  </>;
}

function SeasonStats({ games, P, code }: { games: Game[]; P: Map<string, LPlayer>; code: string }) {
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const ids = Object.keys(A.ps).filter((id) => P.has(id)).sort((a, b) => (+P.get(a)!.num || 0) - (+P.get(b)!.num || 0));
  if (!ids.length) return <section className="lv-card"><p className="lv-note">{tr("Season stats show up after the first match.")}</p></section>;
  return <section className="lv-card"><div className="lv-h"><h2>{tr("Season stats")}</h2><span className="lv-fresh">{games.length === 1 ? tr("1 match · {s} sets", { s: A.sets }) : tr("{n} matches · {s} sets", { n: games.length, s: A.sets })}</span></div>
    <div className="tbl lv-box"><table>
      <thead><tr><th className="l">{tr("Player")}</th><th>SP</th><th>K</th><th>K/S</th><th>Hit%</th><th>A</th><th>Srv%</th><th>Pass</th><th>D</th><th>D/S</th><th>Blk</th><th>Ast</th></tr></thead>
      <tbody>{ids.map((id) => { const s = A.ps[id], pm = playerMetrics(A, id); return <tr key={id}><td className="l"><a href={`#/t/${code}/p/${id}`}>{pname(P.get(id))}</a></td><td>{pm.sets}</td><td>{s.K}</td><td>{fmtNum(pm.kps, 2)}</td><td>{s.TA ? fmtHit(hitting(s)) : "–"}</td><td>{s.SA}</td><td>{fmtPct(pm.serveIn)}</td><td>{s.R ? fmtAvg(passAvg(s)) : "–"}</td><td>{s.D}</td><td>{fmtNum(pm.dps, 2)}</td><td>{fmtNum(blocks(s))}</td><td>{s.AST}</td></tr>; })}</tbody>
    </table></div>
    <p className="lv-note">{tr("SP sets played · K/S kills per set · Hit% (kills − errors) ÷ attempts · Pass on a 0–3 scale · D/S digs per set.")}</p>
  </section>;
}

function Roster({ d, games, code }: { d: SeasonData; games: Game[]; code: string }) {
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const ps = d.players.slice().sort((a, b) => (+a.num || 0) - (+b.num || 0));
  return <section className="lv-card"><div className="lv-h"><h2>{tr("Roster")}</h2></div>
    <div className="lv-roster">{ps.map((p) => <a key={p.id} className="lv-rp" href={`#/t/${code}/p/${p.id}`}>{p.photo ? <Avatar photo={p.photo} num={p.num} size={42} /> : <span className="lv-jersey">{p.num}</span>}<span><b>{p.first ? `${p.first}${p.last ? " " + p.last + "." : ""}` : tr("Player")}</b><small>{p.pos}{A.ps[p.id] ? ` · ${A.ps[p.id].K} K · ${A.ps[p.id].D} D` : ""}</small></span></a>)}</div>
  </section>;
}

function PlayerSeason({ p, games, team, season, back }: { p: LPlayer; games: Game[]; team: string; season: string | null; back: string }) {
  const A = aggregate(games.flatMap((g) => g.R.sets)), s: Stat | undefined = A.ps[p.id], pm = playerMetrics(A, p.id);
  const rows = games.map((g) => ({ g, s: aggregate(g.R.sets).ps[p.id] })).filter((x) => x.s);
  const k: [string, string | number, string][] = [[tr("Kills"), s?.K ?? 0, pm.kps != null ? tr("{v} per set", { v: fmtNum(pm.kps, 2) }) : ""], [tr("Hitting"), s && s.TA ? fmtHit(hitting(s)) : "—", s ? tr("{n} swings", { n: s.TA }) : ""], [tr("Aces"), s?.SA ?? 0, pm.serveIn != null ? tr("{v} serves in", { v: fmtPct(pm.serveIn) }) : ""], [tr("Passing"), s && s.R ? fmtAvg(passAvg(s)) : "—", s?.R ? tr("{n} passes", { n: s.R }) : ""], [tr("Digs"), s?.D ?? 0, pm.dps != null ? tr("{v} per set", { v: fmtNum(pm.dps, 2) }) : ""], [tr("Blocks"), s ? fmtNum(blocks(s)) : 0, ""], [tr("Assists"), s?.AST ?? 0, ""], [tr("Sets played"), pm.sets, ""]];
  return <>
    <a className="lv-back" href={back}>{tr("‹ Roster")}</a>
    <header className="lv-player">{p.photo ? <span className="lv-photo"><Avatar photo={p.photo} num={p.num} size={88} /><b>#{p.num}</b></span> : <span className="lv-jersey big">{p.num}</span>}<div><h1>{p.first ? `${p.first} ${p.last ? p.last + "." : ""}` : tr("Player #{n}", { n: p.num })}</h1><p>{p.pos} · {team} · {season || tr("This season")}</p></div></header>
    <section className="lv-card"><div className="lv-k">{k.map(([l, v, sub]) => <div key={l}><span>{l}</span><b>{v}</b>{sub ? <small>{sub}</small> : null}</div>)}</div></section>
    <section className="lv-card"><div className="lv-h"><h2>{tr("Game log")}</h2></div>{rows.length ? <div className="tbl lv-box"><table>
      <thead><tr><th className="l">{tr("Date")}</th><th className="l">{tr("Opponent")}</th><th>K</th><th>Hit%</th><th>A</th><th>Pass</th><th>D</th><th>Blk</th><th>Ast</th></tr></thead>
      <tbody>{rows.map(({ g, s }) => <tr key={g.m.id}><td className="l">{fmtDay(g.m.date)}</td><td className="l">{g.m.opp}</td><td>{s!.K}</td><td>{s!.TA ? fmtHit(hitting(s!)) : "–"}</td><td>{s!.SA}</td><td>{s!.R ? fmtAvg(passAvg(s!)) : "–"}</td><td>{s!.D}</td><td>{fmtNum(blocks(s!))}</td><td>{s!.AST}</td></tr>)}</tbody>
    </table></div> : <p className="lv-note">{tr("No stats yet this season.")}</p>}</section>
  </>;
}
