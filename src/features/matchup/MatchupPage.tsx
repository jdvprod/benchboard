/** Matchups: the schedule, and everything you know about the next opponent from every time you've played them. */
import { TheirRotations } from "../stats/StatsPage";
import { parseSchedule } from "./parseSchedule";
import { useState } from "react";
import { ensureOpponent, get, matchesOf, newMatch, oppKey, opponentsOf, patch, playerName, replayOf, setTeamPatch, team, teamPlayers, toast, todayISO, uid } from "../../data/store";
import { Match, Opponent, PlanItem, ScheduleItem } from "../../data/model";
import { aggregate, Agg, Replay, resultOf } from "../../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, fmtSigned, hitting, playerMetrics, ratio, serveErrors, teamMetrics } from "../../sports/volleyball/metrics";
import { tendencies, ALL_ZONES } from "../../sports/volleyball/tendencies";
import { Card, ConfirmButton, download, fmtDate, Seg } from "../../ui/kit";
import { CourtSvg } from "../../ui/court";
import { Diverge } from "../../ui/charts";
import { AiCard } from "../../ui/ai";
import { scoutPrompt } from "../../ai/prompts";
import { go } from "../../app/router";
import { setUi } from "../../app/ui";
import { TournamentList } from "../tournament/TournamentPage";

interface H2H { o: Opponent; games: { m: Match; R: Replay }[]; A: Agg; season: Agg }

function headToHead(o: Opponent): H2H {
  const t = team()!, k = oppKey(o.name);
  const all = matchesOf().filter((m) => m.kind === "match").map((m) => ({ m, R: replayOf(m)! })).filter((x) => x.R);
  const games = all.filter((x) => oppKey(x.m.opp) === k);
  const season = all.filter((x) => !t.activeSeasonId || x.m.seasonId === t.activeSeasonId);
  return { o, games, A: aggregate(games.flatMap((x) => x.R.sets)), season: aggregate(season.flatMap((x) => x.R.sets)) };
}

