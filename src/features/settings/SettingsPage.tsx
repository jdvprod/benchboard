import { useEffect, useState } from "react";
import { FORMATS, SCORING } from "../track/TrackPage";
import { canPrompt, installed, isIOS, onInstallChange, promptInstall } from "../../app/install";
import { all, setPrefs, setSettings, state, team, toast } from "../../data/store";
import { Card, ConfirmButton, Seg, SetRow, Switch } from "../../ui/kit";
import { ask, AiError, getKey, setKey } from "../../ai/client";
import { cloudAvailable, currentUser, fn, rpc, setConfig, signOut } from "../../cloud/client";
import { deleteAccount, isLinked } from "../../cloud/sync";
import { LEGAL, LEGAL_EMAIL } from "../../app/legal";
import { eraseDevice } from "../../data/db";
import { go } from "../../app/router";

export function SettingsPage() {
  const t = team()!, s = t.settings, p = state.prefs;
  const [key, setK] = useState(getKey()), [show, setShow] = useState(false), [testing, setTesting] = useState(false), [msg, setMsg] = useState("");
  const test = async () => {
    setKey(key.trim()); setTesting(true); setMsg("");
    try { await ask("Reply with the single word: ready", { tier: "quick", maxTokens: 10 }); setMsg("Connected. AI features are on."); }
    catch (e) { setMsg(e instanceof AiError ? e.message : "Couldn't connect."); }
    setTesting(false);
  };
  const counts = { teams: all("teams").length, players: all("players").length, matches: all("matches").length, events: all("logs").reduce((n, l) => n + l.events.length, 0) };
  return <div className="page" style={{ maxWidth: 820 }}>
    <div className="pagehead"><h1>Settings</h1></div>
    <Card title="Look">
      <SetRow title="Theme" sub="System follows your device's light or dark mode."><Seg value={p.theme} onChange={(v) => setPrefs({ theme: v })} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} label="Theme" /></SetRow>
      <SetRow title="Text and button size" sub="Large is easier to hit on a tablet courtside."><Seg value={p.size} onChange={(v) => setPrefs({ size: v })} options={[["normal", "Normal"], ["large", "Large"]]} label="Size" /></SetRow>
      <SetRow title="Team color" sub="Change it on the Team tab."><button className="btn sm" onClick={() => go("team")}>Team tab</button></SetRow>
    </Card>
    <Card title={`Tracking · ${t.name}`}>
      <SetRow title="Ask where the ball landed" sub="After kills, aces, serves and passes, tap the court. Feeds the tendency court."><Switch checked={s.askLoc} onChange={(v) => setSettings({ askLoc: v })} label="Ask where the ball landed" /></SetRow>
      <SetRow title="Also ask after digs" sub="Shows where you dig their attacks. One more tap per dig."><Switch checked={s.askLocDigs} disabled={!s.askLoc} onChange={(v) => setSettings({ askLocDigs: v })} label="Ask after digs" /></SetRow>
      <SetRow title="Ask for their jersey number" sub="After their kills, aces and errors, so you can scout their players."><Switch checked={s.askOpp} onChange={(v) => setSettings({ askOpp: v })} label="Ask for their number" /></SetRow>
      <SetRow title="Subs allowed per set" sub="0 means no limit. High school is usually 15, club 12 or 15."><input className="input" style={{ width: 80 }} type="number" min={0} max={30} value={s.subLimit} onChange={(e) => setSettings({ subLimit: Math.max(0, +e.target.value || 0) })} aria-label="Subs per set" /></SetRow>
      <SetRow title="Default match format"><div className="row"><Seg value={s.bestOf} onChange={(v) => setSettings({ bestOf: v })} options={FORMATS} label="Format" /><select className="input" style={{ width: "auto" }} value={s.scoring || "25"} onChange={(e) => setSettings({ scoring: e.target.value })} aria-label="Scoring">{SCORING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div></SetRow>
      <SetRow title="Zone numbers on drawing boards"><Switch checked={!s.hideZones} onChange={(v) => setSettings({ hideZones: !v })} label="Show zone numbers" /></SetRow>
    </Card>
    <Card title="Labs">
      <SetRow title="Try new features" sub="Formations, type-in stat codes and focus mode. Turn on only what you want."><button className="btn sm" onClick={() => go("labs")}>Open Labs</button></SetRow>
    </Card>
    <InstallCard />
    <Card title="AI features">
      <div className="stack">
        <p className="small muted">Timeout talking points, match reports, scouting, lineup suggestions, practice plans and player report cards use Claude. Signed-in coaches can use them with no setup. To use your own Anthropic account instead (no daily limit), paste an API key from console.anthropic.com; it stays on this device only.</p>
        <div className="row">
          <input className="input grow" type={show ? "text" : "password"} value={key} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" autoComplete="off" aria-label="API key" style={{ minWidth: 200 }} />
          <button className="btn sm" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!key.trim() || testing} onClick={test}>{testing ? "Testing…" : "Save and test"}</button>
          {getKey() && <button className="btn" onClick={() => { setKey(""); setK(""); setMsg("Key removed."); }}>Remove key</button>}
        </div>
        {msg && <p className="hint">{msg}</p>}
      </div>
    </Card>
    <CloudSettings />
    <SetupCheck />
    <Card title="Your data">
      <p className="small">Saved on this device: {counts.teams} teams, {counts.players} players, {counts.matches} matches and practices, {counts.events.toLocaleString()} recorded plays.</p>
      <p className="small muted" style={{ marginTop: 6 }}>{state.persistent ? "Your browser has agreed to keep this data." : "Your browser may clear this data if space runs low."} Save a backup from Team → Backup to move data to another device or keep a copy.</p>
      <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => go("team")}>Backup & restore</button><button className="btn sm" onClick={() => { location.reload(); toast("Reloaded"); }}>Reload app</button></div>
    </Card>
    <PrivacyCard />
    <p className="small muted" style={{ textAlign: "center" }}>Benchboard 2.0 · <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy</a> · <a href={LEGAL.terms} target="_blank" rel="noopener">Terms</a></p>
  </div>;
}

