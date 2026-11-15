/** Who can make each scheduled match: answers families and players gave on Floorcall Live. Names are shown to the team's staff only. */
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../../cloud/client";
import { isLinked } from "../../cloud/sync";
import { team } from "../../data/store";

export interface Rsvp { item: string; name: string; status: "yes" | "no" | "maybe"; at: string }
const LABEL = { yes: "Going", maybe: "Maybe", no: "Can't go" } as const;

/** All answers for the current team, or null when the team isn't synced or nobody is signed in. */
export function useAvailability(): Rsvp[] | null {
  const t = team()!, [list, setList] = useState<Rsvp[] | null>(null), ok = cloudAvailable() && !!currentUser() && isLinked(t.id);
  useEffect(() => { if (ok) rpc("rsvps_for_team", { t: t.id }).then((d) => setList(d || [])).catch(() => setList(null)); else setList(null); }, [t.id, ok]);
  return list;
}

export function AvailabilityLine({ item, all }: { item: string; all: Rsvp[] | null }) {
  if (!all) return null;
  const mine = all.filter((r) => r.item === item); if (!mine.length) return null;
  const by = (s: Rsvp["status"]) => mine.filter((r) => r.status === s).map((r) => r.name).sort();
  return <details className="mu-avail">
    <summary>{(["yes", "maybe", "no"] as const).filter((s) => by(s).length).map((s) => `${by(s).length} ${LABEL[s].toLowerCase()}`).join(" · ")}</summary>
    {(["yes", "maybe", "no"] as const).map((s) => by(s).length > 0 && <p key={s}><b>{LABEL[s]}:</b> {by(s).join(", ")}</p>)}
  </details>;
}