export function MatchupPage({ id }: { id?: string }) {
  const t = team()!, opps = opponentsOf(), sched = (t.schedule || []).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = sched.filter((s) => s.date >= todayISO());
  const fallback = upcoming[0] ? opps.find((o) => oppKey(o.name) === oppKey(upcoming[0].opp)) : opps[0];
  const o = get("opponents", id) || fallback;
  const pick = (oid: string) => go("matchup", oid);
  return <div className="page">
    <div className="pagehead"><h1>Matchups</h1>
      {opps.length > 0 && <select className="input" style={{ width: "auto", minWidth: 0, maxWidth: "100%" }} value={o?.id || ""} onChange={(e) => pick(e.target.value)} aria-label="Opponent">
        {opps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>}
    </div>
    <div className="mu-layout">
      <div className="stack">{o ? <Matchup key={o.id} h={headToHead(o)} next={upcoming.find((s) => oppKey(s.opp) === oppKey(o.name))} /> : <Card><p className="empty">Add an upcoming match or play a team, and its matchup shows up here.</p></Card>}</div>
      <aside className="stack"><Schedule items={sched} onOpen={(name) => pick(ensureOpponent(name).id)} current={o?.name} /><TournamentList /></aside>
    </div>
  </div>;
}

/* ---------- schedule ---------- */
function Schedule({ items, onOpen, current }: { items: ScheduleItem[]; onOpen: (opp: string) => void; current?: string }) {
  const t = team()!, opps = opponentsOf();
  const [f, setF] = useState<ScheduleItem>({ id: "", date: todayISO(), time: "", opp: "", site: "home", event: "" });
  const [adding, setAdding] = useState(!items.length);
  const [pasting, setPasting] = useState(false), [paste, setPaste] = useState("");
  const parsed = pasting ? parseSchedule(paste) : [];
  const save = (list: ScheduleItem[]) => setTeamPatch({ schedule: list });
  const today = todayISO(), upcoming = items.filter((s) => s.date >= today), past = items.filter((s) => s.date < today);
  const start = (s: ScheduleItem) => { newMatch({ kind: "match", opp: s.opp, date: todayISO(), site: s.site, event: s.event, bestOf: t.settings.bestOf, serve: "us" }); save(items.filter((x) => x.id !== s.id)); setUi({ sel: null, panel: null, follow: null }); go("track"); };
  return <Card title="Schedule" actions={!adding && !pasting ? <div className="row" style={{ gap: 6 }}>{upcoming.length > 0 && <button className="btn sm ghost" onClick={() => { download(`${t.name} schedule.ics`.replace(/[^\w\- .]+/g, ""), scheduleIcs(upcoming, t.name), "text/calendar"); toast("Calendar file saved. Open it to add the games to your calendar, or send it to parents."); }}>Calendar</button>}<button className="btn sm" onClick={() => { setPasting(true); setAdding(false); }}>Paste schedule</button><button className="btn sm" onClick={() => { setAdding(true); setPasting(false); }}>Add match</button></div> : undefined}>
    <div className="stack">
      {pasting && <div className="stack">
        <label className="field"><span className="label">Paste your schedule, one match per line</span>
          <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Thu 9/4 vs Buchanan 6:00 PM\n9/9 @ Clovis West 5:30pm (League)\nSep 13 - Fresno Invitational"} autoFocus /></label>
        {paste.trim() && <p className="small muted" style={{ margin: 0 }}>{parsed.length ? `Found ${parsed.length} ${parsed.length === 1 ? "match" : "matches"}. Check them, then add.` : "No dates found yet. Each line needs a date like 9/4 or Sep 4."}</p>}
        {parsed.length > 0 && <ul className="mu-sched">{parsed.map((g, i) => <li key={i}><span className="mu-sched-main" style={{ cursor: "default" }}><span className="d"><b>{new Date(g.date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}</b>{new Date(g.date + "T12:00").toLocaleDateString([], { weekday: "short" })}</span>
          <span className="o"><b>{g.site === "away" ? "at " : g.site === "home" ? "vs " : ""}{g.opp}</b><small>{[g.time && fmtTime(g.time), g.event, g.site === "neutral" ? "Neutral" : ""].filter(Boolean).join(" · ")}</small></span></span></li>)}</ul>}
        <div className="row"><button className="btn primary" disabled={!parsed.length} onClick={() => {
          const have = new Set(items.map((x) => x.date + "|" + oppKey(x.opp)));
          const add = parsed.filter((g) => !have.has(g.date + "|" + oppKey(g.opp))).map((g) => { ensureOpponent(g.opp); return { id: uid("sc"), date: g.date, time: g.time, opp: g.opp, site: g.site, event: g.event } as ScheduleItem; });
          save(items.concat(add).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))); setPaste(""); setPasting(false);
          toast(add.length ? `Added ${add.length} ${add.length === 1 ? "match" : "matches"}${parsed.length > add.length ? ` (${parsed.length - add.length} already on the schedule)` : ""}` : "Those are already on the schedule");
        }}>Add {parsed.length || ""} to schedule</button><button className="btn" onClick={() => { setPasting(false); setPaste(""); }}>Cancel</button></div>
      </div>}
      {adding && <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!f.opp.trim()) return; ensureOpponent(f.opp.trim()); save(items.concat({ ...f, id: uid("sc"), opp: f.opp.trim() })); setF({ ...f, opp: "", event: "" }); setAdding(false); toast("Added to schedule"); }}>
        <label className="field"><span className="label">Opponent</span><input list="mu-opps" value={f.opp} onChange={(e) => setF({ ...f, opp: e.target.value })} placeholder="e.g. Buchanan" autoFocus /><datalist id="mu-opps">{opps.map((x) => <option key={x.id} value={x.name} />)}</datalist></label>
        <div className="two">
          <label className="field"><span className="label">Date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field"><span className="label">Time</span><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
        </div>
        <Seg value={f.site} onChange={(v) => setF({ ...f, site: v })} options={[["home", "Home"], ["away", "Away"], ["neutral", "Neutral"]]} label="Site" />
        <label className="field"><span className="label">Tournament or league (optional)</span><input value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })} /></label>
        <div className="row"><button className="btn primary" disabled={!f.opp.trim()}>Add to schedule</button><button type="button" className="btn" onClick={() => { setAdding(false); setPasting(true); }}>Paste a whole schedule</button>{items.length > 0 && <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>}</div>
      </form>}
      {upcoming.length ? <ul className="mu-sched">{upcoming.map((s) => { const sel = current && oppKey(current) === oppKey(s.opp); return <li key={s.id} className={sel ? "sel" : ""}>
        <button className="mu-sched-main" onClick={() => onOpen(s.opp)}><span className="d"><b>{new Date(s.date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}</b>{new Date(s.date + "T12:00").toLocaleDateString([], { weekday: "short" })}</span>
          <span className="o"><b>{s.site === "away" ? "at " : "vs "}{s.opp}</b><small>{[s.time && fmtTime(s.time), s.event].filter(Boolean).join(" · ") || (s.site ? s.site[0].toUpperCase() + s.site.slice(1) : "")}</small></span></button>
        <span className="row" style={{ flexWrap: "nowrap", gap: 4 }}>{s.date === today && <button className="btn sm primary" onClick={() => start(s)}>Start</button>}<ConfirmButton className="btn sm ghost" confirmText="Remove?" onConfirm={() => save(items.filter((x) => x.id !== s.id))}>✕</ConfirmButton></span>
      </li>; })}</ul> : !adding && <p className="empty">No upcoming matches. Add your schedule to get a matchup page before every game.</p>}
      {past.length > 0 && <p className="small muted">{past.length} past {past.length === 1 ? "entry" : "entries"} not started. <button className="btn sm ghost" onClick={() => save(upcoming)}>Clear</button></p>}
    </div>
  </Card>;
}
const fmtTime = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/* ---------- matchup ---------- */
function Matchup({ h, next }: { h: H2H; next?: ScheduleItem }) {
  const t = team()!, { o, games, A, season } = h;
  const won = games.filter((g) => g.R.matchOver && g.R.wonUs > g.R.wonThem).length, lost = games.filter((g) => g.R.matchOver && g.R.wonThem > g.R.wonUs).length;
  const setsW = games.reduce((n, g) => n + g.R.wonUs, 0), setsL = games.reduce((n, g) => n + g.R.wonThem, 0);
  const last = games[0];
  const startNow = () => { newMatch({ kind: "match", opp: o.name, date: todayISO(), site: next?.site || "", event: next?.event || "", bestOf: t.settings.bestOf, serve: "us" }); if (next && next.date === todayISO()) setTeamPatch({ schedule: (t.schedule || []).filter((x) => x.id !== next.id) }); setUi({ sel: null, panel: null, follow: null }); go("track"); };
  return <>
    <section className="card mu-hero">
      <div className="mu-hero-main">
        <div className="mu-vs">vs {o.name}</div>
        <p className="muted">{next ? <>Next: <b>{fmtDate(next.date)}</b>{next.time ? " · " + fmtTime(next.time) : ""}{next.site ? " · " + next.site : ""}{next.event ? " · " + next.event : ""}</> : games.length ? "No upcoming match scheduled." : "First time playing them."}</p>
      </div>
      {games.length > 0 && <div className="mu-rec">
        <div><b>{won}–{lost}</b><span>Matches</span></div>
        <div><b>{setsW}–{setsL}</b><span>Sets</span></div>
        <div><b>{A.us}–{A.them}</b><span>Points</span></div>
      </div>}
      <div className="row mu-actions">
        <button className="btn primary" onClick={startNow}>Start match vs {o.name}</button>
        {games.length > 0 && <button className="btn" onClick={() => { download(`${t.name} vs ${o.name} scouting sheet.html`.replace(/[^\w\- .]+/g, ""), scoutingSheet(h), "text/html"); toast("Scouting sheet saved. Open it to print or share with your staff."); }}>Scouting sheet</button>}
        <button className="btn" onClick={() => { setUi({ courtTab: "tendency" }); go("court", o.id); }}>Tendency court</button>
      </div>
    </section>
    {!games.length ? <GamePlan o={o} h={h} /> : <>
      <Compare A={A} season={season} />
      <div className="grid2" style={{ alignItems: "start" }}>
        <Threats A={A} o={o} />
        <Card title="Past results">
          <ul className="log">{games.map(({ m, R }) => <li key={m.id} className="click" style={{ gridTemplateColumns: "1fr auto auto", cursor: "pointer" }} onClick={() => { setUi({ statsScope: "m:" + m.id }); go("stats"); }}>
            <span>{fmtDate(m.date)}{m.event ? <span className="muted"> · {m.event}</span> : null}</span><span className="small muted">{R.sets.map((s) => s.us + "-" + s.them).join(", ")}</span>
            <b style={{ color: R.wonUs > R.wonThem ? "var(--us)" : "var(--muted)" }}>{resultOf(R) ? resultOf(R) + " " : ""}{R.wonUs}–{R.wonThem}</b></li>)}</ul>
          <p className="keys" style={{ marginTop: 8 }}>{last ? `Last met ${fmtDate(last.m.date)}. ` : ""}Tap a match for its full stats.</p>
        </Card>
      </div>
      <Tendency A={A} name={o.name} />
      <div className="grid2" style={{ alignItems: "start" }}>
        <Rotations A={A} />
        <TheirRotations A={A} />
        <OurPlayers A={A} />
      </div>
      <GamePlan o={o} h={h} />
    </>}
    <Card title="Notes"><textarea className="input" aria-label="Scouting notes" rows={3} key={o.id} defaultValue={o.notes} placeholder="Best hitters, setter tendencies, serve targets, what worked last time…" onBlur={(e) => patch("opponents", o.id, { notes: e.target.value })} /></Card>
    <AiCard key={"ai" + o.id} title={`Scouting report: ${o.name}`} desc="A pre-match report from every match you've recorded against them plus your notes. Saved for next time." button="Write scouting report" prompt={() => scoutPrompt(o.name)} saved={o.scout} savedAt={o.scoutAt} onSave={(text) => patch("opponents", o.id, { scout: text, scoutAt: Date.now() })} filename={o.name + " scouting report"} />
  </>;
}

