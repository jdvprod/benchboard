/** Verified coaches: before a coach can put a team in the cloud (and invite assistants, players and families),
 * a Floorcall admin confirms they really coach at the school or club they name. Teams keep working on the device meanwhile. */
import { useEffect, useState } from "react";
import { CloudError, userMeta } from "./client";
import { coachRequest, coachStatus, CoachStatus } from "./sync";

let cache: CoachStatus | null = null;
export const useCoachStatus = () => {
  const [s, setS] = useState<CoachStatus | null>(cache);
  useEffect(() => { coachStatus().then((x) => { cache = x; setS(x); }).catch(() => setS({ status: "approved" })); }, []);
  return [s, (x: CoachStatus) => { cache = x; setS(x); }] as const;
};

export function CoachVerify({ s, onChange, name0 }: { s: CoachStatus; onChange: (x: CoachStatus) => void; name0?: string }) {
  const [f, setF] = useState({ name: s.name || name0 || userMeta().name || "", org: s.org || "", title: "Head coach", phone: "" }), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  if (s.status === "pending") return <div className="cv"><h4>Verifying your coach account</h4>
    <p className="small">Thanks{s.name ? ", " + s.name.split(" ")[0] : ""}. Floorcall checks that every team admin really coaches at {s.org || "their school or club"}, so players and families can trust who runs a team. That usually takes a day.</p>
    <p className="small muted" style={{ marginTop: 6 }}>Keep using Floorcall in the meantime: your team, stats and practices are saved on this device and sync as soon as you're verified.</p>
  </div>;
  const send = async () => {
    setBusy(true); setErr("");
    try { const st = await coachRequest(f); onChange({ status: st, name: f.name, org: f.org }); }
    catch (e) { setErr(e instanceof CloudError ? e.message : "Couldn't send that. Try again."); }
    setBusy(false);
  };
  return <div className="cv"><h4>Verify your coach account</h4>
    <div className="stack">
      <p className="small">{s.status === "denied" ? "We couldn't confirm your coaching role. Check the details below and send them again, or write to us from Settings → Help." : "To sync a team and invite assistants, players and families, Floorcall confirms you coach at the school or club you name. Assistant coaches don't need this: the head coach invites and approves them."}</p>
      <div className="two">
        <label className="field"><span className="label">Your name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
        <label className="field"><span className="label">School or club</span><input value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} placeholder="e.g. Clovis North High School" /></label>
      </div>
      <div className="two">
        <label className="field"><span className="label">Your role</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Head coach, club director…" /></label>
        <label className="field"><span className="label">Phone (optional)</span><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></label>
      </div>
      {err && <p className="hint" style={{ color: "var(--bad)" }}>{err}</p>}
      <div className="row"><button className="btn primary" disabled={busy || f.name.trim().length < 2 || f.org.trim().length < 2} onClick={send}>{busy ? "Sending…" : "Ask to be verified"}</button></div>
    </div>
  </div>;
}
