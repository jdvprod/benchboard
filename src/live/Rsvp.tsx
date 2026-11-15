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
