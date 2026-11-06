/** Jumpset Live: a tournament day on the team page — our games with times, courts and results, pool standings, bracket path. */
import { standings, sortGames, TGame, Tournament, OurResult } from "../tournament/model";
import { Game, isLive } from "./data";
import { locale, tr } from "../lib/i18n";

const clock = (t?: string) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const day = (d: string) => new Date(d + "T12:00").toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" });

export function TournamentCard({ t, team, games, code }: { t: Tournament; team: string; games: Game[]; code: string }) {
  const byId = new Map(games.map((g) => [g.m.id, g]));
  const st = (g: TGame) => { const x = g.matchId ? byId.get(g.matchId) : undefined; if (!x) return null; const sets = x.R.sets.filter((s) => s.us + s.them > 0).map((s) => [s.us, s.them] as [number, number]); return { x, sets, live: isLive(x), res: x.R.wonUs > x.R.wonThem ? "W" : x.R.wonThem > x.R.wonUs ? "L" : "" }; };
  const ours: OurResult[] = t.games.filter((g) => g.stage === "pool").map((g) => { const s = st(g); return { opp: g.opp, sets: s?.sets || [], over: !!s && !s.live }; });
  const S = standings(team, t.poolTeams, ours, t.others);
  const list = sortGames(t), bracket = list.filter((g) => g.stage === "bracket");
  return <section className="lv-card lv-tn" aria-label="Tournament">
    <div className="lv-h"><h2>{t.name}</h2><span className="lv-fresh">{day(t.start)}{t.end ? " – " + day(t.end) : ""}{t.site ? " · " + t.site : ""}</span></div>
    <ul className="lv-tn-games">{list.map((g) => { const s = st(g); return <li key={g.id} className={g.stage === "work" ? "work" : ""}>
      <span className="lv-tn-time">{clock(g.time) || "—"}{g.court ? <small>{tr("Court {n}", { n: g.court })}</small> : null}</span>
      <span><b>{g.stage === "work" ? tr("Working: {x}", { x: g.opp }) : "vs " + g.opp}</b><small>{g.stage === "bracket" ? g.round || tr("Bracket") : g.stage === "pool" ? t.poolName || tr("Pool") : tr("Ref duty")}{g.day && g.day !== t.start ? " · " + day(g.day) : ""}</small></span>
      {s ? <a className={"lv-res " + (s.live ? "live" : s.res === "W" ? "w" : s.res === "L" ? "l" : "")} href={`#/t/${code}/m/${s.x.m.id}`}>{s.live ? `${tr("Live · ")}${s.x.R.cur?.us ?? 0}–${s.x.R.cur?.them ?? 0}` : `${tr(s.res)} ${s.x.R.wonUs}–${s.x.R.wonThem}`}</a> : <span className="lv-ev">{g.stage === "work" ? "" : tr("Upcoming")}</span>}
    </li>; })}</ul>
    {(t.poolTeams.length > 0) && <><h3 className="lv-sub">{tr("{pool} standings", { pool: t.poolName || tr("Pool") })}</h3>
      <div className="tbl lv-box"><table><thead><tr><th className="l">{tr("Team")}</th><th>W–L</th><th>Sets</th><th>Pts +/−</th></tr></thead>
        <tbody>{S.map((r) => <tr key={r.team + (r.us ? "-us" : "")} className={r.us ? "mine" : undefined}><td className="l">{r.team}</td><td>{r.w}–{r.l}</td><td>{r.sw}–{r.sl}</td><td>{r.pf - r.pa > 0 ? "+" : ""}{r.pf - r.pa}</td></tr>)}</tbody></table></div></>}
    {bracket.length > 0 && <><h3 className="lv-sub">{t.bracketName ? t.bracketName + " · " + tr("Bracket") : tr("Bracket")}</h3>
      <ol className="lv-path">{bracket.map((g) => { const s = st(g); return <li key={g.id} className={s?.live ? "live" : s?.res === "W" ? "w" : s?.res === "L" ? "l" : ""}><span><small>{g.round || tr("Bracket")}</small><b>vs {g.opp}</b></span><small>{s ? (s.live ? tr("Live now") : `${tr(s.res)} ${s.x.R.wonUs}–${s.x.R.wonThem}`) : [clock(g.time), g.court ? tr("Court {n}", { n: g.court }) : ""].filter(Boolean).join(" · ")}</small></li>; })}</ol></>}
  </section>;
}
