/** Tournament day: our games (pool, bracket, work duties), up next with one-tap start, pool standings and the bracket path. */
import { useState } from "react";
import { get, newMatch, patch, replayOf, setTeamPatch, team, toast, todayISO, uid } from "../../data/store";
import { Match } from "../../data/model";
import { Card, ConfirmButton, Seg } from "../../ui/kit";
import { go } from "../../app/router";
import { setUi } from "../../app/ui";
import { FORMATS, SCORING, parseScoring } from "../track/TrackPage";
import { isOn, nextGame, OurResult, sortGames, standings, TGame, TOther, Tournament } from "../../tournament/model";
import { parseSetScores } from "../../import/statsImport";

export const tournamentsOf = (): Tournament[] => (team()?.tournaments || []).slice().sort((a, b) => b.start.localeCompare(a.start));
export const todaysTournament = (): Tournament | null => tournamentsOf().find((t) => isOn(t, todayISO())) || null;
const saveT = (t: Tournament) => { const all = team()!.tournaments || []; setTeamPatch({ tournaments: all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : all.concat(t) }); };
export const fmtClock = (t?: string) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const fmtDay = (d: string) => new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const STAGE: Record<TGame["stage"], string> = { pool: "Pool", bracket: "Bracket", work: "Work (ref)" };

/** How one of our tournament games stands: not started, live, or the result. */
export function gameState(g: TGame): { m?: Match; text: string; res?: "W" | "L" | null; live?: boolean; sets?: [number, number][] } {
  const m = g.matchId ? get("matches", g.matchId) : undefined; if (!m) return { text: "" };
  const R = replayOf(m); if (!R) return { m, text: "" };
  const sets = R.sets.filter((s) => s.us + s.them > 0).map((s) => [s.us, s.them] as [number, number]);
  if (R.matchOver || m.status === "done") return { m, sets, res: R.wonUs > R.wonThem ? "W" : R.wonThem > R.wonUs ? "L" : null, text: `${R.wonUs}–${R.wonThem}` };
  return { m, sets, live: true, text: R.cur ? `Set ${R.cur.n}: ${R.cur.us}–${R.cur.them}` : "Live" };
}
export function ourResults(t: Tournament): OurResult[] {
  return t.games.filter((g) => g.stage === "pool").map((g) => { const s = gameState(g); return { opp: g.opp, sets: s.sets || [], over: !!s.m && !s.live }; });
}

/** Starts one of the tournament's games as a match, with its format. */
export function startGame(t: Tournament, g: TGame) {
  const sc = parseScoring(g.scoring || "25");
  const m = newMatch({ kind: "match", opp: g.opp, date: todayISO(), site: "neutral", event: t.name + (g.stage === "bracket" && g.round ? " · " + g.round : g.stage === "pool" ? " · Pool" : ""), bestOf: g.bestOf, setTo: sc.setTo, cap: sc.cap, serve: "us" });
  patch("matches", m.id, { tournamentId: t.id });
  saveT({ ...t, games: t.games.map((x) => (x.id === g.id ? { ...x, matchId: m.id } : x)) });
  setUi({ sel: null, panel: null, follow: null }); go("track");
}

export function TournamentPage({ id }: { id?: string }) {
  if (!id || id === "new") return <NewTournament />;
  const t = (team()?.tournaments || []).find((x) => x.id === id);
  if (!t) return <div className="page"><Card><p className="empty">That tournament isn't on this team.</p><button className="btn" onClick={() => go("matchup")}>Back</button></Card></div>;
  return <TournamentView t={t} />;
}

