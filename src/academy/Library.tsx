/** Academy → Drill library: every drill in one place, filtered by skill, level and who it's for, with a search.
 * Coaches add any drill to a practice plan, or send it to their players ("From your coach"); players see what
 * their coach sent first. */
import { useEffect, useMemo, useState } from "react";
import { AREAS, LEVELS, LIBRARY, LibDrill, Level, visibleDrills, Who } from "./content";
import { OwnDrill, useFavs, useOwn } from "./mine";
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

export function DrillRow({ d, category, who, send, onEdit }: { d: LibDrill | (LibDrill & { area?: string }); category: string; who: Who; send?: { teams: CoachTeam[]; picked: (t: string) => boolean; toggle: (t: string, on: boolean) => Promise<void> }; onEdit?: (d: OwnDrill) => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const { isFav, toggle: fav } = useFavs(), { remove } = useOwn();
  const sent = send?.teams.filter((t) => send.picked(t.id)) || [], mine = (d as OwnDrill).mine, custom = d.id.startsWith("c:"), starred = isFav(d.id);
  return <li className={"ac-drill" + (open ? " open" : "")}>
    <div className="ac-drill-top">
    <button className="ac-drill-hd" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="ac-drill-name"><b>{d.name}{d.for && <span className="ac-forchip">{d.for === "girls" ? "Girls" : "Boys"}</span>}{custom && <span className="ac-ownchip">{mine ? "Yours" : "From your coach"}</span>}{sent.length > 0 && <span className="ac-sentchip">Sent to players</span>}</b><small>{d.needs}{"areaName" in d && d.areaName ? ` · ${d.areaName}` : ""}</small></span>
      <span className="ac-drill-meta"><span className={"ac-lvl " + d.level.toLowerCase()}>{d.level}</span><span className="num">{d.minutes} min</span></span>
      <svg className="ac-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <button className={"ac-star" + (starred ? " on" : "")} aria-pressed={starred} aria-label={(starred ? "Remove from favorites: " : "Add to favorites: ") + d.name} title={starred ? "Favorite" : "Add to favorites"} onClick={() => fav(d.id)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.6 2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.4l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" /></svg></button>
    </div>
    {open && <div className="ac-drill-body">
      <div><h3>How</h3><ol>{d.how.map((h, i) => <li key={i}>{h}</li>)}</ol></div>
      <div><h3>{who === "player" ? "Focus on" : "Coach"}</h3><ul>{d.points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
      {(who === "coach" || mine) && <div className="ac-drill-acts">
        {who === "coach" && <a className="btn primary sm ac-add" href={drillLink(d, category)} target="_blank" rel="noopener">Add to my practice</a>}
        {who === "coach" && send && send.teams.map((t) => { const on = send.picked(t.id); return <button key={t.id} className={"btn sm" + (on ? " ac-sent" : "")} disabled={busy === t.id} aria-pressed={on}
          onClick={async () => { setBusy(t.id); setMsg(""); try { await send.toggle(t.id, !on); setMsg(on ? `Taken off ${t.name}'s list` : `Sent to ${t.name}'s players`); } catch (e) { setMsg(e instanceof CloudError ? e.message : "Couldn't reach FloorCall."); } setBusy(""); }}>
          {on ? `✓ Sent to ${send.teams.length > 1 ? t.name : "your players"}` : `Send to ${send.teams.length > 1 ? t.name + "'s" : "your"} players`}</button>; })}
        {mine && onEdit && <button className="btn sm" onClick={() => onEdit(d as OwnDrill)}>Edit</button>}
        {mine && <button className="btn sm ghost" onClick={async () => { try { await remove(d.id); } catch (e) { setMsg(e instanceof CloudError ? e.message : "Couldn't delete it."); } }}>Delete</button>}
        {msg && <span className="small muted" role="status">{msg}</span>}
      </div>}
    </div>}
  </li>;
}

/** Add or edit your own drill, in any Academy section. */
export function DrillForm({ initial, area, onDone }: { initial?: OwnDrill | null; area?: string; onDone: () => void }) {
  const { save } = useOwn();
  const [f, setF] = useState<OwnDrill>(() => initial || { id: "", area: area || "serving", name: "", who: "coach", level: "Beginner", minutes: 10, needs: "", how: [], points: [] });
  const [how, setHow] = useState((initial?.how || []).join("\n")), [pts, setPts] = useState((initial?.points || []).join("\n")), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const lines = (x: string) => x.split("\n").map((y) => y.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean).slice(0, 12);
  const submit = async () => {
    if (!f.name.trim()) { setErr("Give the drill a name."); return; }
    if (!lines(how).length) { setErr("Add at least one step."); return; }
    setBusy(true); setErr("");
    try { await save({ ...f, name: f.name.trim().slice(0, 80), needs: f.needs.trim().slice(0, 120) || (f.who === "coach" ? "Team" : "Alone"), how: lines(how), points: lines(pts).length ? lines(pts) : ["Your own drill."], minutes: Math.max(1, Math.min(120, +f.minutes || 10)) }); onDone(); }
    catch (e) { setErr(e instanceof CloudError ? e.message : "Couldn't save it."); }
    setBusy(false);
  };
  return <section className="ac-form" aria-label={initial ? "Edit your drill" : "Add your own drill"}>
    <h2>{initial ? "Edit your drill" : "Add your own drill"}</h2>
    <div className="ac-form-grid">
      <label className="wide"><span>Name</span><input className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Seam serve battle" /></label>
      <label><span>Section</span><select className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>{AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label><span>Level</span><select className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as Level })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></label>
      <label><span>Who</span><select className="input" value={f.who} onChange={(e) => setF({ ...f, who: e.target.value as Who })}><option value="coach">Team drill</option><option value="player">On your own</option></select></label>
      <label><span>Minutes</span><input className="input" type="number" min={1} max={120} value={f.minutes} onChange={(e) => setF({ ...f, minutes: +e.target.value })} /></label>
      <label className="wide"><span>What it needs</span><input className="input" value={f.needs} maxLength={120} onChange={(e) => setF({ ...f, needs: e.target.value })} placeholder="Full team, two courts, a coach on a box" /></label>
      <label className="wide"><span>Steps (one per line)</span><textarea className="input" rows={4} value={how} onChange={(e) => setHow(e.target.value)} placeholder={"Servers serve tough to the seams.\nPassers rotate after three good passes."} /></label>
      <label className="wide"><span>Coaching points (one per line)</span><textarea className="input" rows={3} value={pts} onChange={(e) => setPts(e.target.value)} placeholder="Call early and loud." /></label>
    </div>
    {err && <p className="ac-form-err" role="alert">{err}</p>}
    <div className="ac-drill-acts"><button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : initial ? "Save changes" : "Save drill"}</button><button className="btn" onClick={onDone}>Cancel</button>
      {!(cloudAvailable() && currentUser()) && <span className="small muted">Saved on this device. Sign in to keep your drills on every device.</span>}</div>
  </section>;
}

