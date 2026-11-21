/** Home: the dashboard the app opens to. What's live, next and last; every section with what's waiting in it; the season so far. */
import { COACH_ONLY, isViewer } from "../../app/viewAs";
import { lazy, Suspense, useState } from "react";
import { all, currentMatch, ensureOpponent, matchesOf, newMatch, oppKey, opponentsOf, plansOf, playerName, replayOf, setTeamPatch, team, teamPlayers, todayISO, toast } from "../../data/store";
import { Icon } from "../../ui/icons";
import { feePlayers, summary as feeSummary } from "../club/fees";
import { FEES } from "../../app/flags";
import { cloudAvailable, currentUser } from "../../cloud/client";
import { LEGAL } from "../../app/legal";
import { aggregate, resultOf } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, teamMetrics } from "../../sports/volleyball/metrics";
import { Card, copyText, fmtDate, plural } from "../../ui/kit";
import { go } from "../../app/router";
import { setUi } from "../../app/ui";
import { focusAreas } from "../practice/focus";
import { matchReportHtml } from "../stats/matchReport";
import { download } from "../../ui/kit";
import { todaysTournament } from "../../tournament/today";
/** Loaded only on a tournament day. */
const TournamentToday = lazy(() => import("../tournament/TournamentPage").then((m) => ({ default: m.TournamentToday })));
import { shareFinalGraphic } from "../stats/finalGraphic";
import { recapText } from "../stats/recap";
/** The recap video maker loads when a coach opens it. */
const RecapVideo = lazy(() => import("../stats/RecapDialog").then((m) => ({ default: m.RecapVideo })));
import { NextMatchStatus } from "../matchup/Availability";
import { liveUrlFor } from "../../cloud/CloudCard";

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
  const [recap, setRecap] = useState(false);
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
  const star = lastA ? Object.entries(lastA.ps).map(([id, s]) => [id, s.K + s.SA + s.BS + s.BA - s.AE - s.SE - s.SEN - s.SEO] as [string, number]).sort((a, b) => b[1] - a[1])[0] : null;

  const lastResult = last ? resultOf(last.R) : null;
  const streak = (() => { let k: string | null = null, n = 0; for (const g of done) { const r = g.R.wonUs > g.R.wonThem ? "W" : g.R.wonThem > g.R.wonUs ? "L" : "T"; if (!k) k = r; if (r !== k) break; n++; } return k && n > 1 ? `${k === "W" ? "Won" : k === "L" ? "Lost" : "Tied"} ${n} straight` : ""; })();

  return <div className="hm">
    {recap && last && <Suspense fallback={null}><RecapVideo m={last.m} R={last.R} onClose={() => setRecap(false)} /></Suspense>}
    <header className="hm-head">
      <div className="hm-title"><h1>{t.name}</h1><p>{[t.sample ? "Sample team" : t.level, fmtDate(today)].filter(Boolean).join(" · ")}</p></div>
      {done.length > 0 && <div className="hm-record" aria-label={`Season record ${W} wins, ${L} losses${T ? `, ${T} ties` : ""}`}>
        <b className="num">{W}–{L}{T ? "–" + T : ""}</b><span>{streak || "this season"}</span></div>}
    </header>
    {todaysTournament() && <Suspense fallback={null}><TournamentToday /></Suspense>}
    <UpNext next={next} vs={vsNext.length ? `${vsNext.filter((g) => g.R.wonUs > g.R.wonThem && g.R.matchOver).length}–${vsNext.filter((g) => g.R.wonThem > g.R.wonUs && g.R.matchOver).length} against them this season` : "First meeting this season"} onStart={startNext} />
    {!isViewer(t.id) && <Setup />}
    <div className="hm-week-narrow"><Week /></div>
    <div className="hm-grid">
      <div className="hm-main">
        <section className="hm-sec" aria-labelledby="hm-last">
          <div className="hm-sec-hd"><h2 id="hm-last">Last result</h2>{last && <span className="muted small">{fmtDate(last.m.date)}{last.m.event ? " · " + last.m.event : ""}</span>}</div>
          {last && lastM ? <>
            <div className="hm-score">
              <span className={"hm-wl " + (lastResult === "W" ? "w" : lastResult === "L" ? "l" : "t")}>{lastResult || "–"}</span>
              <span className="hm-sets num">{last.R.wonUs}–{last.R.wonThem}</span>
              <span className="hm-opp">vs {last.m.opp}</span>
            </div>
            <ol className="hm-setline num" aria-label="Set scores">{last.R.sets.map((x, k) => <li key={k} className={x.us > x.them ? "w" : ""}><small>S{k + 1}</small>{x.us}–{x.them}</li>)}{!last.R.matchOver && <li className="muted"><small>&nbsp;</small>ended early</li>}</ol>
            <dl className="hm-line">
              <div><dt>Hitting</dt><dd className="num">{fmtHit(lastM.hitting)}</dd></div>
              <div><dt>Side-out</dt><dd className="num">{fmtPct(lastM.sideOut)}</dd></div>
              <div><dt>Pass avg</dt><dd className="num">{fmtAvg(lastM.passAvg)}</dd></div>
              {star && star[1] > 0 && <div><dt>Top player</dt><dd>{playerName(star[0])}</dd></div>}
            </dl>
            <div className="hm-actions">
              <button className="btn sm primary" onClick={() => { setUi({ statsScope: "m:" + last.m.id }); go("stats"); }}>Full stats</button>
              <button className="btn sm" onClick={() => download(`${t.name} vs ${last.m.opp} ${last.m.date} report.html`.replace(/[^\w\- .]+/g, ""), matchReportHtml(last.m, last.R), "text/html")}>Match report</button>
              <button className="btn sm" onClick={() => shareFinalGraphic(last.m, last.R)}>Share graphic</button>
              <button className="btn sm" onClick={() => setRecap(true)}>Recap video</button>
              <button className="btn sm" onClick={() => shareRecap(last.m, last.R)}>Text recap</button>
            </div>
          </> : <p className="muted">Your most recent result shows up here after your first match.</p>}
        </section>
        {games.length > 0 && <section className="hm-sec" aria-labelledby="hm-season">
          <div className="hm-sec-hd"><h2 id="hm-season">Season</h2><button className="btn sm ghost" onClick={() => { setUi({ statsScope: "season" }); go("stats"); }}>All stats</button></div>
          <dl className="hm-kpis">
            {([["Hitting", fmtHit(M.hitting), chron.map((x) => x.hitting)], ["Side-out", fmtPct(M.sideOut), chron.map((x) => x.sideOut)], ["Pass avg", fmtAvg(M.passAvg), chron.map((x) => x.passAvg)], ["Serve in", fmtPct(M.serveIn), chron.map((x) => x.serveIn)]] as [string, string, (number | null)[]][]).map(([l, v, sp]) =>
              <div key={l}><dt>{l}</dt><dd className="num">{v}</dd><Spark vals={sp} /></div>)}
          </dl>
          <ul className="hm-leaders">{([["Kills", (x: any) => x.K], ["Aces", (x: any) => x.SA], ["Digs", (x: any) => x.D], ["Blocks", (x: any) => x.BS + x.BA]] as [string, (x: any) => number][]).map(([l, f]) => { const x = leaders(f); return x ? <li key={l}><span className="muted">{l}</span><b>{playerName(x[0])}</b><span className="num">{x[1]}</span></li> : null; })}</ul>
        </section>}
        {focus.length > 0 && <section className="hm-sec" aria-labelledby="hm-work">
          <div className="hm-sec-hd"><h2 id="hm-work">What to work on</h2><button className="btn sm ghost" onClick={() => go("practice")}>Plan practice</button></div>
          <ul className="hm-work">{focus.map((f, i) => <li key={i}><b>{f.cat}</b><span>{f.text}</span></li>)}</ul>
        </section>}
        {games.length > 0 && <TeamGoals M={M} />}
      </div>
      <aside className="hm-rail">
        <Week />
        <Sections next={next} games={games.length} M={M} />
      </aside>
    </div>
  </div>;
}