function NewTournament() {
  const [f, setF] = useState({ name: "", start: todayISO(), end: "", site: "", poolName: "Pool A", bracketName: "" });
  return <div className="page" style={{ maxWidth: 720 }}><Card title="New tournament">
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!f.name.trim()) return; const t: Tournament = { id: uid("tn"), name: f.name.trim(), start: f.start, end: f.end && f.end > f.start ? f.end : undefined, site: f.site.trim() || undefined, poolName: f.poolName.trim() || undefined, bracketName: f.bracketName.trim() || undefined, poolTeams: [], games: [], others: [], createdAt: Date.now() }; saveT(t); toast("Tournament added. Now add your games."); go("tournament", t.id); }}>
      <label className="field"><span className="label">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Fresno Fall Classic" autoFocus /></label>
      <div className="two"><label className="field"><span className="label">First day</span><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <label className="field"><span className="label">Last day (if more than one)</span><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label></div>
      <label className="field"><span className="label">Where</span><input value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} placeholder="e.g. Fresno Convention Center" /></label>
      <div className="two"><label className="field"><span className="label">Our pool</span><input value={f.poolName} onChange={(e) => setF({ ...f, poolName: e.target.value })} /></label>
        <label className="field"><span className="label">Bracket (if known)</span><input value={f.bracketName} onChange={(e) => setF({ ...f, bracketName: e.target.value })} placeholder="e.g. Gold" /></label></div>
      <div className="row"><button className="btn primary" disabled={!f.name.trim()}>Create tournament</button><button type="button" className="btn" onClick={() => go("matchup")}>Cancel</button></div>
    </form></Card></div>;
}

function TournamentView({ t }: { t: Tournament }) {
  const tm = team()!, games = sortGames(t);
  const done = (mid: string) => { const s = gameState({ matchId: mid } as TGame); return !!s.m && !s.live; };
  const next = nextGame(t, done);
  const S = standings(tm.name, t.poolTeams, ourResults(t), t.others);
  const bracket = games.filter((g) => g.stage === "bracket");
  const set = (p: Partial<Tournament>) => saveT({ ...t, ...p });
  return <div className="page">
    <div className="pagehead"><h1>{t.name}</h1><button className="btn sm" onClick={() => go("matchup")}>← Matchups</button></div>
    <p className="muted" style={{ marginTop: -6 }}>{fmtDay(t.start)}{t.end ? " – " + fmtDay(t.end) : ""}{t.site ? " · " + t.site : ""}</p>
    {next && <section className="card tn-next"><div className="tn-next-l"><span className="label">Up next</span>
      <b>{next.stage === "bracket" && next.round ? next.round + " · " : next.stage === "pool" ? (t.poolName || "Pool") + " · " : ""}vs {next.opp}</b>
      <span className="small muted">{[next.day && next.day !== t.start ? fmtDay(next.day) : "", fmtClock(next.time), next.court ? "Court " + next.court : "", fmtLabel(next)].filter(Boolean).join(" · ")}</span></div>
      {next.matchId && gameState(next).live ? <button className="btn primary" onClick={() => { setTeamPatch({ currentMatchId: next.matchId! }); go("track"); }}>Back to the match</button> : <button className="btn primary" onClick={() => startGame(t, next)}>Start vs {next.opp}</button>}
    </section>}
    <div className="grid2" style={{ alignItems: "start" }}>
      <div className="stack">
        <Card title="Our games"><TGames t={t} games={games} set={set} /></Card>
        {bracket.length > 0 && <Card title={(t.bracketName ? t.bracketName + " bracket" : "Bracket") + " · our path"}><ol className="tn-path">{bracket.map((g) => { const s = gameState(g); return <li key={g.id} className={s.res === "W" ? "w" : s.res === "L" ? "l" : s.live ? "live" : ""}><b>{g.round || "Bracket"}</b><span>vs {g.opp}</span><span className="small muted">{s.text || [fmtClock(g.time), g.court ? "Court " + g.court : ""].filter(Boolean).join(" · ")}</span></li>; })}</ol></Card>}
      </div>
      <div className="stack">
        <Card title={(t.poolName || "Pool") + " standings"}>
          <div className="tbl"><table><thead><tr><th className="l">Team</th><th>W–L</th><th>Sets</th><th title="Points for minus against">Pts +/−</th></tr></thead>
            <tbody>{S.map((r) => <tr key={r.team + (r.us ? "-us" : "")} style={r.us ? { fontWeight: 700 } : undefined}><td className="l">{r.team}</td><td>{r.w}–{r.l}</td><td>{r.sw}–{r.sl}</td><td>{r.pf - r.pa > 0 ? "+" : ""}{r.pf - r.pa}</td></tr>)}</tbody></table></div>
          <p className="keys">Ranked by matches won, then set %, then point %. Add the other teams in your pool and their results to complete it.</p>
          <PoolTeams t={t} set={set} />
          <OtherResults t={t} set={set} />
        </Card>
        <Card title="Details">
          <div className="two"><label className="field"><span className="label">Pool name</span><input defaultValue={t.poolName} onBlur={(e) => set({ poolName: e.target.value.trim() || undefined })} /></label>
            <label className="field"><span className="label">Bracket</span><input defaultValue={t.bracketName} placeholder="e.g. Gold" onBlur={(e) => set({ bracketName: e.target.value.trim() || undefined })} /></label></div>
          <label className="field"><span className="label">Where</span><input defaultValue={t.site} onBlur={(e) => set({ site: e.target.value.trim() || undefined })} /></label>
          <div className="row" style={{ marginTop: 8 }}><ConfirmButton className="btn sm ghost" confirmText="Delete this tournament? Matches stay." onConfirm={() => { setTeamPatch({ tournaments: (team()!.tournaments || []).filter((x) => x.id !== t.id) }); toast("Tournament deleted"); go("matchup"); }}>Delete tournament</ConfirmButton></div>
        </Card>
      </div>
    </div>
  </div>;
}
const fmtLabel = (g: TGame) => g.bestOf === 2 ? "2 sets" : g.bestOf === 1 ? "1 set" : `Best of ${g.bestOf}` + (g.scoring && g.scoring !== "25" ? " · " + (SCORING.find((s) => s[0] === g.scoring)?.[1] || g.scoring) : "");

