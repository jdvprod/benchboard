/** "You don't have access to this site." Each FloorCall site has its own sign-in; when the account signed in here isn't
 * set up for this site (a player's account on the coaching app with no team, an athlete in Lessons whose trainer hasn't
 * added them, later a plan that doesn't include the site) this says so and what to do: enter a code, ask the coach or
 * club admin, check the plan, or sign in with a different account. FloorCall admins never see it. */
import { useEffect, useRef, useState } from "react";
import { cloudAvailable, currentUser, rpc, signOut, userMeta } from "./client";
import { contactUrl, placeUrl } from "./links";
import { CodeBox } from "./CodeBox";
import "./accessnote.css";

export type AccessReason = "team" | "trainer" | "plan" | "role";
interface Coverage { teams: { id: string; name: string; role: string }[]; lessons: { athlete: string; trainer: string }[] }

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const SAY: Record<AccessReason, (site: string) => string> = {
  team: (site) => `${cap(site)} is for coaching staff and the players and parents on a team that uses it. This account isn't on a team yet.`,
  trainer: () => "FloorCall Lessons is for athletes whose trainer uses it. No trainer has added this account yet.",
  plan: (site) => `Your FloorCall plan doesn't include ${site}.`,
  role: (site) => `This account isn't set up for ${site}.`,
};

export function AccessNote({ site, from, reason, onClose, onCode }: { site: string; from: string; reason: AccessReason; onClose?: () => void; onCode?: () => void }) {
  const box = useRef<HTMLDivElement>(null), email = currentUser()?.email || "";
  useEffect(() => { box.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape" && onClose) onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  const pricing = placeUrl("home").replace(/[^/]*$/, "") + "pricing.html";
  return <div className="an-back" role="presentation">
    <div className="an" role="alertdialog" aria-modal="true" aria-labelledby="an-h" aria-describedby="an-p" tabIndex={-1} ref={box}>
      <h2 id="an-h">You don't have access to {site}</h2>
      <p id="an-p">{SAY[reason](site)}{email && <> You're signed in as <b>{email}</b>.</>}</p>
      <ul className="an-ways">
        {(reason === "team" || reason === "trainer") && <li><b>Have a code?</b> {onCode ? <button className="an-link" onClick={onCode}>Enter the code from your {reason === "trainer" ? "trainer" : "coach"}</button> : <span>Enter it below.</span>}</li>}
        <li><b>Contact your {reason === "trainer" ? "trainer" : "coach or club admin"}</b> and ask them to add this email{reason === "plan" ? " to their plan" : ""}.</li>
        <li><b>Check your plan.</b> <a href={pricing}>See what each plan includes</a></li>
      </ul>
      {reason === "team" && !onCode && <CodeBox site={from} onDone={() => setTimeout(() => location.reload(), 900)} />}
      {reason === "team" && <p className="an-live">Following a team? <a href={placeUrl("live")}>FloorCall Live</a> is free, with no account.</p>}
      <div className="an-acts">
        <button className="btn" onClick={() => { signOut(); location.reload(); }}>Use a different account</button>
        <a className="btn" href={contactUrl(from, "question", `No access: ${reason}`)}>Contact FloorCall</a>
        {onClose && <button className="btn primary" onClick={onClose}>OK</button>}
      </div>
    </div>
  </div>;
}

/** The coaching app: a player's, parent's or fan's account that isn't on any team gets the note. Coaches can always
 * start a team (that's the free trial). */
export function AppAccess() {
  const [why, setWhy] = useState<AccessReason | null>(null);
  useEffect(() => {
    if (!cloudAvailable() || !currentUser()) return;
    const k = userMeta().kind; if (!k || k === "coach") return;
    Promise.all([rpc("my_coverage", {}) as Promise<Coverage>, rpc("coach_status", {}).catch(() => null)])
      .then(([c, s]) => { if (!s?.admin && !c.teams.length) setWhy("team"); }).catch(() => {});
  }, []);
  if (!why) return null;
  return <AccessNote site="the FloorCall coaching app" from="app" reason={why} />;
}