/* Our numbers against them vs our season average. */
function Compare({ A, season }: { A: Agg; season: Agg }) {
  const M = teamMetrics(A), S = teamMetrics(season);
  const per = (a: Agg, n: number) => (a.sets ? n / a.sets : null);
  const rows: [string, number | null, number | null, (v: number | null) => string, boolean][] = [
    ["Hitting %", M.hitting, S.hitting, fmtHit, true],
    ["Side-out %", M.sideOut, S.sideOut, fmtPct, true],
    ["Point-scoring %", M.pointScoring, S.pointScoring, fmtPct, true],
    ["Pass average", M.passAvg, S.passAvg, (v) => fmtAvg(v), true],
    ["Serve in %", M.serveIn, S.serveIn, fmtPct, true],
    ["Aces per set", per(A, A.T.SA), per(season, season.T.SA), (v) => fmtNum(v, 2), true],
    ["Blocks per set", per(A, blocks(A.T)), per(season, blocks(season.T)), (v) => fmtNum(v, 2), true],
    ["Errors per set", M.perSet?.errors ?? null, S.perSet?.errors ?? null, (v) => fmtNum(v, 1), false],
    ["Their kills per set", per(A, A.team.OK), per(season, season.team.OK), (v) => fmtNum(v, 1), false],
  ];
  return <Card title="Against them vs your season">
    <div className="mu-compare">{rows.map(([l, a, s, f, up]) => {
      const d = a != null && s != null ? a - s : null, better = d != null && f(a) !== f(s) ? (d > 0) === up : null;
      return <div key={l} className="mu-cmp">
        <span className="l">{l}</span><b>{f(a)}</b>
        <span className={"d " + (better === true ? "up" : better === false ? "down" : "")}>{d == null || better === null ? "same as season" : `${better ? "▲" : "▼"} vs ${f(s)} season`}</span>
      </div>; })}</div>
  </Card>;
}

