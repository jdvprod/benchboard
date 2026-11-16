/** Club: every team in one place, for a club director or a coach with several teams.
 *   Teams      record, last result, next match, the numbers that matter
 *   Calendar   every team's matches, tournaments and practices together, with home-gym clashes and one calendar file
 *   Leaders    the club's best numbers across all teams
 *   Announce   one message to the followers of several teams at once */
import { useState } from "react";
import { all, matchesOf, plansOf, replayOf, setPrefs, teamPlayers, toast, todayISO } from "../../data/store";
import { Team } from "../../data/model";
import { aggregate, recordOf, resultOf } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtNum, fmtPct, hitting, playerMetrics, teamMetrics } from "../../sports/volleyball/metrics";
import { download, fmtDate, Seg } from "../../ui/kit";
import { go } from "../../app/router";
import { isLinked, roleOn } from "../../cloud/sync";
import { cloudAvailable, currentUser, fn, rpc, userMeta } from "../../cloud/client";
import { siteUrl } from "../../cloud/links";
import { ClubEvent, clubEvents, clubIcs, clubLeaders, homeClashes, LeaderRow } from "./club";

type Tab = "teams" | "calendar" | "leaders" | "announce";
/** Your real teams; the sample team stands in until you add one, so the page can be explored. */
const teamsOfClub = () => { const ts = all("teams"), real = ts.filter((t) => !t.sample); return (real.length ? real : ts).slice().sort((a, b) => a.name.localeCompare(b.name) || (a.level || "").localeCompare(b.level || "")); };
const label = (t: Team) => (t.level ? `${t.name} ${t.level}` : t.name);
const gamesOf = (t: Team) => matchesOf(t.id).filter((m) => m.kind === "match" && (!t.activeSeasonId || m.seasonId === t.activeSeasonId)).map((m) => ({ m, R: replayOf(m)! })).filter((x) => x.R);
const open = (id: string, page = "track") => { setPrefs({ teamId: id }); go(page); };

export function ClubPage() {
  const teams = teamsOfClub(), [tab, setTab] = useState<Tab>("teams");
  const games = teams.map((t) => gamesOf(t)), tot = games.reduce((a, g) => { const r = recordOf(g.map((x) => x.R)); return { W: a.W + r.w, L: a.L + r.l }; }, { W: 0, L: 0 });
  return <div className="page">
    <div className="pagehead"><h1>Club</h1><a className="btn sm" href="#/tryouts">Tryouts</a><span className="muted">{teams.length} {teams.length === 1 ? "team" : "teams"} · {tot.W}–{tot.L} combined</span></div>
    {!teams.length ? <p className="empty">Add a team to see it here.</p> : <>
      {teams.every((t) => t.sample) && <p className="banner small">This is the sample team. Add your own teams and they replace it here.</p>}
      <Seg value={tab} onChange={setTab} label="Club section" options={[["teams", "Teams"], ["calendar", "Calendar"], ["leaders", "Leaders"], ["announce", "Announce"]]} />
      <div style={{ marginTop: 14 }}>
        {tab === "teams" && <Teams teams={teams} />}
        {tab === "calendar" && <Calendar teams={teams} />}
        {tab === "leaders" && <Leaders teams={teams} />}
        {tab === "announce" && <Announce teams={teams} />}
      </div>
    </>}
  </div>;
}

