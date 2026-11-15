/** Availability on Floorcall Live: a signed-in follower tells the coaches whether they can make a scheduled match.
 * Everyone signed in sees the counts and their own answer; names go to the team's coaches only. */
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../cloud/client";
import { MiniAuth } from "../cloud/MiniAuth";
import { tr } from "../lib/i18n";

export type Answer = "yes" | "no" | "maybe";
export interface Tally { yes: number; no: number; maybe: number; mine: Answer | null }
const OPTS: [Answer, string][] = [["yes", "Going"], ["maybe", "Maybe"], ["no", "Can't go"]];

/** Loads the answers for a team page and saves changes; null until loaded (or when signed out). */
export function useRsvps(code: string) {
  const [, bump] = useState(0), [all, setAll] = useState<Record<string, Tally> | null>(null), signed = !!currentUser(), on = cloudAvailable();
  useEffect(() => { if (on && signed) rpc("rsvps_by_code", { c: code }).then((d) => setAll(d || {})).catch(() => setAll(null)); }, [code, signed, on]);
  const answer = (item: string, s: Answer) => {
    if (!all) return;
    const cur = all[item] || { yes: 0, no: 0, maybe: 0, mine: null }, next = cur.mine === s ? null : s, n = { ...cur, mine: next };
    if (cur.mine) n[cur.mine] = Math.max(0, n[cur.mine] - 1); if (next) n[next]++;
    setAll({ ...all, [item]: n }); // show it right away; put it back if the save fails
    rpc("rsvp_set", { c: code, item, s: next || "" }).catch(() => setAll((a) => (a ? { ...a, [item]: cur } : a)));
  };
  return { on, signed, all, answer, refresh: () => bump((x) => x + 1) };
}

export function RsvpRow({ item, label, R }: { item: string; label: string; R: ReturnType<typeof useRsvps> }) {
  if (!R.on || !R.signed || !R.all) return null;
  const t = R.all[item] || { yes: 0, no: 0, maybe: 0, mine: null };
  return <div className="lv-rsvp" role="group" aria-label={tr("Can you make it?") + " " + label}>
    {OPTS.map(([k, l]) => <button key={k} className={k + (t.mine === k ? " on" : "")} aria-pressed={t.mine === k} onClick={() => R.answer(item, k)}>{tr(l)}{t[k] > 0 && <span className="n">{t[k]}</span>}</button>)}
  </div>;
}

/** Shown under the schedule to someone who isn't signed in. */
export function RsvpSignIn({ R, team }: { R: ReturnType<typeof useRsvps>; team: string }) {
  const [open, setOpen] = useState(false);
  if (!R.on || R.signed) return null;
  return open ? <MiniAuth kind="parent" title={tr("Tell the coaches if you can make it")} t={tr} onIn={R.refresh} />
    : <button className="ma-link lv-rsvp-in" onClick={() => setOpen(true)}>{tr("Sign in to tell {team}'s coaches if you can make it", { team })}</button>;
}

/* ---------- volunteer jobs ---------- */
export interface JobTally { n: number; mine: boolean }
export function useJobs(code: string) {
  const [all, setAll] = useState<Record<string, JobTally> | null>(null), [err, setErr] = useState(""), signed = !!currentUser(), on = cloudAvailable();
  useEffect(() => { if (on && signed) rpc("jobs_by_code", { c: code }).then((d) => setAll(d || {})).catch(() => setAll(null)); }, [code, signed, on]);
  const take = (item: string, job: string, yes: boolean) => {
    if (!all) return; const k = item + "/" + job, cur = all[k] || { n: 0, mine: false };
    setAll({ ...all, [k]: { n: Math.max(0, cur.n + (yes ? 1 : -1)), mine: yes } }); setErr("");
    rpc("job_take", { c: code, item, job, take: yes }).catch((e) => { setAll((a) => (a ? { ...a, [k]: cur } : a)); setErr(e?.message || tr("Couldn't save. Check your connection.")); });
  };
  return { on, signed, all, take, err };
}

export function JobRow({ item, jobs, J }: { item: string; jobs: { id: string; name: string; need: number }[]; J: ReturnType<typeof useJobs> }) {
  if (!jobs.length || !J.on || !J.signed || !J.all) return null;
  return <div className="lv-jobs" role="group" aria-label={tr("Volunteer")}>
    <span className="lv-jobs-h">{tr("Volunteers needed")}</span>
    {jobs.map((j) => { const t = J.all![item + "/" + j.id] || { n: 0, mine: false }, full = t.n >= j.need && !t.mine;
      return <div key={j.id} className={"lv-job" + (t.mine ? " mine" : "") + (t.n >= j.need ? " full" : "")}>
        <span><b>{j.name}</b> <span className="lv-note">{Math.min(t.n, j.need)}/{j.need}</span></span>
        {t.mine ? <button className="btn sm" onClick={() => J.take(item, j.id, false)} aria-label={tr("Drop out of {job}", { job: j.name })}>{tr("You're on it")} ✓</button>
          : full ? <span className="lv-note">{tr("Covered")}</span>
          : <button className="btn sm primary" onClick={() => J.take(item, j.id, true)} aria-label={tr("Sign up for {job}", { job: j.name })}>{tr("Sign up")}</button>}
      </div>; })}
    {J.err && <p className="lv-note" role="alert" style={{ color: "var(--bad)" }}>{J.err}</p>}
  </div>;
}