function TGames({ t, games, set }: { t: Tournament; games: TGame[]; set: (p: Partial<Tournament>) => void }) {
  const [adding, setAdding] = useState(!games.length);
  const [f, setF] = useState<TGame>({ id: "", stage: "pool", opp: "", bestOf: 2, scoring: "25", time: "", court: "", round: "", day: t.start });
  const add = () => { if (!f.opp.trim()) return; set({ games: t.games.concat({ ...f, id: uid("tg"), opp: f.opp.trim(), round: f.stage === "bracket" ? f.round || "Bracket" : undefined }), poolTeams: f.stage === "pool" && !t.poolTeams.some((x) => x.toLowerCase() === f.opp.trim().toLowerCase()) ? t.poolTeams.concat(f.opp.trim()) : t.poolTeams }); setF({ ...f, opp: "", time: "", court: "" }); setAdding(false); };
  return <div className="stack">
    {games.length ? <ul className="tn-games">{games.map((g) => { const s = gameState(g); return <li key={g.id} className={g.stage === "work" ? "work" : ""}>
      <span className="tn-time">{fmtClock(g.time) || "—"}{g.court ? <small>Ct {g.court}</small> : null}</span>
      <span className="tn-main"><b>{g.stage === "work" ? "Work: " + g.opp : "vs " + g.opp}</b><small>{[g.day && g.day !== t.start ? fmtDay(g.day) : "", g.stage === "bracket" ? g.round || "Bracket" : STAGE[g.stage], g.stage !== "work" ? fmtLabel(g) : ""].filter(Boolean).join(" · ")}</small></span>
      <span className="tn-res">{s.m ? <button className={"linkish tn-r " + (s.res === "W" ? "w" : s.res === "L" ? "l" : "")} onClick={() => { if (s.live) { setTeamPatch({ currentMatchId: s.m!.id }); go("track"); } else { setUi({ statsScope: "m:" + s.m!.id }); go("stats"); } }}>{s.res ? s.res + " " : ""}{s.text}</button>
        : g.stage !== "work" ? <button className="btn sm" onClick={() => startGame(t, g)}>Start</button> : null}
        <ConfirmButton className="btn sm ghost" confirmText="Remove?" onConfirm={() => set({ games: t.games.filter((x) => x.id !== g.id) })}>✕</ConfirmButton></span>
    </li>; })}</ul> : <p className="empty">No games yet. Add your pool games from the tournament schedule.</p>}
    {adding ? <form className="stack tn-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <Seg value={f.stage} onChange={(v) => setF({ ...f, stage: v, bestOf: v === "pool" ? 2 : v === "bracket" ? 3 : f.bestOf })} options={[["pool", "Pool"], ["bracket", "Bracket"], ["work", "Work (ref)"]]} label="Kind of game" />
      <label className="field"><span className="label">{f.stage === "work" ? "Match we're working" : "Opponent"}</span><input list="tn-teams" value={f.opp} onChange={(e) => setF({ ...f, opp: e.target.value })} placeholder={f.stage === "work" ? "e.g. Buchanan vs Central" : "e.g. Buchanan"} /><datalist id="tn-teams">{t.poolTeams.map((x) => <option key={x} value={x} />)}</datalist></label>
      <div className="tn-row">
        {t.end && <label className="field"><span className="label">Day</span><input type="date" min={t.start} max={t.end} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></label>}
        <label className="field"><span className="label">Time</span><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
        <label className="field"><span className="label">Court</span><input value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })} placeholder="3" /></label>
        {f.stage === "bracket" && <label className="field"><span className="label">Round</span><input list="tn-rounds" value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })} placeholder="Quarterfinal" /><datalist id="tn-rounds">{["Crossover", "Quarterfinal", "Semifinal", "Final", "3rd place"].map((x) => <option key={x} value={x} />)}</datalist></label>}
      </div>
      {f.stage !== "work" && <div className="row"><select className="input" style={{ width: "auto" }} aria-label="Format" value={f.bestOf} onChange={(e) => setF({ ...f, bestOf: +e.target.value })}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="input" style={{ width: "auto" }} aria-label="Scoring" value={f.scoring} onChange={(e) => setF({ ...f, scoring: e.target.value })}>{SCORING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>}
      <div className="row"><button className="btn primary" disabled={!f.opp.trim()}>Add game</button>{games.length > 0 && <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>}</div>
    </form> : <button className="btn sm" onClick={() => setAdding(true)}>Add a game</button>}
  </div>;
}