/** The black band at the top: the match in progress, or the next one. */
function UpNext({ next, vs, onStart }: { next?: { date: string; opp: string; time?: string; site?: string; event?: string; id: string }; vs: string; onStart: () => void }) {
  const m = currentMatch(), today = todayISO(), viewer = isViewer(team()!.id);
  if (m && viewer && m.kind !== "match") return null;
  if (m) { const R = replayOf(m), cur = R?.sets[R.sets.length - 1];
    return <button className="hm-band live home-live" onClick={() => { if (viewer) { setUi({ statsScope: "m:" + m.id }); go("stats"); } else go(m.kind === "match" ? "track" : "practice"); }}>
      <span className="hm-band-tag"><i className="home-live-dot" aria-hidden="true" />{m.kind === "match" ? "Live" : "Practice"}</span>
      <span className="hm-band-main"><b>{m.kind === "match" ? `Match in progress vs ${m.opp}` : `Practice in progress: ${m.opp}`}</b>
        {R && cur ? <small className="num">Set {R.sets.length} · {cur.us}–{cur.them} · sets {R.wonUs}–{R.wonThem}</small> : null}</span>
      <span className="hm-band-go">{viewer ? "Follow it" : "Resume"}</span>
    </button>; }
  if (!next && viewer) return null;
  if (!next) return <div className="hm-band quiet"><span className="hm-band-main"><b>No matches scheduled</b><small>Add your schedule to get a scouting page before every game.</small></span><div className="hm-band-acts"><button className="btn sm" onClick={() => go("matchup")}>Add your schedule</button><button className="btn sm primary" onClick={() => go("track")}>Start a match</button></div></div>;
  const days = Math.round((new Date(next.date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 864e5);
  return <section className="hm-band" aria-label="Next match">
    <span className="hm-band-tag">{days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`}</span>
    <span className="hm-band-main"><b>{next.site === "away" ? "at " : "vs "}{next.opp}</b>
      <small>{[fmtDate(next.date), next.time ? fmtTime(next.time) : "", next.event, vs].filter(Boolean).join(" · ")}</small>
      <NextMatchStatus s={next as any} /></span>
    {!viewer && <div className="hm-band-acts"><button className="btn sm" onClick={() => go("matchup", ensureOpponent(next.opp).id)}>See the matchup</button>{days === 0 ? <button className="btn sm primary" onClick={onStart}>Start now</button> : <button className="btn sm primary" onClick={() => go("track")}>Start a match</button>}</div>}
  </section>;
}

/** The next seven days: matches, practices and tournaments, by day. */
function Week() {
  const t = team()!, today = todayISO(), end = (() => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
  type Row = { date: string; time?: string; title: string; sub: string; go: () => void; kind: "match" | "practice" | "tournament" };
  const rows: Row[] = [
    ...(t.schedule || []).filter((x) => x.date >= today && x.date <= end).map((x): Row => ({ date: x.date, time: x.time, title: (x.site === "away" ? "at " : "vs ") + x.opp, sub: [x.time ? fmtTime(x.time) : "", x.event].filter(Boolean).join(" · ") || "Match", go: () => go("matchup", ensureOpponent(x.opp).id), kind: "match" })),
    ...plansOf().filter((p) => !isViewer(t.id) && p.status === "planned" && p.date >= today && p.date <= end).map((p): Row => ({ date: p.date, time: p.start, title: p.title || "Practice", sub: [p.start ? fmtTime(p.start) : "", plural(p.blocks.length, "block")].filter(Boolean).join(" · "), go: () => go("practice"), kind: "practice" })),
    ...(t.tournaments || []).filter((x) => x.start <= end && (x.end || x.start) >= today).map((x): Row => ({ date: x.start < today ? today : x.start, title: x.name, sub: "Tournament", go: () => go("tournament", x.id), kind: "tournament" })),
  ].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const dow = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
  return <section className="hm-sec hm-week" aria-label="This week">
    <div className="hm-sec-hd"><h2>This week</h2></div>
    {rows.length ? <ul>{rows.map((r, i) => <li key={i}><button onClick={r.go}>
      <span className={"hm-day" + (r.date === today ? " today" : "")}><small>{dow(r.date)}</small><b className="num">{+r.date.slice(8)}</b></span>
      <span className="hm-ev"><b>{r.title}</b><small>{r.sub}</small></span>
      <span className={"hm-kind " + r.kind}>{r.kind === "match" ? "Match" : r.kind === "practice" ? "Practice" : "Tournament"}</span>
    </button></li>)}</ul> : <p className="muted small">{isViewer(t.id) ? "Nothing on the schedule this week." : "Nothing in the next seven days. Add matches in Matchup or plan a practice."}</p>}
  </section>;
}

/** Every section of the app, each with what's waiting in it. */
function Sections({ next, games, M }: { next?: { date: string; opp: string; time?: string }; games: number; M: ReturnType<typeof teamMetrics> }) {
  const t = team()!, today = todayISO(), viewer = isViewer(t.id);
  const day = (d: string) => (d === today ? "today" : new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
  const plan = plansOf().filter((p) => p.status === "planned" && p.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const players = teamPlayers().filter((p) => p.active).length;
  const fees = FEES && t.fees ? feeSummary(t.fees, feePlayers(t.fees, teamPlayers())) : null;
  const film = matchesOf().filter((m) => m.video).length;
  const teams = all("teams").filter((x) => !x.sample).length;
  const rows: [string, string, string][] = [
    ["track", "Track", currentMatch()?.kind === "match" ? "A match is in progress" : next && next.date === today ? `vs ${next.opp} today` : "Start a match or scrimmage"],
    ["lineup", "Lineup", t.defLineup ? "Starting six set" : "Set your starting six"],
    ["matchup", "Matchup", next ? `vs ${next.opp}, ${day(next.date)}` : opponentsOf().length ? `${plural(opponentsOf().length, "opponent")} scouted` : "Schedule and scouting"],
    ["practice", "Practice", plan ? `${day(plan.date)}, ${plural(plan.blocks.length, "block")}` : "Plan a practice"],
    ["stats", "Stats", games ? `Hitting ${fmtHit(M.hitting)} over ${plural(games, "match", "matches")}` : "After your first match"],
    ["court", "Court", "Rotations, plays, 3D court"],
    ["team", "Team", `${plural(players, "player")}${fees && fees.owing ? `, ${plural(fees.owing, "family", "families")} owe fees` : ""}`],
    ["film", "Film", film ? `${plural(film, "match", "matches")} of film` : "Stat a game from video"],
    ["live", "Live", "What families see"],
    ["tryouts", "Tryouts", "Rate players with your staff"],
    ...(teams > 1 ? [["club", "Club", `${teams} teams`] as [string, string, string]] : []),
    ["settings", "Settings", "Account, backups, display"],
  ];
  return <nav className="hm-sec hm-goto" aria-label="Go to">
    <div className="hm-sec-hd"><h2>Go to</h2></div>
    <ul>{rows.filter(([pg]) => !viewer || !COACH_ONLY.includes(pg)).map(([page, title, sub]) => <li key={page}><a href={"#/" + page}><i aria-hidden="true"><Icon name={page} /></i><b>{title}</b><small>{sub}</small><svg className="hm-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg></a></li>)}</ul>
  </nav>;
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
  return <section className="hm-sec" aria-labelledby="hm-goals"><div className="hm-sec-hd"><h2 id="hm-goals">Team goals</h2>{!isViewer(team()!.id) && <button className="btn sm ghost" onClick={() => setEdit(!edit)}>{edit ? "Done" : active.length ? "Edit" : "Set goals"}</button>}</div>
    {edit ? <div className="pf-grid">{TARGETS.map(([k, label, def, f]) => <label key={k} className="field"><span className="label">{label}</span>
      <input inputMode="decimal" defaultValue={tg[k] != null ? (k === "hitting" ? String(tg[k]).replace(/^0/, "") : k === "passAvg" ? String(tg[k]) : Math.round(tg[k]! * 100) + "%") : ""} placeholder={"e.g. " + f(def)}
        onBlur={(e) => { const raw = e.target.value.trim(); const n = { ...tg }; if (!raw) delete n[k]; else { let v = parseFloat(raw.replace("%", "")); if (k !== "hitting" && k !== "passAvg" && v > 1) v /= 100; if (isFinite(v)) n[k] = v; } setTeamPatch({ targets: n }); }} /></label>)}</div>
      : <div className="goals-grid">{list.map(([k, label, def, f]) => { const target = tg[k] ?? def, v = (M as any)[k] as number | null, hit = v != null && v >= target, prog = v == null ? 0 : Math.max(0, Math.min(1, target > 0 ? v / target : 0));
        return <div key={k} className="goal"><div className="row between"><span><b>{label}</b> <span className="small muted">goal {f(target)}</span></span><span className={hit ? "hi" : ""}>{f(v)}{hit ? " ✓" : ""}</span></div><div className="meter"><i style={{ width: prog * 100 + "%" }} /></div></div>; })}
        {!active.length && !isViewer(team()!.id) && <p className="small muted">Suggested goals. Tap Set goals to make them yours.</p>}</div>}
  </section>;
}

/** Copy (or share from the phone) a text recap with the gamecast link when the match was shared. */
async function shareRecap(m: import("../../data/model").Match, R: import("../../sports/volleyball/engine").Replay) {
  const text = recapText(m, R, liveUrlFor(m.id)), nav: any = navigator;
  if (nav.share && matchMedia("(pointer: coarse)").matches) { try { await nav.share({ text }); return; } catch { /* cancelled: copy instead */ } }
  const ok = await copyText(text); toast(ok ? "Recap copied. Paste it in the team group chat." : text);
}

/* Getting started: the five things that make FloorCall useful, checked off automatically. */
function Setup() {
  const t = team()!;
  if (t.sample || t.setupDone) return null;
  const players = teamPlayers().filter((p) => p.active).length, cloud = cloudAvailable() && !!currentUser(), ob = t.onboard || {};
  const mark = (k: "form") => setTeamPatch({ onboard: { ...ob, [k]: Date.now() } });
  const steps: [string, string, boolean, () => void][] = [
    ["Add your roster", players ? `${plural(players, "player")} so far` : "Type them in, paste a list, or import a CSV", players >= 6, () => go("team")],
    ["Add your home gym", "So practices and home matches show where they are on the calendar", !!t.gym, () => go("team")],
    ["Set your starting lineup", "So the app tracks rotations and who's serving", !!t.defLineup, () => go("lineup")],
    ["Add your schedule", "Get a scouting page before every game", !!(t.schedule?.length || t.tournaments?.length), () => go("matchup")],
    ["Invite your staff and players", "Share an invite code from the Team tab", !!t.invited, () => go(currentUser() ? "team" : "account")],
    ...(cloud ? [
      ["Send families the permission form", "Print or email the parent and guardian form before you share anything", !!ob.form, () => { mark("form"); window.open(LEGAL.consent, "_blank", "noopener"); }] as [string, string, boolean, () => void],
      ["Share your team page", "Families follow scores and the schedule on FloorCall Live", !!ob.shared, () => go("team")] as [string, string, boolean, () => void],
      ["Link families for notes", "Say which account is which player so notes reach the right family", !!ob.linked, () => go("notes")] as [string, string, boolean, () => void],
    ] : []),
    ["Track your first match", "Tap a player, then what they did", matchesOf().some((m) => m.kind === "match" && !m.imported), () => go("track")],
  ];
  const done = steps.filter((x) => x[2]).length;
  if (done === steps.length) return null;
  return <section className="card setup">
    <div className="row between"><div><h3>Get set up</h3><p className="small muted">{done} of {steps.length} done</p></div><button className="btn sm ghost" onClick={() => setTeamPatch({ setupDone: true })}>Hide</button></div>
    <div className="meter" style={{ margin: "10px 0 6px" }}><i style={{ width: (100 * done) / steps.length + "%" }} /></div>
    <ol className="setup-list">{steps.map(([title, sub, ok, act]) => <li key={title} className={ok ? "ok" : ""}><button onClick={act}><span className="chk" aria-hidden="true">{ok ? "✓" : ""}</span><span><b>{title}</b><small>{sub}</small></span></button></li>)}</ol>
  </section>;
}
