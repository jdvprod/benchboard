import { useState } from "react";
import { LEGAL } from "../../app/legal";
import { createTeam, toast } from "../../data/store";
import { addStarterDrills, createSampleTeam } from "../../data/seed";
import { importBackup } from "../../data/backup";
import { go } from "../../app/router";
import { AuthShell } from "../../cloud/AuthPage";
import { cloudAvailable, currentUser } from "../../cloud/client";
import { joinWithCode, linkTeam } from "../../cloud/sync";

const LEVELS = ["Varsity", "JV", "Frosh/Soph", "Middle school", "14U Club", "15U Club", "16U Club", "17U Club", "18U Club", "College"];

export function NewTeamForm({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState(""), [level, setLevel] = useState("Varsity");
  return <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const t = createTeam({ name: name.trim(), level }); addStarterDrills(t.id); toast("Team created"); if (cloudAvailable() && currentUser()) linkTeam(t.id).catch(() => {}); onDone?.(); go("team"); }}>
    <div className="auth-field"><label htmlFor="nt-name">Team name</label><input id="nt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Clovis North Broncos" autoFocus /></div>
    <div className="auth-field"><label htmlFor="nt-level">Level</label><input id="nt-level" list="levels" value={level} onChange={(e) => setLevel(e.target.value)} /><datalist id="levels">{LEVELS.map((l) => <option key={l} value={l} />)}</datalist></div>
    <button className="auth-btn" type="submit" disabled={!name.trim()}>Create team</button>
  </form>;
}

export function Welcome() {
  const [msg, setMsg] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const user = currentUser();
  const onFile = (f?: File | null) => { if (!f) return; const r = new FileReader(); r.onload = () => { const res = importBackup(String(r.result || "")); setMsg(res.message); if (res.ok) go("team"); }; r.readAsText(f); };
  return <AuthShell>
    <h1 className="auth-title">Set up your team</h1>
    <p className="auth-sub">{user ? <>Signed in as <b>{user.email}</b>. Add your team, or join one a coach invited you to.</> : "Add your team to start tracking. You can change any of this later."}</p>
    <NewTeamForm />
    <div className="auth-or"><span>or</span></div>
    <div className="auth-alt">
      {cloudAvailable() && user && <form className="auth-join" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMsg(""); try { await joinWithCode(code); toast("Joined the team"); go("track"); } catch (err: any) { setMsg(err?.message || "That code didn't work."); } setBusy(false); }}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Invite code" aria-label="Invite code" maxLength={8} />
        <button className="btn" disabled={busy || code.trim().length < 4}>Join team</button>
      </form>}
      <button className="auth-alt-btn" onClick={() => { createSampleTeam(); go("track"); }}><b>Explore a sample team</b><span>Five matches already tracked, so every screen is filled in.</span></button>
      <label className="auth-alt-btn"><b>Import a backup</b><span>From Bench Stats or another device.</span><input type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
      {cloudAvailable() && !user && <button className="auth-alt-btn" onClick={() => go("account")}><b>Sign in</b><span>Already have an account? Your teams come with you.</span></button>}
    </div>
    {msg && <p className="auth-err box" role="alert">{msg}</p>}
    <p className="auth-legal" style={{ marginTop: 18 }}>By using Benchboard you agree to the <a href={LEGAL.terms} target="_blank" rel="noopener">Terms</a> and <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy Policy</a>. Only add players you have permission to track.</p>
  </AuthShell>;
}
