/** Academy → Drill library: every drill in one place, filtered by skill, level and who it's for, with a search.
 * Coaches add any drill to a practice plan, or send it to their players ("From your coach"); players see what
 * their coach sent first. */
import { useEffect, useMemo, useState } from "react";
import { AREAS, LEVELS, LIBRARY, LibDrill, Level, visibleDrills, Who } from "./content";
import { placeUrl } from "../cloud/links";
import { cloudAvailable, CloudError, currentUser, rpc } from "../cloud/client";
import { BILLING } from "../app/flags";

/** A drill, packed into a link that adds it to the coach's drill library in the FloorCall app. */
export const drillLink = (d: { name: string; minutes: number; needs: string; how: string[]; points: string[]; for?: string }, category: string) => {
  const json = JSON.stringify({ n: d.name, c: category, m: d.minutes, d: [d.needs + ".", ...d.how, "Coaching points: " + d.points.join(" ")].join(" "), src: "academy", ...(d.for ? { f: d.for } : {}) });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return placeUrl("app", "practice/drill:" + b64);
};

export interface Pick { team: string; drill: string; note: string | null }
interface CoachTeam { id: string; name: string; role: string }

/** The coach's teams (to send drills to) and the player's picks, loaded once per page. */
export function usePicks(coach: boolean) {
  const [picks, setPicks] = useState<Pick[] | null>(null), [teams, setTeams] = useState<CoachTeam[]>([]), [teamPicks, setTeamPicks] = useState<Record<string, string[]>>({});
  const on = cloudAvailable() && !!currentUser();
  const loadTeam = async (t: string) => { try { const x: { drill: string }[] = await rpc("team_drill_list", { t }); setTeamPicks((m) => ({ ...m, [t]: x.map((y) => y.drill) })); } catch { /* not on that team */ } };
  useEffect(() => {
    if (!on) { setPicks([]); return; }
    rpc("my_drill_picks", {}).then(setPicks).catch(() => setPicks([]));
    if (coach) rpc("my_coverage", {}).then((c: { teams: CoachTeam[] }) => { const ts = c.teams.filter((t) => t.role === "owner" || t.role === "coach"); setTeams(ts); ts.forEach((t) => loadTeam(t.id)); }).catch(() => {});
  }, [on, coach]);
  return { picks, teams, teamPicks, loadTeam };
}

export function DrillRow({ d, category, who, send }: { d: LibDrill | (LibDrill & { area?: string }); category: string; who: Who; send?: { teams: CoachTeam[]; picked: (t: string) => boolean; toggle: (t: string, on: boolean) => Promise<void> } }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const sent = send?.teams.filter((t) => send.picked(t.id)) || [];
  return <li className={"ac-drill" + (open ? " open" : "")}>
    <button className="ac-drill-hd" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="ac-drill-name"><b>{d.name}{d.for && <span className="ac-forchip">{d.for === "girls" ? "Girls" : "Boys"}</span>}{sent.length > 0 && <span className="ac-sentchip">Sent to players</span>}</b><small>{d.needs}{"areaName" in d && d.areaName ? ` · ${d.areaName}` : ""}</small></span>
      <span className="ac-drill-meta"><span className={"ac-lvl " + d.level.toLowerCase()}>{d.level}</span><span className="num">{d.minutes} min</span></span>
      <svg className="ac-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="ac-drill-body">
      <div><h3>How</h3><ol>{d.how.map((h) => <li key={h}>{h}</li>)}</ol></div>
      <div><h3>{who === "player" ? "Focus on" : "Coach"}</h3><ul>{d.points.map((p) => <li key={p}>{p}</li>)}</ul></div>
      {who === "coach" && <div className="ac-drill-acts">
        <a className="btn primary sm ac-add" href={drillLink(d, category)} target="_blank" rel="noopener">Add to my practice</a>
        {send && send.teams.map((t) => { const on = send.picked(t.id); return <button key={t.id} className={"btn sm" + (on ? " ac-sent" : "")} disabled={busy === t.id} aria-pressed={on}
          onClick={async () => { setBusy(t.id); setMsg(""); try { await send.toggle(t.id, !on); setMsg(on ? `Taken off ${t.name}'s list` : `Sent to ${t.name}'s players`); } catch (e) { setMsg(e instanceof CloudError ? e.message : "Couldn't reach FloorCall."); } setBusy(""); }}>
          {on ? `✓ Sent to ${send.teams.length > 1 ? t.name : "your players"}` : `Send to ${send.teams.length > 1 ? t.name + "'s" : "your"} players`}</button>; })}
        {msg && <span className="small muted" role="status">{msg}</span>}
      </div>}
    </div>}
  </li>;
}