function PoolTeams({ t, set }: { t: Tournament; set: (p: Partial<Tournament>) => void }) {
  const [v, setV] = useState("");
  return <div className="tn-pool"><span className="label">Teams in our pool</span>
    <div className="row" style={{ gap: 6 }}>{t.poolTeams.map((x) => <span key={x} className="tag tn-chip">{x}<button aria-label={"Remove " + x} onClick={() => set({ poolTeams: t.poolTeams.filter((y) => y !== x) })}>×</button></span>)}</div>
    <form className="row" onSubmit={(e) => { e.preventDefault(); const n = v.trim(); if (n && !t.poolTeams.some((x) => x.toLowerCase() === n.toLowerCase())) set({ poolTeams: t.poolTeams.concat(n) }); setV(""); }}>
      <input className="input" style={{ maxWidth: 220 }} value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a team" aria-label="Add a team to the pool" /><button className="btn sm" disabled={!v.trim()}>Add</button></form>
  </div>;
}

function OtherResults({ t, set }: { t: Tournament; set: (p: Partial<Tournament>) => void }) {
  const [f, setF] = useState({ a: "", b: "", sets: "" });
  const sets = parseSetScores(f.sets);
  if (t.poolTeams.length < 2) return null;
  return <div className="tn-pool"><span className="label">Other pool results</span>
    {t.others.length > 0 && <ul className="tn-others">{t.others.map((o) => <li key={o.id}><span>{o.a} vs {o.b}</span><span className="small muted">{o.sets.map((s) => s.join("-")).join(", ")}</span><button className="btn sm ghost" aria-label="Remove result" onClick={() => set({ others: t.others.filter((x) => x.id !== o.id) })}>✕</button></li>)}</ul>}
    <form className="tn-row" onSubmit={(e) => { e.preventDefault(); if (!f.a || !f.b || f.a === f.b || !sets.length) return; set({ others: t.others.concat({ id: uid("to"), a: f.a, b: f.b, sets } as TOther) }); setF({ a: "", b: "", sets: "" }); }}>
      <select className="input" aria-label="First team" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })}><option value="">Team</option>{t.poolTeams.map((x) => <option key={x}>{x}</option>)}</select>
      <select className="input" aria-label="Second team" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })}><option value="">vs team</option>{t.poolTeams.filter((x) => x !== f.a).map((x) => <option key={x}>{x}</option>)}</select>
      <input className="input" aria-label="Set scores, first team's points first" value={f.sets} onChange={(e) => setF({ ...f, sets: e.target.value })} placeholder="25-20, 21-25, 15-11" />
      <button className="btn sm" disabled={!f.a || !f.b || f.a === f.b || !sets.length}>Add result</button>
    </form>
  </div>;
}