function CloudSettings() {
  const own = (() => { try { return JSON.parse(localStorage.getItem("bs-cloud-config") || "null"); } catch { return null; } })();
  const [url, setUrl] = useState(own?.url || ""), [key, setKeyV] = useState(own?.key || ""), [open, setOpen] = useState(!!own);
  const user = currentUser();
  return <Card title="Cloud">
    <SetRow title="Account" sub={cloudAvailable() ? (user ? "Signed in as " + user.email + ". Sync and sharing are on the Team tab." : "Sign in on the Team tab to sync teams and share them with other coaches.") : "Cloud sync isn't set up in this version."}>
      {user ? <button className="btn sm" onClick={() => { signOut(); toast("Signed out"); }}>Sign out</button> : <button className="btn sm" onClick={() => go("team")}>Team tab</button>}
    </SetRow>
    {!open ? <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Use my own Supabase project</button> : <div className="stack" style={{ marginTop: 8 }}>
      <p className="small muted">For developers and testing. Paste the Project URL and anon public key from Supabase → Project Settings → API. Leave empty to use the app's built-in project.</p>
      <div className="two">
        <label className="field"><span className="label">Project URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
        <label className="field"><span className="label">Anon public key</span><input value={key} onChange={(e) => setKeyV(e.target.value)} placeholder="eyJ…" /></label>
      </div>
      <div className="row"><button className="btn sm primary" onClick={() => { setConfig(url.trim() && key.trim() ? { url: url.trim(), key: key.trim() } : null); toast("Saved. Reloading…"); setTimeout(() => location.reload(), 600); }}>Save</button></div>
    </div>}
  </Card>;
}

