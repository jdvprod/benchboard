/** Who can make each scheduled match: answers families and players gave on Floorcall Live. Names are shown to the team's staff only. */
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../../cloud/client";
import { isLinked } from "../../cloud/sync";
import { player, team } from "../../data/store";
import type { Job, ScheduleItem } from "../../data/model";

export interface Rsvp { item: string; name: string; status: "yes" | "no" | "maybe"; player?: string | null; at: string }
const LABEL = { yes: "Going", maybe: "Maybe", no: "Can't go" } as const;

/** Bumps when the coach comes back to the app, so answers and sign-ups made meanwhile show up. */
function useComeBack() { const [n, setN] = useState(0); useEffect(() => { const f = () => { if (!document.hidden) setN((x) => x + 1); }; document.addEventListener("visibilitychange", f); addEventListener("focus", f); return () => { document.removeEventListener("visibilitychange", f); removeEventListener("focus", f); }; }, []); return n; }

/** All answers for the current team, or null when the team isn't synced or nobody is signed in. */
export function useAvailability(): Rsvp[] | null {
  const t = team()!, [list, setList] = useState<Rsvp[] | null>(null), ok = cloudAvailable() && !!currentUser() && isLinked(t.id), back = useComeBack();
  useEffect(() => { if (ok) rpc("rsvps_for_team", { t: t.id }).then((d) => setList(d || [])).catch(() => setList(null)); else setList(null); }, [t.id, ok, back]);
  return list;
}

export function AvailabilityLine({ item, all }: { item: string; all: Rsvp[] | null }) {
  if (!all) return null;
  const mine = all.filter((r) => r.item === item); if (!mine.length) return null;
  const who = (r: Rsvp) => { const p = r.player ? player(r.player) : null; return p ? `#${p.num} ${p.first || ""}`.trim() + ` (${r.name})` : r.name; };
  const by = (s: Rsvp["status"]) => mine.filter((r) => r.status === s).map(who).sort();
  const out = mine.filter((r) => r.player && r.status !== "yes").map((r) => ({ p: player(r.player!), s: r.status })).filter((x) => x.p);
  return <details className="mu-avail">
    <summary>{out.length ? `${out.length} ${out.length === 1 ? "player" : "players"} may miss it · ` : ""}{(["yes", "maybe", "no"] as const).filter((s) => by(s).length).map((s) => `${by(s).length} ${LABEL[s].toLowerCase()}`).join(" · ")}</summary>
    {out.length > 0 && <p className="mu-out"><b>Players who may miss it:</b> {out.map((x) => `#${x.p!.num} ${x.p!.first}${x.s === "maybe" ? " (maybe)" : ""}`).join(", ")}</p>}
    {(["yes", "maybe", "no"] as const).map((s) => by(s).length > 0 && <p key={s}><b>{LABEL[s]}:</b> {by(s).join(", ")}</p>)}
  </details>;
}

/* ---------- volunteer jobs for a match ---------- */
export interface Signup { item: string; job: string; name: string; at: string }
const PRESETS: [string, number][] = [["Line judge", 2], ["Scorebook", 1], ["Libero tracker", 1], ["Snacks", 1], ["Admissions table", 2], ["Video", 1]];

export function useSignups(): Signup[] | null {
  const t = team()!, [list, setList] = useState<Signup[] | null>(null), ok = cloudAvailable() && !!currentUser() && isLinked(t.id), back = useComeBack();
  useEffect(() => { if (ok) rpc("jobs_for_team", { t: t.id }).then((d) => setList((old) => d || old || [])).catch(() => {}); else setList(null); }, [t.id, ok, back]);
  return list;
}

/** The coach adds jobs to a scheduled match; families sign up on Floorcall Live; the names show here. */
export function JobsEditor({ s, onSave, signups }: { s: ScheduleItem; onSave: (jobs: Job[]) => void; signups: Signup[] | null }) {
  const jobs = s.jobs || [], [name, setName] = useState(""), [need, setNeed] = useState(1);
  const add = (n: string, k: number) => { const nm = n.trim().slice(0, 40); if (!nm || jobs.some((j) => j.name.toLowerCase() === nm.toLowerCase())) return; onSave(jobs.concat({ id: "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: nm, need: Math.max(1, Math.min(10, k)) })); };
  const who = (j: Job) => (signups || []).filter((x) => x.item === s.id && x.job === j.id).map((x) => x.name);
  const filled = jobs.reduce((a, j) => a + Math.min(who(j).length, j.need), 0), needed = jobs.reduce((a, j) => a + j.need, 0);
  return <details className="mu-jobs">
    <summary>{jobs.length ? `Volunteers: ${signups ? `${filled} of ${needed} filled` : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}` : "Add volunteer jobs"}</summary>
    {jobs.length > 0 && <ul>{jobs.map((j) => { const w = who(j); return <li key={j.id}>
      <span><b>{j.name}</b> <span className="muted">{signups ? `${Math.min(w.length, j.need)}/${j.need}` : `needs ${j.need}`}</span>{w.length > 0 && <span className="small"> · {w.join(", ")}</span>}</span>
      <button className="btn sm ghost" aria-label={"Remove " + j.name} onClick={() => onSave(jobs.filter((x) => x.id !== j.id))}>✕</button></li>; })}</ul>}
    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{PRESETS.filter(([n]) => !jobs.some((j) => j.name === n)).map(([n, k]) => <button key={n} className="btn sm" onClick={() => add(n, k)}>+ {n}{k > 1 ? ` ×${k}` : ""}</button>)}</div>
    <form className="row" style={{ gap: 6, marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); add(name, need); setName(""); setNeed(1); }}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Another job" aria-label="Job name" maxLength={40} style={{ flex: "1 1 140px" }} />
      <input className="input" type="number" min={1} max={10} value={need} onChange={(e) => setNeed(+e.target.value || 1)} aria-label="People needed" style={{ width: 70 }} />
      <button className="btn sm" disabled={!name.trim()}>Add</button>
    </form>
    <p className="keys">Families following your team page sign up on Floorcall Live (free account). They see how many spots are left; you see the names.</p>
  </details>;
}

/** The next scheduled match and the players whose families said they may miss it (shown on the lineup page). */
export function NextMatchOuts({ inLineup }: { inLineup: string[] }) {
  const t = team()!, all = useAvailability(), today = new Date().toISOString().slice(0, 10);
  const next = (t.schedule || []).filter((x) => x.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  if (!all || !next) return null;
  const out = all.filter((r) => r.item === next.id && r.player && r.status !== "yes").map((r) => ({ p: player(r.player!), s: r.status })).filter((x) => x.p);
  if (!out.length) return null;
  const when = new Date(next.date + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return <p className="banner mu-next-out" role="status"><b>{next.site === "away" ? "At" : "Vs"} {next.opp}, {when}:</b> {out.map((x) => `#${x.p!.num} ${x.p!.first}${x.s === "maybe" ? " (maybe)" : " can't make it"}${inLineup.includes(x.p!.id) ? ", in this lineup" : ""}`).join("; ")}.</p>;
}