export function Library({ who, coach }: { who: Who; coach: boolean }) {
  const { picks, teams, teamPicks, loadTeam } = usePicks(coach);
  const [area, setArea] = useState(""), [level, setLevel] = useState<Level | "">(""), [kind, setKind] = useState<Who | "">(who === "player" ? "player" : ""), [q, setQ] = useState("");
  const { lib: ownLib } = useOwn(), { favs } = useFavs();
  const [onlyFav, setOnlyFav] = useState(() => location.hash.includes("favorites")), [form, setForm] = useState<OwnDrill | "new" | null>(null);
  const all = useMemo(() => [...ownLib, ...visibleDrills(LIBRARY, { billing: BILLING, coach, ownPlan: false, picks: (picks || []).map((p) => p.drill) })], [picks, coach, ownLib]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter((x) => (!onlyFav || favs.includes(x.id)) && (!area || x.area === area) && (!level || x.level === level) && (!kind || x.who === kind)
    && words.every((w) => (x.name + " " + x.needs + " " + x.areaName + " " + x.how.join(" ") + " " + x.points.join(" ")).toLowerCase().includes(w)));
  const sendFor = (id: string) => coach && teams.length ? {
    teams, picked: (t: string) => (teamPicks[t] || []).includes(id),
    toggle: async (t: string, on: boolean) => { await rpc("team_pick_drill", { t, drill: id, pick: on, note: null }); await loadTeam(t); },
  } : undefined;
  const fromCoach = who === "player" && picks?.length ? picks.map((p) => ({ p, d: LIBRARY.find((x) => x.id === p.drill) || ownLib.find((x) => x.id === p.drill) })).filter((x) => x.d) : [];
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
      <div className="ac-libtools"><button className={"btn sm" + (onlyFav ? " primary" : "")} aria-pressed={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>★ Favorites ({favs.length})</button>
        <button className="btn sm" onClick={() => setForm("new")}>+ Add your own drill</button></div>
      {form && <DrillForm key={form === "new" ? "new" : form.id} initial={form === "new" ? null : form} area={area || undefined} onDone={() => setForm(null)} />}
      <div className="ac-chips" role="group" aria-label="Skill"><button aria-pressed={!area} onClick={() => setArea("")}>All skills</button>{AREAS.map((a) => <button key={a.id} aria-pressed={area === a.id} onClick={() => setArea(area === a.id ? "" : a.id)}>{a.name}</button>)}</div>
      <div className="ac-segrow">
        <div className="ac-seg" role="group" aria-label="Level"><button aria-pressed={!level} onClick={() => setLevel("")}>All levels</button>{LEVELS.map((l) => <button key={l} aria-pressed={level === l} onClick={() => setLevel(level === l ? "" : l)}>{l}</button>)}</div>
        <div className="ac-seg" role="group" aria-label="Who"><button aria-pressed={!kind} onClick={() => setKind("")}>Everything</button><button aria-pressed={kind === "player"} onClick={() => setKind("player")}>On your own</button><button aria-pressed={kind === "coach"} onClick={() => setKind("coach")}>Team drills</button></div>
      </div>
    </div>
    <p className="ac-count" aria-live="polite">{list.length === all.length ? `${list.length} drills` : `${list.length} of ${all.length} drills`}</p>
    {LEVELS.filter((l) => list.some((x) => x.level === l)).map((l) => <section key={l} className="ac-sec ac-lvlsec"><h2><span className={"ac-lvl " + l.toLowerCase()}>{l}</span> <small>{list.filter((x) => x.level === l).length}</small></h2>
      <ul className="ac-drills">{list.filter((x) => x.level === l).map((x) => <DrillRow key={x.id} d={x} category={x.category} who={who} send={sendFor(x.id)} onEdit={(d) => { setForm(d); scrollTo({ top: 0, behavior: "smooth" }); }} />)}</ul></section>)}
    {!list.length && onlyFav && !favs.length && <p className="ac-empty">No favorites yet. Tap the star on any drill to keep it here.</p>}
    {!list.length && !(onlyFav && !favs.length) && <p className="ac-empty">No drills match. <button className="linkbtn" onClick={() => { setArea(""); setLevel(""); setKind(""); setQ(""); }}>Clear the filters</button></p>}
  </article>;
}

/** Your own drills for one section, with a button to add one. Used on skill, strength and mental pages. */
export function OwnSection({ area, who, category, title = "Your own drills" }: { area: string; who: Who; category: string; title?: string }) {
  const { lib } = useOwn(), [form, setForm] = useState<OwnDrill | "new" | null>(null);
  const mine = lib.filter((x) => x.area === area);
  return <div className="ac-own">
    <div className="ac-libtools"><h3 className="ac-own-h">{title}{mine.length ? <small> {mine.length}</small> : null}</h3><button className="btn sm" onClick={() => setForm("new")}>+ Add your own</button></div>
    {form && <DrillForm key={form === "new" ? "new" : form.id} initial={form === "new" ? null : form} area={area} onDone={() => setForm(null)} />}
    {mine.length > 0 && <ul className="ac-drills">{mine.map((x) => <DrillRow key={x.id} d={x} category={category} who={who} onEdit={(d) => setForm(d)} />)}</ul>}
  </div>;
}