function InstallCard() {
  const [, setN] = useState(0);
  useEffect(() => onInstallChange(() => setN((x) => x + 1)), []);
  if (installed()) return null;
  return <Card title="Install the app">
    <p className="small muted">Put Benchboard on your home screen. It opens full screen, works without signal in the gym, and keeps your data on the device.</p>
    {canPrompt() ? <button className="btn primary" onClick={async () => { if (await promptInstall()) toast("Installed"); }}>Install Benchboard</button>
      : isIOS() ? <p className="small">On iPhone or iPad: tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.</p>
      : <p className="small">In Chrome or Edge, use the install icon in the address bar, or the browser menu → <b>Install Benchboard</b>.</p>}
  </Card>;
}

/** Setup check: walks through what the live app needs (Supabase schema, sign-in, sync, AI) and says what's missing. */
const SCHEMA_VERSION = 7;
type Check = { label: string; state: "ok" | "warn" | "todo" | "wait"; detail: string };
function SetupCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null), [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const out: Check[] = [], t = team();
    if (!cloudAvailable()) { out.push({ label: "Cloud project", state: "todo", detail: "No Supabase project is set for this app. Put your Project URL and anon key in src/cloud/config.ts." }); setChecks(out); setBusy(false); return; }
    out.push({ label: "Cloud project", state: "ok", detail: "The app has a Supabase project URL and key." });
    try {
      const v = await rpc("schema_version", {}, true);
      out.push(+v >= SCHEMA_VERSION ? { label: "Database", state: "ok", detail: `Tables and functions are up to date (version ${v}).` } : { label: "Database", state: "todo", detail: `The database is on version ${v}; the app needs ${SCHEMA_VERSION}. Run the latest supabase/schema.sql in Supabase → SQL Editor.` });
    } catch (e: any) {
      out.push(e?.status === 0 ? { label: "Database", state: "warn", detail: "Couldn't reach Supabase. Check your connection, or that the project isn't paused (free projects pause after a week without use)." }
        : { label: "Database", state: "todo", detail: "The tables aren't set up yet (or are from an older version). Run supabase/schema.sql in Supabase → SQL Editor." });
    }
    const user = currentUser();
    out.push(user ? { label: "Your account", state: "ok", detail: "Signed in as " + user.email + "." } : { label: "Your account", state: "todo", detail: "Sign in or create an account (Team tab or the avatar in the corner)." });
    if (t && !t.sample) out.push(isLinked(t.id) ? { label: "Team sync", state: "ok", detail: `${t.name} syncs to the cloud. Invite coaches from the Team tab.` } : { label: "Team sync", state: user ? "todo" : "wait", detail: user ? `Tap "Sync this team" on the Team tab so ${t.name} is backed up and shareable.` : "After you sign in, turn on sync for your team on the Team tab." });
    if (getKey()) out.push({ label: "AI features", state: "ok", detail: "Using your own Anthropic key on this device." });
    else if (!user) out.push({ label: "AI features", state: "wait", detail: "Sign in first; then this checks the server AI." });
    else {
      try { await fn("ai", { ping: true }); out.push({ label: "AI features", state: "ok", detail: "The ai Edge Function is deployed and has its Anthropic key." }); }
      catch (e: any) {
        out.push(e?.status === 404 ? { label: "AI features", state: "todo", detail: "The ai Edge Function isn't deployed. Supabase → Edge Functions → Deploy a new function → Via Editor, name it ai, paste supabase/functions/ai/index.ts." }
          : e?.status === 503 ? { label: "AI features", state: "todo", detail: "The ai function is deployed but has no key. Supabase → Edge Functions → Secrets: add ANTHROPIC_API_KEY." }
          : { label: "AI features", state: "warn", detail: "The ai function didn't answer: " + (e?.message || "unknown error") + "." });
      }
    }
    out.push(LEGAL_EMAIL ? { label: "Privacy contact", state: "ok", detail: "Your Privacy Policy and Terms list " + LEGAL_EMAIL + " for questions." } : { label: "Privacy contact", state: "todo", detail: "Your Privacy Policy needs a contact email for privacy requests. Add it as legal.email in package.json (or ask your developer)." });
    out.push(installed() ? { label: "Installed on this device", state: "ok", detail: "Opened from the home screen." } : { label: "Installed on this device", state: "warn", detail: "Optional: add it to your home screen (see Install the app above) so it opens full screen and works offline." });
    setChecks(out); setBusy(false);
  };
  return <Card title="Setup check" actions={<button className="btn sm" disabled={busy} onClick={run}>{busy ? "Checking…" : checks ? "Check again" : "Run check"}</button>}>
    {!checks ? <p className="small muted">Checks the database, your account, team sync and AI, and tells you exactly what's left to set up.</p>
      : <ul className="check-list">{checks.map((c) => <li key={c.label} className={"sc-" + c.state}><span className="sc-dot" aria-hidden="true">{c.state === "ok" ? "✓" : c.state === "todo" ? "!" : "·"}</span><div><b>{c.label}</b><p className="small" style={{ margin: 0 }}>{c.detail}</p></div></li>)}</ul>}
  </Card>;
}