function Threats({ A, o }: { A: Agg; o: Opponent }) {
  const ro = o.roster || {};
  const setName = (n: string, field: "name" | "pos", v: string) => patch("opponents", o.id, { roster: { ...ro, [n]: { ...ro[n], [field]: v } } });
  const rows = Object.entries(A.opp).map(([n, x]) => ({ n, ...x, pts: x.K + x.A })).sort((a, b) => b.pts - a.pts || a.E - b.E).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.pts));
  return <Card title="Their threats">
    {rows.length ? <div className="tbl"><table>
      <thead><tr><th className="l">#</th><th className="l">Name · pos</th><th className="l" style={{ width: "24%" }}>Points</th><th>K</th><th>Ace</th><th>Err</th><th className="l">Hot zone</th></tr></thead>
      <tbody>{rows.map((r) => { const z = Object.entries(r.z).filter((x) => x[0] !== "out").sort((a, b) => b[1] - a[1])[0];
        return <tr key={r.n}><td className="l"><b>#{r.n}</b></td><td className="l"><input className="input mu-name" key={o.id + r.n} defaultValue={[ro[r.n]?.name, ro[r.n]?.pos].filter(Boolean).join(" · ")} placeholder="Add name" aria-label={`Name for their #${r.n}`} onBlur={(e) => { const [nm, ...ps] = e.target.value.split("·").map((x) => x.trim()); setName(r.n, "name", nm || ""); if (ps.length) setName(r.n, "pos", ps.join(" ")); }} /></td><td className="l"><div className="mu-bar"><i style={{ width: (100 * r.pts) / max + "%" }} /></div></td><td>{r.K}</td><td>{r.A}</td><td>{r.E}</td><td className="l">{z ? "Z" + z[0] : "—"}</td></tr>; })}</tbody>
    </table></div> : <p className="empty">Tap their jersey number after their kills and aces to see who hurts you.</p>}
  </Card>;
}

function Tendency({ A, name }: { A: Agg; name: string }) {
  const [view, setView] = useState<"theirAttack" | "theirServe" | "ourAttack" | "ourServe">("theirAttack");
  const T = tendencies(A.locs, view), half = view.startsWith("their") ? "us" : "them";
  const byZone: Record<string, number> = {}; for (const z of ALL_ZONES) byZone[z] = T.zones[z]?.total || 0;
  return <Card title="Where the points go" actions={<Seg value={view} onChange={setView} options={[["theirAttack", "Their attacks"], ["theirServe", "Their serves"], ["ourAttack", "Our attacks"], ["ourServe", "Our serves"]]} />}>
    <div className="mu-tend">
      <CourtSvg half={half} counts={{ half, byZone, total: T.total, heat: true }} labels={half === "us" ? { bottom: team()!.name } : { top: name }} label="Zone heat map" />
      <div className="stack"><p className="small muted">{T.total} marked against {name}.</p><ul className="recs">{T.recs.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
    </div>
  </Card>;
}

function Rotations({ A }: { A: Agg }) {
  let mx = 1; for (let r = 1; r <= 6; r++) mx = Math.max(mx, Math.abs(A.rot[r].w - A.rot[r].l));
  return <Card title="Our rotations against them">
    <div className="tbl"><table><thead><tr><th className="l">Rotation</th><th>W–L</th><th style={{ width: "34%" }} /><th>Side-out</th></tr></thead>
      <tbody>{[1, 2, 3, 4, 5, 6].map((r) => { const x = A.rot[r], net = x.w - x.l; return <tr key={r}><td className="l"><b>R{r}</b></td><td>{x.w}–{x.l}</td><td><Diverge v={net} max={mx} /></td><td>{fmtPct(ratio(x.rw, x.rn))}</td></tr>; })}</tbody></table></div>
  </Card>;
}

function OurPlayers({ A }: { A: Agg }) {
  const rows = teamPlayers().filter((p) => A.ps[p.id]).map((p) => ({ p, s: A.ps[p.id], pm: playerMetrics(A, p.id) })).sort((a, b) => b.pm.netPoints - a.pm.netPoints).slice(0, 6);
  return <Card title="Our best against them">
    {rows.length ? <div className="tbl"><table><thead><tr><th className="l">Player</th><th>K</th><th>Hit %</th><th>Aces</th><th>Digs</th><th>Net pts</th></tr></thead>
      <tbody>{rows.map(({ p, s, pm }) => <tr key={p.id} className="click" onClick={() => go("player", p.id)}><td className="l">{playerName(p.id)}</td><td>{s.K}</td><td>{fmtHit(hitting(s))}</td><td>{s.SA}</td><td>{s.D}</td><td><b>{fmtSigned(pm.netPoints)}</b></td></tr>)}</tbody></table></div> : <p className="empty">No player stats against them yet.</p>}
  </Card>;
}

/* Suggested keys from the data, plus the coach's own checklist. */
function suggestions(h: H2H): string[] {
  const { A, season } = h, out: string[] = [];
  if (!h.games.length) return ["Serve tough to their weakest passer early; find out who it is in the first rotation.", "Track their jersey numbers on kills so next time you know who to stop."];
  const top = Object.entries(A.opp).sort((a, b) => b[1].K - a[1].K)[0];
  if (top && top[1].K >= 3) { const z = Object.entries(top[1].z).filter((x) => x[0] !== "out").sort((a, b) => b[1] - a[1])[0]; out.push(`Stop #${top[0]}: ${top[1].K} kills against us${z ? `, mostly to zone ${z[0]}` : ""}. Put your best blocker on that hitter and a defender in that zone.`); }
  const ta = tendencies(A.locs, "theirAttack").recs[0]; if (ta && !/Only|No locations/.test(ta)) out.push(ta);
  let worst = 0, wv = 0; for (let r = 1; r <= 6; r++) { const x = A.rot[r]; if (x.w - x.l < wv) { wv = x.w - x.l; worst = r; } }
  if (worst) out.push(`Rotation ${worst} is ${fmtSigned(wv)} against them. Have a sub or a serve-receive adjustment ready.`);
  const M = teamMetrics(A), S = teamMetrics(season);
  if (M.passAvg != null && S.passAvg != null && M.passAvg < S.passAvg - 0.1) out.push(`We pass ${fmtAvg(M.passAvg)} against them vs ${fmtAvg(S.passAvg)} normally. Their serve is a weapon: tighten serve receive.`);
  if (M.serveIn != null && M.serveIn < 0.88) out.push(`We served ${fmtPct(M.serveIn)} in against them (${serveErrors(A.T)} misses). Serve in and make them run their offense.`);
  const os = tendencies(A.locs, "ourServe").recs[0]; if (os && !/Only|No locations/.test(os)) out.push(os);
  return out.slice(0, 5);
}

function GamePlan({ o, h }: { o: Opponent; h: H2H }) {
  const plan = o.plan || [], [text, setText] = useState("");
  const set = (p: PlanItem[]) => patch("opponents", o.id, { plan: p });
  const sug = suggestions(h).filter((s) => !plan.some((p) => p.text === s));
  return <Card title="Game plan" actions={plan.length ? <button className="btn sm ghost" onClick={() => set(plan.map((p) => ({ ...p, done: false })))}>Uncheck all</button> : undefined}>
    <div className="stack">
      {plan.length ? <ul className="mu-plan">{plan.map((p) => <li key={p.id}>
        <label><input type="checkbox" checked={!!p.done} onChange={(e) => set(plan.map((x) => (x.id === p.id ? { ...x, done: e.target.checked } : x)))} /><span className={p.done ? "done" : ""}>{p.text}</span></label>
        <button className="btn sm ghost" aria-label="Remove" onClick={() => set(plan.filter((x) => x.id !== p.id))}>✕</button></li>)}</ul>
        : <p className="small muted">Your keys to beating {o.name}. Saved with the opponent so they're here every time you play them.</p>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; set(plan.concat({ id: uid("gp"), text: text.trim() })); setText(""); }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a key, e.g. Serve #4 short in rotation 2" aria-label="New game plan item" />
        <button className="btn sm" disabled={!text.trim()}>Add</button>
      </form>
      {sug.length > 0 && <div><div className="label" style={{ marginBottom: 6 }}>Suggested from the stats</div>
        <ul className="mu-sug">{sug.map((s, i) => <li key={i}><span>{s}</span><button className="btn sm" onClick={() => set(plan.concat({ id: uid("gp"), text: s }))}>Add</button></li>)}</ul></div>}
    </div>
  </Card>;
}

/* One-page sheet for the bench and assistants. */
function scoutingSheet(h: H2H): string {
  const t = team()!, { o, games, A, season } = h, M = teamMetrics(A), S = teamMetrics(season);
  const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const won = games.filter((g) => g.R.matchOver && g.R.wonUs > g.R.wonThem).length, lost = games.filter((g) => g.R.matchOver && g.R.wonThem > g.R.wonUs).length;
  const threats = Object.entries(A.opp).sort((a, b) => b[1].K + b[1].A - (a[1].K + a[1].A)).slice(0, 6).map(([n, x]) => { const z = Object.entries(x.z).filter((q) => q[0] !== "out").sort((a, b) => b[1] - a[1])[0]; return `<tr><td>#${esc(n)} ${esc(o.roster?.[n]?.name || "")}${o.roster?.[n]?.pos ? " (" + esc(o.roster[n].pos) + ")" : ""}</td><td>${x.K}</td><td>${x.A}</td><td>${x.E}</td><td>${z ? "Zone " + z[0] : "–"}</td></tr>`; }).join("");
  const rots = [1, 2, 3, 4, 5, 6].map((r) => `<td>${A.rot[r].w}–${A.rot[r].l}</td>`).join("");
  const plan = (o.plan || []).map((p) => `<li>${esc(p.text)}</li>`).join("") || suggestions(h).map((s) => `<li>${esc(s)}</li>`).join("");
  const recs = (v: "theirAttack" | "theirServe") => tendencies(A.locs, v).recs.map((r) => `<li>${esc(r)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.name)} vs ${esc(o.name)} scouting</title>
<style>:root{--c:#2B79B0;--ink:#0B0C0E;--mut:#686E77;--line:#E2E4E8}*{box-sizing:border-box}body{margin:0;color:var(--ink);font:13.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:#fff}main{max-width:820px;margin:0 auto;padding:20px 16px}
h1{margin:0;font-size:26px}h2{font-size:12px;letter-spacing:.06em;color:var(--mut);margin:16px 0 6px;text-transform:uppercase}.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:3px solid var(--c);padding-bottom:10px}
.rec{display:flex;gap:18px}.rec b{display:block;font-size:22px}.rec span{color:var(--mut);font-size:12px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left}th{font-size:11.5px;color:var(--mut)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}ul{margin:0;padding-left:18px}li{margin:3px 0}@media(max-width:640px){.cols{grid-template-columns:1fr}}@media print{main{padding:0}}</style></head><body><main>
<div class="top"><div><h1>${esc(t.name)} vs ${esc(o.name)}</h1><div style="color:var(--mut)">Scouting sheet · ${new Date().toLocaleDateString()}</div></div>
<div class="rec"><div><b>${won}–${lost}</b><span>Matches</span></div><div><b>${games.reduce((n, g) => n + g.R.wonUs, 0)}–${games.reduce((n, g) => n + g.R.wonThem, 0)}</b><span>Sets</span></div><div><b>${fmtHit(M.hitting)}</b><span>Our hitting vs them (${fmtHit(S.hitting)} season)</span></div></div></div>
<h2>Keys to the match</h2><ul>${plan}</ul>
<div class="cols"><div><h2>Their threats</h2><table><thead><tr><th>#</th><th>Kills</th><th>Aces</th><th>Errors</th><th>Kills land</th></tr></thead><tbody>${threats || "<tr><td colspan=5>No numbers tracked.</td></tr>"}</tbody></table></div>
<div><h2>Our rotations vs them</h2><table><thead><tr>${[1, 2, 3, 4, 5, 6].map((r) => `<th>R${r}</th>`).join("")}</tr></thead><tbody><tr>${rots}</tr></tbody></table>
<h2>Side-out by our pass</h2><table><tbody><tr><td>3 pass ${fmtPct(M.soByPass.P3)}</td><td>2 pass ${fmtPct(M.soByPass.P2)}</td><td>1 pass ${fmtPct(M.soByPass.P1)}</td></tr></tbody></table></div></div>
<div class="cols"><div><h2>Their attack</h2><ul>${recs("theirAttack")}</ul></div><div><h2>Their serve</h2><ul>${recs("theirServe")}</ul></div></div>
${o.notes ? `<h2>Notes</h2><p>${esc(o.notes)}</p>` : ""}
<h2>Past results</h2><table><tbody>${games.map(({ m, R }) => `<tr><td>${esc(m.date)}</td><td>${R.wonUs}–${R.wonThem}</td><td>${R.sets.map((s) => s.us + "-" + s.them).join(", ")}</td></tr>`).join("")}</tbody></table>
<p style="color:var(--mut);margin-top:18px;font-size:12px">Made with Benchboard</p></main></body></html>`;
}

/* ---------- in-match panel on the Track screen ---------- */
export function PlanPanel({ m, onClose }: { m: Match; onClose: () => void }) {
  const o = opponentsOf().find((x) => oppKey(x.name) === oppKey(m.opp));
  const R = replayOf(m), today = R ? aggregate(R.sets) : null;
  const past = o ? (() => { const h = headToHead(o); h.games = h.games.filter((g) => g.m.id !== m.id); h.A = aggregate(h.games.flatMap((g) => g.R.sets)); return h; })() : null;
  const top = (A: Agg | null) => (A ? Object.entries(A.opp).map(([n, x]) => ({ n, pts: x.K + x.A, ...x })).filter((x) => x.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 3) : []);
  const plan = o?.plan || [];
  const zoneOf = (z: Record<string, number>) => { const t = Object.entries(z).filter((q) => q[0] !== "out").sort((a, b) => b[1] - a[1])[0]; return t ? " · Z" + t[0] : ""; };
  return <div className="editor">
    <div className="row between"><b>Game plan vs {m.opp}</b><span className="row" style={{ gap: 6 }}>{o && <button className="btn sm" onClick={() => go("matchup", o.id)}>Full matchup</button>}<button className="btn sm" onClick={onClose}>Close</button></span></div>
    {plan.length ? <ul className="mu-plan">{plan.map((p) => <li key={p.id}><label><input type="checkbox" checked={!!p.done} onChange={(e) => o && patch("opponents", o.id, { plan: plan.map((x) => (x.id === p.id ? { ...x, done: e.target.checked } : x)) })} /><span className={p.done ? "done" : ""}>{p.text}</span></label></li>)}</ul>
      : <p className="small muted">No game plan saved for {m.opp}. Add keys on the Matchups tab before the match.</p>}
    <div className="two">
      <div><div className="label" style={{ marginBottom: 4 }}>Hurting us today</div>{top(today).length ? top(today).map((x) => <div key={x.n} className="small"><b>#{x.n}{o?.roster?.[x.n]?.name ? " " + o.roster[x.n].name : ""}</b> {x.K} kills, {x.A} aces{zoneOf(x.z)}</div>) : <p className="small muted">Nobody yet. Tap their number after their kills.</p>}</div>
      <div><div className="label" style={{ marginBottom: 4 }}>Past matches vs them</div>{past && top(past.A).length ? top(past.A).map((x) => <div key={x.n} className="small"><b>#{x.n}{o?.roster?.[x.n]?.name ? " " + o!.roster![x.n].name : ""}</b> {x.K} kills, {x.A} aces{zoneOf(x.z)}</div>) : <p className="small muted">No history yet.</p>}</div>
    </div>
  </div>;
}

/** .ics file so coaches and parents can put the schedule in any calendar app. */
function scheduleIcs(items: ScheduleItem[], teamName: string): string {
  const esc = (x: string) => x.replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const d = (s: string) => s.replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ev = items.map((s) => {
    const title = `${teamName} ${s.site === "away" ? "at" : "vs"} ${s.opp}`;
    let when: string;
    if (s.time) { const [h, m] = s.time.split(":").map(Number); const start = `${d(s.date)}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`; const endH = h + 2; const end = `${d(s.date)}T${String(Math.min(endH, 23)).padStart(2, "0")}${String(m).padStart(2, "0")}00`; when = `DTSTART:${start}\r\nDTEND:${end}`; }
    else { const nd = new Date(s.date + "T12:00"); nd.setDate(nd.getDate() + 1); when = `DTSTART;VALUE=DATE:${d(s.date)}\r\nDTEND;VALUE=DATE:${nd.toISOString().slice(0, 10).replace(/-/g, "")}`; }
    return `BEGIN:VEVENT\r\nUID:${s.id}@benchboard\r\nDTSTAMP:${stamp}\r\n${when}\r\nSUMMARY:${esc(title)}\r\n${s.event ? "DESCRIPTION:" + esc(s.event) + "\r\n" : ""}END:VEVENT`;
  }).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Benchboard//Schedule//EN\r\nCALSCALE:GREGORIAN\r\n${ev}\r\nEND:VCALENDAR\r\n`;
}
