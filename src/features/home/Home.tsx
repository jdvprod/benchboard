/** Home (the Track tab when no match is live): next match, last match, season snapshot, what to work on. */
import { useState } from "react";
import { ensureOpponent, matchesOf, newMatch, oppKey, playerName, replayOf, setTeamPatch, team, teamPlayers, todayISO } from "../../data/store";
import { cloudAvailable, currentUser } from "../../cloud/client";
import { isLinked } from "../../cloud/sync";
import { aggregate, resultOf } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, teamMetrics } from "../../sports/volleyball/metrics";
import { Card, fmtDate, plural } from "../../ui/kit";
import { go } from "../../app/router";
import { setUi } from "../../app/ui";
import { StartMatch } from "../track/TrackPage";
import { focusAreas } from "../practice/PracticePage";
import { matchReportHtml } from "../stats/matchReport";
import { download } from "../../ui/kit";
import { shareFinalGraphic } from "../stats/finalGraphic";

const fmtTime = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

function Spark({ vals }: { vals: (number | null)[] }) {
  const v = vals.filter((x): x is number => x != null); if (v.length < 2) return null;
  const W = 96, H = 28, lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const pts = vals.map((x, i) => (x == null ? null : [(i / (vals.length - 1)) * W, H - 3 - ((x - lo) / r) * (H - 6)] as [number, number])).filter(Boolean) as [number, number][];
  const last = pts[pts.length - 1];
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><path d={pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("")} /><circle cx={last[0]} cy={last[1]} r="2.6" /></svg>;
}