function Teams({ teams }: { teams: Team[] }) {
  const today = todayISO();
  return <div className="club-grid">{teams.map((t) => {
    const g = gamesOf(t), rec = recordOf(g.map((x) => x.R)), M = teamMetrics(aggregate(g.flatMap((x) => x.R.sets)));
    const last = g.find((x) => x.R.matchOver), live = g.find((x) => x.m.status === "live");
    const next = (t.schedule || []).filter((x) => x.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    return <section key={t.id} className="card club-card">
      <div className="row between"><div><h3 style={{ margin: 0 }}>{t.name}</h3><span className="small muted">{t.level || "Team"}{isLinked(t.id) ? " · synced" : ""}</span></div><b className="club-rec">{rec.w}–{rec.l}</b></div>
      {live && <p className="small"><span className="tag" style={{ marginLeft: 0, background: "var(--accent)", color: "var(--accent-ink)" }}>● Live</span> vs {live.m.opp} · {live.R.cur ? `${live.R.cur.us}–${live.R.cur.them}, set ${live.R.cur.n}` : ""}</p>}
      <div className="club-k"><div><span className="label">Hitting</span><b>{fmtHit(M.hitting)}</b></div><div><span className="label">Side-out</span><b>{fmtPct(M.sideOut)}</b></div><div><span className="label">Pass</span><b>{fmtAvg(M.passAvg)}</b></div><div><span className="label">Serve in</span><b>{fmtPct(M.serveIn)}</b></div></div>
      <p className="small" style={{ margin: 0 }}>{last ? <>Last: <b className={resultOf(last.R) === "W" ? "pt-us" : resultOf(last.R) === "L" ? "pt-them" : ""}>{resultOf(last.R)} {last.R.wonUs}–{last.R.wonThem}</b> vs {last.m.opp}, {fmtDate(last.m.date)}</> : g.length ? "No finished matches yet." : "No matches yet."}</p>
      <p className="small muted" style={{ margin: 0 }}>{next ? `Next: ${next.site === "away" ? "at" : "vs"} ${next.opp}, ${next.date === today ? "today" : fmtDate(next.date)}` : "Nothing scheduled."}</p>
      <div className="row"><button className="btn sm primary" onClick={() => open(t.id)}>Open</button><button className="btn sm" onClick={() => open(t.id, "stats")}>Stats</button><button className="btn sm" onClick={() => open(t.id, "matchup")}>Schedule</button></div>
    </section>;
  })}</div>;
}

const KIND: Record<ClubEvent["kind"], string> = { match: "Match", tournament: "Tournament", practice: "Practice" };
const KINDS: Record<ClubEvent["kind"], string> = { match: "Matches", tournament: "Tournaments", practice: "Practices" };
/** The words every team name starts with ("Clovis Volleyball 16 Black", "Clovis Volleyball 15 Blue" → "Clovis Volleyball"). */
const clubName = (teams: Team[]) => { const w = teams.map((t) => t.name.split(/\s+/)); const out: string[] = []; for (let i = 0; i < (w[0]?.length || 0); i++) { const x = w[0][i]; if (/\d/.test(x) || !w.every((n) => n[i] === x)) break; out.push(x); } return out.join(" ") || "Club"; };
const dayName = (iso: string) => new Date(iso + "T12:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const fmtTime = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm); if (!m) return ""; const h = +m[1]; return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`; };

function Calendar({ teams }: { teams: Team[] }) {
  const today = todayISO(), [days, setDays] = useState<30 | 90>(30), [show, setShow] = useState<Record<ClubEvent["kind"], boolean>>({ match: true, tournament: true, practice: true });
  const src = teams.map((t) => ({ id: t.id, name: t.name, level: t.level, schedule: t.schedule, tournaments: t.tournaments, practices: plansOf(t.id).filter((p) => p.status !== "done").map((p) => ({ id: p.id, date: p.date, start: p.start, title: p.title })) }));
  const all = clubEvents(src, today, days), clashes = homeClashes(all), clashIds = new Set(clashes.flatMap((c) => c.ids));
  const ev = all.filter((e) => show[e.kind]), byDay = new Map<string, ClubEvent[]>(); for (const e of ev) byDay.set(e.date, (byDay.get(e.date) || []).concat(e));
  const club = clubName(teams);
  return <div className="stack">
    <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{(Object.keys(KIND) as ClubEvent["kind"][]).map((k) => <label key={k} className="chip-check"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {KINDS[k]}</label>)}</div>
      <div className="row" style={{ gap: 6 }}><Seg value={days} onChange={setDays} label="How far ahead" options={[[30, "30 days"], [90, "90 days"]]} />
        <button className="btn sm" disabled={!all.length} onClick={() => { download(`${club} calendar.ics`.replace(/[^\w\- .]+/g, ""), clubIcs(all, club + " (all teams)"), "text/calendar"); toast("Calendar file saved. Open it to add every team's events to your calendar."); }}>Download calendar</button></div>
    </div>
    {clashes.length > 0 && <section className="card club-clash" role="status"><h3 style={{ margin: 0 }}>Gym clashes ({clashes.length})</h3>
      <ul>{clashes.map((c) => <li key={c.ids.join()}><b>{dayName(c.date)}</b>: {c.teams.join(" and ")} {c.why}.</li>)}</ul></section>}
    {!ev.length ? <p className="empty">Nothing on any team's schedule in the next {days} days. Add schedules on each team's Matchup page, and practices on Practice.</p>
      : <div className="club-cal">{[...byDay].map(([date, list]) => <section key={date} className="club-day">
        <h3>{date === today ? "Today" : dayName(date)}<span className="muted small"> · {list.length} {list.length === 1 ? "event" : "events"}</span></h3>
        <ul>{list.map((e) => <li key={e.id} className={"club-ev " + e.kind + (clashIds.has(e.id) ? " clash" : "")}>
          <span className="t num">{e.kind === "tournament" ? (e.end ? "to " + fmtDate(e.end) : "All day") : fmtTime(e.time) || "Time TBD"}</span>
          <span className="w"><b>{e.team}</b> {e.kind === "match" ? e.title : e.kind === "practice" ? "practice" : e.title}{e.where ? <small> · {e.where}</small> : null}</span>
          <span className={"k " + e.kind}>{KIND[e.kind]}{clashIds.has(e.id) ? " · clash" : ""}</span>
        </li>)}</ul></section>)}</div>}
  </div>;
}

const STATS: [string, string, (r: { kps: number | null; aps: number | null; dps: number | null; acesPs: number | null; bps: number | null; hit: number | null }) => number | null, (v: number) => string, number][] = [
  ["kps", "Kills per set", (m) => m.kps, (v) => fmtNum(v, 2), 6], ["hit", "Hitting", (m) => m.hit, (v) => fmtHit(v), 6], ["aps", "Assists per set", (m) => m.aps, (v) => fmtNum(v, 2), 6],
  ["dps", "Digs per set", (m) => m.dps, (v) => fmtNum(v, 2), 6], ["aces", "Aces per set", (m) => m.acesPs, (v) => fmtNum(v, 2), 6], ["bps", "Blocks per set", (m) => m.bps, (v) => fmtNum(v, 2), 6],
];
function Leaders({ teams }: { teams: Team[] }) {
  const [stat, setStat] = useState("kps");
  const base = teams.flatMap((t) => { const A = aggregate(gamesOf(t).flatMap((x) => x.R.sets));
    return teamPlayers(t.id).filter((p) => A.ps[p.id]).map((p) => { const pm = playerMetrics(A, p.id), s = A.ps[p.id]; return { p, t, sets: pm.sets, m: { kps: pm.kps, aps: pm.aps, dps: pm.dps, acesPs: pm.acesPs, bps: pm.bps, hit: s.TA >= 30 ? hitting(s) : null } }; }); });
  const def = STATS.find((s) => s[0] === stat)!;
  const rows: LeaderRow[] = base.map((b) => ({ id: b.p.id, name: `${b.p.first} ${b.p.last}`.trim() || "#" + b.p.num, num: b.p.num, team: label(b.t), v: def[2](b.m) ?? NaN, sets: b.sets }));
  const top = clubLeaders(rows, 15, def[4]);
  return <div className="stack">
    <label className="field" style={{ maxWidth: 280 }}><span className="label">Leaders in</span><select className="input" value={stat} onChange={(e) => setStat(e.target.value)}>{STATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    {!top.length ? <p className="empty">Not enough sets played yet. Players need at least {def[4]} sets{stat === "hit" ? " and 30 attacks" : ""} to show here.</p>
      : <div className="tbl"><table><thead><tr><th>#</th><th className="l">Player</th><th className="l">Team</th><th>{def[1]}</th><th>Sets</th></tr></thead>
        <tbody>{top.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td className="l"><b>{r.name}</b> <span className="muted small">#{r.num}</span></td><td className="l">{r.team}</td><td><b>{def[3](r.v)}</b></td><td>{r.sets}</td></tr>)}</tbody></table></div>}
    <p className="keys">This season, across every team on this device. Per-set numbers need at least {def[4]} sets played{stat === "hit" ? "; hitting needs 30 attacks" : ""}.</p>
  </div>;
}

function Announce({ teams }: { teams: Team[] }) {
  const ready = cloudAvailable() && !!currentUser();
  const can = teams.filter((t) => isLinked(t.id) && ["owner", "coach"].includes(roleOn(t.id) || ""));
  const [pick, setPick] = useState<string[]>(() => can.map((t) => t.id)), [text, setText] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState<string[] | null>(null), [err, setErr] = useState("");
  if (!ready) return <p className="empty">Sign in to send an announcement to several teams at once.</p>;
  if (!can.length) return <p className="empty">Sync your teams first (each team's Team page → Cloud sync). You can announce to the teams you coach.</p>;
  const send = async () => {
    const body = text.trim(); if (!body || !pick.length) return;
    setBusy(true); setErr(""); const ok: string[] = [], bad: string[] = []; let devices = 0;
    for (const t of can.filter((x) => pick.includes(x.id))) {
      try {
        const p = await rpc("post_send", { t: t.id, b: body, pin: false }); ok.push(label(t));
        const r = await fn("notify", { action: "send", team_id: t.id, match_id: p.id, kind: "post", title: `${t.name}: message from ${userMeta().name || "your coach"}`, body: body.slice(0, 200), base: siteUrl("live") }).catch(() => null);
        devices += r?.sent || 0;
      } catch { bad.push(label(t)); }
    }
    setBusy(false); setDone(ok); if (ok.length) setText("");
    if (bad.length) setErr(`Couldn't send to ${bad.join(", ")}. Check your connection and try those again.`);
    else toast(`Sent to ${ok.length} ${ok.length === 1 ? "team" : "teams"}${devices ? `, ${devices} ${devices === 1 ? "device" : "devices"} notified` : ""}.`);
  };
  return <div className="stack" style={{ maxWidth: 640 }}>
    <fieldset className="club-pick"><legend className="label">Send to</legend>
      {can.map((t) => <label key={t.id} className="chip-check"><input type="checkbox" checked={pick.includes(t.id)} onChange={(e) => setPick(e.target.checked ? pick.concat(t.id) : pick.filter((x) => x !== t.id))} /> {label(t)}</label>)}</fieldset>
    <textarea className="input" rows={4} maxLength={2000} value={text} onChange={(e) => { setText(e.target.value); setDone(null); }} placeholder="Gym closed Saturday for the tournament. All practices move to Sunday." aria-label="Announcement to the club" />
    <div className="row between"><span className="small muted">{pick.length} of {can.length} teams</span><button className="btn primary" disabled={busy || !text.trim() || !pick.length} onClick={send}>{busy ? "Sending…" : `Send to ${pick.length} ${pick.length === 1 ? "team" : "teams"}`}</button></div>
    {done && done.length > 0 && <p className="small" role="status">Posted on {done.join(", ")}.</p>}
    {err && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{err}</p>}
    <p className="keys">Each team's followers get it on their team page on Floorcall Live, the same as an announcement from that team. One way: nobody can reply.</p>
  </div>;
}
