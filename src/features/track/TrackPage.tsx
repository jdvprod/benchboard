import { useState } from "react";
import { activePlayers, currentMatch, ensureOpponent, matchesOf, newMatch, oppKey, opponentsOf, setOppRoster, team, todayISO } from "../../data/store";
import { OppRosterEditor } from "../matchup/OppRoster";
import { OppRoster } from "../../data/model";
import { Card, fmtDate, Seg } from "../../ui/kit";
import { Tracker } from "./Tracker";
import { go } from "../../app/router";
import { setUi } from "../../app/ui";
import { Home } from "../home/Home";

export function TrackPage() {
  const m = currentMatch();
  if (m && m.kind !== "match") return <div className="page">
    <div className="banner accent"><p><b>A practice is in progress:</b> {m.opp}. Track it from the Practice tab, or start a match below.</p><button className="btn primary" onClick={() => go("practice")}>Go to practice</button></div>
    <StartMatch />
  </div>;
  if (m) return <div className="page"><Tracker m={m} /></div>;
  return <div className="page"><Home /></div>;
}

export const FORMATS: [number, string][] = [[3, "Best of 3"], [5, "Best of 5"], [2, "2 sets (pool)"]];
export const SCORING: [string, string][] = [["25", "Sets to 25"], ["25c27", "To 25, cap 27"], ["21", "Sets to 21"], ["21c23", "To 21, cap 23"]];
export const parseScoring = (v: string) => { const [to, cap] = v.split("c").map(Number); return { setTo: to || 25, cap: cap || null }; };
export function StartMatch({ formOnly }: { formOnly?: boolean } = {}) {
  const t = team()!, opps = opponentsOf();
  const [opp, setOpp] = useState(""), [date, setDate] = useState(todayISO()), [site, setSite] = useState<"home" | "away" | "neutral">("home");
  const [ro, setRo] = useState<OppRoster | null>(null), [showRo, setShowRo] = useState(false);
  const known = opps.find((o) => opp.trim() && oppKey(o.name) === oppKey(opp)), roster = ro ?? known?.roster ?? {};
  const [event, setEvent] = useState(""), [bestOf, setBestOf] = useState(t.settings.bestOf), [scoring, setScoring] = useState(t.settings.scoring || "25");
  const upcoming = (t.schedule || []).filter((x) => x.date >= todayISO()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3);
  const recent = matchesOf().filter((x) => x.kind === "match" && x.status === "done").slice(0, 3);
  const start = (serve: "us" | "them") => {
    if (ro && opp.trim()) setOppRoster(opp.trim(), ro);
    newMatch({ kind: "match", opp: opp.trim() || "Opponent", date, site, event: event.trim(), bestOf, serve, ...parseScoring(scoring) });
    setUi({ sel: null, panel: null, follow: null });
  };
  const form = <Card title="Start a match" id="start-match">
      <div className="stack">
        {!activePlayers().length && <div className="banner warn"><p>Add your roster first so you can record stats for each player.</p><button className="btn sm" onClick={() => go("team")}>Add players</button></div>}
        <label className="field"><span className="label">Opponent</span><input list="opp-list" value={opp} onChange={(e) => setOpp(e.target.value)} placeholder="e.g. Buchanan" /><datalist id="opp-list">{opps.map((o) => <option key={o.id} value={o.name} />)}</datalist></label>
        <div className="two">
          <label className="field"><span className="label">Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span className="label">Tournament or league (optional)</span><input value={event} onChange={(e) => setEvent(e.target.value)} /></label>
        </div>
        <div className="row"><Seg value={site} onChange={setSite} options={[["home", "Home"], ["away", "Away"], ["neutral", "Neutral"]]} label="Site" /><Seg value={bestOf} onChange={setBestOf} options={FORMATS} label="Format" />
          <select className="input" style={{ width: "auto" }} value={scoring} onChange={(e) => setScoring(e.target.value)} aria-label="Scoring">{SCORING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="opr-wrap">
          <button className="btn sm ghost" aria-expanded={showRo} onClick={() => setShowRo(!showRo)}>{showRo ? "Hide their roster" : `Their roster (optional)${Object.keys(roster).length ? `: ${Object.keys(roster).length} players` : ""}`}</button>
          {showRo && <OppRosterEditor roster={roster} onChange={setRo} team={opp.trim() || "the other team"} />}
        </div>
        <p className="small muted">{t.defLineup ? "Your default lineup starts the first set. Change it on the Lineup tab." : "Tip: set a default lineup on the Lineup tab to track rotations and servers automatically."}</p>
        <div className="row"><button className="btn primary" onClick={() => start("us")}>Start · we serve first</button><button className="btn" onClick={() => start("them")}>Start · they serve first</button></div>
      </div>
    </Card>;
  if (formOnly) return form;
  return <div className="grid2" style={{ alignItems: "start" }}>
    {form}
    <div className="stack">
      <Card title="Recent matches">{recent.length ? <ul className="log">{recent.map((x) => <li key={x.id}><span>{fmtDate(x.date)} vs {x.opp}</span><span /><span /></li>)}</ul> : <p className="empty">Matches you track show up here and on the Stats tab.</p>}</Card>
      <Card title="Up next" actions={<button className="btn sm" onClick={() => go("matchup")}>Schedule</button>}>{upcoming.length ? <ul className="mu-sched">{upcoming.map((s) => <li key={s.id}>
        <button className="mu-sched-main" onClick={() => { const o = ensureOpponent(s.opp); go("matchup", o.id); }}><span className="d"><b>{new Date(s.date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}</b>{new Date(s.date + "T12:00").toLocaleDateString([], { weekday: "short" })}</span><span className="o"><b>{s.site === "away" ? "at " : "vs "}{s.opp}</b><small>See the matchup</small></span></button>
        {s.date === todayISO() && <button className="btn sm primary" onClick={() => { setOpp(s.opp); setSite((s.site || "home") as any); setEvent(s.event); }}>Use</button>}</li>)}</ul>
        : <p className="empty">Add your schedule on the Matchups tab to get a scouting page before every game.</p>}</Card>
    </div>
  </div>;
}