/** Privacy, legal documents and deleting data. */
function PrivacyCard() {
  const user = currentUser(), t = team();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "deleted">("idle"), [typed, setTyped] = useState(""), [err, setErr] = useState("");
  const erase = async () => { await eraseDevice(); location.replace(location.pathname); };
  return <Card title="Privacy and your data">
    <div className="stack">
      <div className="row"><a className="btn sm" href={LEGAL.privacy} target="_blank" rel="noopener">Privacy Policy</a><a className="btn sm" href={LEGAL.terms} target="_blank" rel="noopener">Terms of Service</a>
        <a className="btn sm" href={LEGAL.consent + (t ? "#team=" + encodeURIComponent(t.name) : "")} target="_blank" rel="noopener">Parent and guardian form</a></div>
      <p className="small muted" style={{ margin: 0 }}>Benchboard doesn't sell data, show ads or track you. Export everything any time from Team → Backup.</p>
      {user ? <>
        {step === "idle" && <SetRow title="Delete your account" sub="Removes your account and every cloud team you own (for everyone on it), and takes you off other teams. Data on this device stays unless you erase it too."><button className="btn sm" onClick={() => setStep("confirm")}>Delete account</button></SetRow>}
        {step === "confirm" && <div className="banner warn" style={{ display: "block" }}>
          <p><b>This can't be undone.</b> Cloud teams you own are deleted for every coach and viewer on them, along with their share links. Save a backup first if you might want the data. Type <b>DELETE</b> to confirm.</p>
          <div className="row" style={{ marginTop: 8 }}><input className="input" style={{ width: 140 }} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm" />
            <button className="btn sm danger" disabled={typed.trim() !== "DELETE"} onClick={async () => { setStep("busy"); setErr(""); try { await deleteAccount(); signOut(); setStep("deleted"); toast("Account deleted"); } catch (e: any) { setErr(e?.message || "Couldn't delete the account. Check your connection and try again."); setStep("confirm"); } }}>Delete my account</button>
            <button className="btn sm" onClick={() => { setStep("idle"); setTyped(""); }}>Cancel</button></div>
          {err && <p className="hint warn">{err}</p>}
        </div>}
        {step === "busy" && <p className="small">Deleting…</p>}
      </> : step === "deleted" ? null : <p className="small muted" style={{ margin: 0 }}>You're not signed in, so everything is stored only on this device.</p>}
      {step === "deleted" && <p className="hint">Your account is deleted. Your teams are still saved on this device; erase them below if you want them gone here too.</p>}
      <SetRow title="Erase this device" sub="Deletes every team, match and setting Benchboard stored in this browser. Synced teams stay in the cloud for their other coaches.">
        <ConfirmButton className="btn sm" confirmText="Erase everything here?" onConfirm={erase}>Erase this device</ConfirmButton></SetRow>
    </div>
  </Card>;
}