export function Home() {
  const t = team()!, today = todayISO();
  const games = matchesOf().filter((m) => m.kind === "match" && (!t.activeSeasonId || m.seasonId === t.activeSeasonId)).map((m) => ({ m, R: replayOf(m)! })).filter((x) => x.R && x.R.sets.length);
  const done = games.filter((g) => (g.R.matchOver || g.m.status === "done") && !g.m.imported?.season && g.R.sets.some((s) => s.us + s.them > 0));
  const W = done.filter((g) => g.R.wonUs > g.R.wonThem).length, L = done.filter((g) => g.R.wonThem > g.R.wonUs).length, T = done.filter((g) => g.R.matchOver && g.R.wonUs === g.R.wonThem).length;
  const last = done[0];
  const next = (t.schedule || []).filter((s) => s.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const vsNext = next ? games.filter((g) => oppKey(g.m.opp) === oppKey(next.opp)) : [];
  const A = aggregate(games.flatMap((g) => g.R.sets)), M = teamMetrics(A);
  const chron = games.slice().reverse().slice(-6).map((g) => teamMetrics(aggregate(g.R.sets)));
  const focus = games.length ? focusAreas().slice(0, 3) : [];
  const leaders = (f: (s: any) => number) => Object.entries(A.ps).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0];
  const startNext = () => { if (!next) return; newMatch({ kind: "match", opp: next.opp, date: today, site: next.site, event: next.event, bestOf: t.settings.bestOf, serve: "us" }); if (next.date === today) setTeamPatch({ schedule: (t.schedule || []).filter((x) => x.id !== next.id) }); setUi({ sel: null, panel: null, follow: null }); };
  const lastA = last ? aggregate(last.R.sets) : null, lastM = lastA ? teamMetrics(lastA) : null;
  const star = lastA ? Object.entries(lastA.ps).map(([id, s]) => [id, s.K + s.SA + s.BS + s.BA / 2 - s.AE - s.SE - s.SEN - s.SEO] as [string, number]).sort((a, b) => b[1] - a[1])[0] : null;

  return <div className="stack">
    <div className="home-head">
      <div><h1>{t.name}</h1><p className="muted">{t.level}{done.length ? ` · ${W}–${L}${T ? "–" + T : ""} this season` : ""}</p></div>
      <button className="btn primary" onClick={() => document.getElementById("start-match")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Start a match</button>
    </div>
    <Setup />
    <div className="home-top">
      <section className="card home-next">
        <div className="label">Next match</div>
        {next ? <>
          <div className="home-opp">{next.site === "away" ? "at " : "vs "}{next.opp}</div>
          <p className="muted">{next.date === today ? "Today" : fmtDate(next.date)}{next.time ? " · " + fmtTime(next.time) : ""}{next.event ? " · " + next.event : ""}</p>
          <p className="small">{vsNext.length ? `You're ${vsNext.filter((g) => g.R.wonUs > g.R.wonThem && g.R.matchOver).length}–${vsNext.filter((g) => g.R.wonThem > g.R.wonUs && g.R.matchOver).length} against them this season.` : "First meeting this season."}</p>
          <div className="row"><button className="btn sm" onClick={() => go("matchup", ensureOpponent(next.opp).id)}>See the matchup</button>{next.date === today && <button className="btn sm primary" onClick={startNext}>Start now</button>}</div>
        </> : <><p className="muted" style={{ margin: "6px 0 10px" }}>Nothing scheduled.</p><button className="btn sm" onClick={() => go("matchup")}>Add your schedule</button></>}
      </section>
      <section className="card home-last">
        <div className="label">Last match</div>
        {last && lastM ? <>
          <div className="home-opp"><span className={resultOf(last.R) === "W" ? "w" : resultOf(last.R) === "L" ? "l" : ""}>{resultOf(last.R) || ""}</span> {last.R.wonUs}–{last.R.wonThem} vs {last.m.opp}</div>
          <p className="muted">{fmtDate(last.m.date)} · {last.R.sets.map((s) => `${s.us}-${s.them}`).join(", ")}{!last.R.matchOver ? " · ended early" : ""}</p>
          <p className="small">Hitting {fmtHit(lastM.hitting)} · side-out {fmtPct(lastM.sideOut)} · pass {fmtAvg(lastM.passAvg)}{star && star[1] > 0 ? ` · Top: ${playerName(star[0])}` : ""}</p>
          <div className="row"><button className="btn sm" onClick={() => { setUi({ statsScope: "m:" + last.m.id }); go("stats"); }}>Full stats</button><button className="btn sm" onClick={() => download(`${t.name} vs ${last.m.opp} ${last.m.date} report.html`.replace(/[^\w\- .]+/g, ""), matchReportHtml(last.m, last.R), "text/html")}>Match report</button><button className="btn sm" onClick={() => shareFinalGraphic(last.m, last.R)}>Share graphic</button></div>
        </> : <p className="muted" style={{ marginTop: 6 }}>Your most recent result shows up here.</p>}
      </section>
    </div>
    {games.length > 0 && <section className="card">
      <div className="row between" style={{ marginBottom: 10 }}><h3>Season so far</h3><button className="btn sm ghost" onClick={() => { setUi({ statsScope: "season" }); go("stats"); }}>All stats</button></div>
      <div className="home-kpis">
        {([["Hitting", fmtHit(M.hitting), chron.map((x) => x.hitting)], ["Side-out", fmtPct(M.sideOut), chron.map((x) => x.sideOut)], ["Pass avg", fmtAvg(M.passAvg), chron.map((x) => x.passAvg)], ["Serve in", fmtPct(M.serveIn), chron.map((x) => x.serveIn)]] as [string, string, (number | null)[]][]).map(([l, v, sp]) =>
          <div key={l} className="home-kpi"><span className="label">{l}</span><b>{v}</b><Spark vals={sp} /></div>)}
        <div className="home-kpi"><span className="label">Leaders</span>
          {[["K", (s: any) => s.K], ["Aces", (s: any) => s.SA], ["Digs", (s: any) => s.D]].map(([l, f]) => { const x = leaders(f as any); return x ? <span key={l as string} className="small"><b>{x[1]}</b> {l as string} · {playerName(x[0])}</span> : null; })}</div>
      </div>
    </section>}
    {games.length > 0 && <TeamGoals M={M} />}
    {focus.length > 0 && <Card title="What to work on" actions={<button className="btn sm" onClick={() => go("practice")}>Plan practice</button>}>
      <ul className="recs">{focus.map((f, i) => <li key={i}><span><b>{f.cat}:</b> {f.text}</span></li>)}</ul>
    </Card>}
    <StartMatch formOnly />
  </div>;
}

const TARGETS: ["hitting" | "sideOut" | "pointScoring" | "passAvg" | "serveIn" | "firstBallSO", string, number, (v: number | null) => string, number][] = [
  ["hitting", "Hitting %", 0.25, fmtHit, 0.001], ["sideOut", "Side-out", 0.6, fmtPct, 0.01], ["pointScoring", "Point-scoring", 0.45, fmtPct, 0.01],
  ["passAvg", "Pass average", 2.2, (v) => fmtAvg(v), 0.01], ["serveIn", "Serve in", 0.9, fmtPct, 0.01], ["firstBallSO", "First-ball side-out", 0.35, fmtPct, 0.01],
];
function TeamGoals({ M }: { M: ReturnType<typeof teamMetrics> }) {
  const t = team()!, tg = t.targets || {};
  const [edit, setEdit] = useState(false);
  const active = TARGETS.filter(([k]) => tg[k] != null);
  const list = active.length ? active : TARGETS.slice(0, 4);
  return <Card title="Team goals" actions={<button className="btn sm ghost" onClick={() => setEdit(!edit)}>{edit ? "Done" : active.length ? "Edit" : "Set goals"}</button>}>
    {edit ? <div className="pf-grid">{TARGETS.map(([k, label, def, f]) => <label key={k} className="field"><span className="label">{label}</span>
      <input inputMode="decimal" defaultValue={tg[k] != null ? (k === "hitting" ? String(tg[k]).replace(/^0/, "") : k === "passAvg" ? String(tg[k]) : Math.round(tg[k]! * 100) + "%") : ""} placeholder={"e.g. " + f(def)}
        onBlur={(e) => { const raw = e.target.value.trim(); const n = { ...tg }; if (!raw) delete n[k]; else { let v = parseFloat(raw.replace("%", "")); if (k !== "hitting" && k !== "passAvg" && v > 1) v /= 100; if (isFinite(v)) n[k] = v; } setTeamPatch({ targets: n }); }} /></label>)}</div>
      : <div className="goals-grid">{list.map(([k, label, def, f]) => { const target = tg[k] ?? def, v = (M as any)[k] as number | null, hit = v != null && v >= target, prog = v == null ? 0 : Math.max(0, Math.min(1, target > 0 ? v / target : 0));
        return <div key={k} className="goal"><div className="row between"><span><b>{label}</b> <span className="small muted">goal {f(target)}</span></span><span className={hit ? "hi" : ""}>{f(v)}{hit ? " ✓" : ""}</span></div><div className="meter"><i style={{ width: prog * 100 + "%" }} /></div></div>; })}
        {!active.length && <p className="small muted">Suggested goals. Tap Set goals to make them yours.</p>}</div>}
  </Card>;
}

/* Getting started: the five things that make Benchboard useful, checked off automatically. */
function Setup() {
  const t = team()!;
  if (t.sample || t.setupDone) return null;
  const players = teamPlayers().filter((p) => p.active).length;
  const steps: [string, string, boolean, () => void][] = [
    ["Add your roster", players ? `${plural(players, "player")} so far` : "Type them in, paste a list, or import a CSV", players >= 6, () => go("team")],
    ["Set your starting lineup", "So the app tracks rotations and who's serving", !!t.defLineup, () => go("lineup")],
    ["Add your schedule", "Get a scouting page before every game", !!(t.schedule && t.schedule.length), () => go("matchup")],
    ["Track your first match", "Tap a player, then what they did", matchesOf().some((m) => m.kind === "match"), () => document.getElementById("start-match")?.scrollIntoView({ behavior: "smooth" })],
    ["Invite your assistant", "Sign in, then share an invite code from the Team tab", cloudAvailable() && !!currentUser() && isLinked(t.id), () => go(currentUser() ? "team" : "account")],
  ];
  const done = steps.filter((x) => x[2]).length;
  if (done === steps.length) return null;
  return <section className="card setup">
    <div className="row between"><div><h3>Get set up</h3><p className="small muted">{done} of {steps.length} done</p></div><button className="btn sm ghost" onClick={() => setTeamPatch({ setupDone: true })}>Hide</button></div>
    <div className="meter" style={{ margin: "10px 0 6px" }}><i style={{ width: (100 * done) / steps.length + "%" }} /></div>
    <ol className="setup-list">{steps.map(([title, sub, ok, act]) => <li key={title} className={ok ? "ok" : ""}><button onClick={act}><span className="chk" aria-hidden="true">{ok ? "✓" : ""}</span><span><b>{title}</b><small>{sub}</small></span></button></li>)}</ol>
  </section>;
}