export function Library({ who, coach }: { who: Who; coach: boolean }) {
  const { picks, teams, teamPicks, loadTeam } = usePicks(coach);
  const [area, setArea] = useState(""), [level, setLevel] = useState<Level | "">(""), [kind, setKind] = useState<Who | "">(who === "player" ? "player" : ""), [q, setQ] = useState("");
  const all = useMemo(() => visibleDrills(LIBRARY, { billing: BILLING, coach, ownPlan: false, picks: (picks || []).map((p) => p.drill) }), [picks, coach]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter((x) => (!area || x.area === area) && (!level || x.level === level) && (!kind || x.who === kind)
    && words.every((w) => (x.name + " " + x.needs + " " + x.areaName + " " + x.how.join(" ") + " " + x.points.join(" ")).toLowerCase().includes(w)));
  const sendFor = (id: string) => coach && teams.length ? {
    teams, picked: (t: string) => (teamPicks[t] || []).includes(id),
    toggle: async (t: string, on: boolean) => { await rpc("team_pick_drill", { t, drill: id, pick: on, note: null }); await loadTeam(t); },
  } : undefined;
  const fromCoach = who === "player" && picks?.length ? picks.map((p) => ({ p, d: LIBRARY.find((x) => x.id === p.drill) })).filter((x) => x.d) : [];
  return <article className="ac-lib">
    <header className="ac-lib-hd">
      <a className="ac-back" href={"#/" + (who === "player" ? "players" : "coaches")}>Academy</a>
      <h1>Drill library</h1>
      <p>{LIBRARY.length} drills for every skill, from first-day beginners to advanced players. {who === "coach" ? "Add any drill to a practice plan, or send it to your players so it shows up in their Academy." : "Drills you can do on your own or with a friend, and the team drills your coach might run."}</p>
    </header>
    {fromCoach.length > 0 && <section className="ac-sec ac-fromcoach" aria-labelledby="ac-fc"><h2 id="ac-fc">From your coach</h2>
      <ul className="ac-drills">{fromCoach.map(({ p, d }) => <DrillRow key={p.team + d!.id} d={d!} category={d!.category} who="player" />)}</ul>
      <p className="small muted">{[...new Set(fromCoach.map((x) => x.p.team))].join(", ")} picked these for you.</p></section>}
    <div className="ac-filters">
      <input className="input ac-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drills: “seam”, “wall”, “jump serve”" aria-label="Search drills" />
      <div className="ac-chips" role="group" aria-label="Skill"><button aria-pressed={!area} onClick={() => setArea("")}>All skills</button>{AREAS.map((a) => <button key={a.id} aria-pressed={area === a.id} onClick={() => setArea(area === a.id ? "" : a.id)}>{a.name}</button>)}</div>
      <div className="ac-segrow">
        <div className="ac-seg" role="group" aria-label="Level"><button aria-pressed={!level} onClick={() => setLevel("")}>All levels</button>{LEVELS.map((l) => <button key={l} aria-pressed={level === l} onClick={() => setLevel(level === l ? "" : l)}>{l}</button>)}</div>
        <div className="ac-seg" role="group" aria-label="Who"><button aria-pressed={!kind} onClick={() => setKind("")}>Everything</button><button aria-pressed={kind === "player"} onClick={() => setKind("player")}>On your own</button><button aria-pressed={kind === "coach"} onClick={() => setKind("coach")}>Team drills</button></div>
      </div>
    </div>
    <p className="ac-count" aria-live="polite">{list.length === all.length ? `${list.length} drills` : `${list.length} of ${all.length} drills`}</p>
    {LEVELS.filter((l) => list.some((x) => x.level === l)).map((l) => <section key={l} className="ac-sec ac-lvlsec"><h2><span className={"ac-lvl " + l.toLowerCase()}>{l}</span> <small>{list.filter((x) => x.level === l).length}</small></h2>
      <ul className="ac-drills">{list.filter((x) => x.level === l).map((x) => <DrillRow key={x.id} d={x} category={x.category} who={who} send={sendFor(x.id)} />)}</ul></section>)}
    {!list.length && <p className="ac-empty">No drills match. <button className="linkbtn" onClick={() => { setArea(""); setLevel(""); setKind(""); setQ(""); }}>Clear the filters</button></p>}
  </article>;
}
