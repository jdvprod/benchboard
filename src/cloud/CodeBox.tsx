/** "Got a code from your coach or trainer?" One box on the player-facing sites (Academy, Beach, Recruit) that takes
 * either a team code (joins the team, so the team's plan covers the player) or a FloorCall Lessons code. Once someone
 * is on a team or in a trainer's lessons, it says what covers them instead. Coaches never see it. */
import { useEffect, useState } from "react";
import { CloudError, cloudAvailable, currentUser, rpc, TOO_MANY, tooMany, userMeta } from "./client";
import { placeUrl } from "./links";
import "./codebox.css";

interface Coverage { teams: { id: string; name: string; role: string }[]; lessons: { athlete: string; trainer: string }[] }

export function CodeBox({ site }: { site: string }) {
  const [cov, setCov] = useState<Coverage | null>(null), [open, setOpen] = useState(false), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [done, setDone] = useState<null | { kind: string; name: string }>(null);
  const show = cloudAvailable() && !!currentUser() && userMeta().kind !== "coach";
  const load = () => rpc("my_coverage", {}).then(setCov).catch(() => setCov({ teams: [], lessons: [] }));
  useEffect(() => { if (show) load(); }, [show]);
  if (!show || !cov) return null;
  const redeem = async () => {
    setBusy(true); setErr("");
    try { const r = await rpc("redeem_code", { invite: code.trim() }); setDone(r); setCode(""); setOpen(false); await load(); }
    catch (e) { setErr(tooMany(e) ? TOO_MANY : e instanceof CloudError ? e.message : "Couldn't reach FloorCall. Try again."); }
    setBusy(false);
  };
  const parts = [...cov.teams.map((t) => t.name).filter(Boolean), ...cov.lessons.map((l) => `lessons with ${l.trainer}`)];
  return <div className="cb" data-site={site}>
    {done && <p className="cb-done" role="status">{done.kind === "team" ? `You're on ${done.name || "the team"}.` : <>You're in {done.name}'s lessons. <a href={placeUrl("lessons")}>Open FloorCall Lessons</a></>}</p>}
    {parts.length > 0 && <p className="cb-cov"><span>Included with</span> {parts.join(", ")}</p>}
    {!open ? <button className="cb-open" onClick={() => setOpen(true)}>{parts.length ? "Have another code?" : "Have a code from your coach or trainer?"}</button>
      : <div className="cb-form">
        <label className="cb-label" htmlFor={"cb-" + site}>Code from your coach or trainer</label>
        <div className="cb-row"><input id={"cb-" + site} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={12} autoCapitalize="characters" autoFocus />
          <button className="cb-go" disabled={busy || code.trim().length < 4} onClick={redeem}>{busy ? "Joining…" : "Join"}</button>
          <button className="cb-x" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button></div>
        <p className="cb-hint">A team code joins your team; a Lessons code joins your private lessons. What your coach or trainer pays for is free for you.</p>
        {err && <p className="cb-err" role="alert">{err}</p>}
      </div>}
  </div>;
}