/** A small card for the Track home screen on a tournament day. */
export function TournamentToday() {
  const t = todaysTournament(); if (!t) return null;
  const done = (mid: string) => { const s = gameState({ matchId: mid } as TGame); return !!s.m && !s.live; };
  const next = nextGame(t, done), S = standings(team()!.name, t.poolTeams, ourResults(t), t.others), me = S.findIndex((r) => r.us);
  return <section className="card tn-today">
    <div className="row between"><div><span className="label">Tournament today</span><h2 style={{ margin: "2px 0 0" }}>{t.name}</h2></div><button className="btn sm" onClick={() => go("tournament", t.id)}>Open</button></div>
    <p className="small muted" style={{ margin: "4px 0 8px" }}>{t.poolTeams.length ? `${S[me].w}–${S[me].l} in ${t.poolName || "pool"} · ${ordinal(me + 1)} of ${S.length}` : "Add your pool teams to see standings"}</p>
    {next ? <div className="row between"><span><b>Up next: vs {next.opp}</b><br /><span className="small muted">{[fmtClock(next.time), next.court ? "Court " + next.court : "", fmtLabel(next)].filter(Boolean).join(" · ")}</span></span><button className="btn primary" onClick={() => startGame(t, next)}>Start</button></div> : <p className="small" style={{ margin: 0 }}>{t.games.length ? "All scheduled games played." : "Add your games to get one-tap starts."}</p>}
  </section>;
}
const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");

/** List for the Matchup tab. */
export function TournamentList() {
  const list = tournamentsOf();
  return <Card title="Tournaments" actions={<button className="btn sm" onClick={() => go("tournament", "new")}>New tournament</button>}>
    {list.length ? <ul className="tn-list">{list.map((t) => { const played = t.games.filter((g) => g.matchId).length; return <li key={t.id}><button className="linkish" onClick={() => go("tournament", t.id)}><b>{t.name}</b></button><span className="small muted">{fmtDay(t.start)}{t.end ? " – " + fmtDay(t.end) : ""} · {t.games.filter((g) => g.stage !== "work").length} games{played ? `, ${played} played` : ""}</span></li>; })}</ul>
      : <p className="small muted" style={{ margin: 0 }}>Plan a tournament day: pool games with times and courts, work duties, standings and your bracket path, with one-tap starts. Families see it on Benchboard Live.</p>}
  </Card>;
}
