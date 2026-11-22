import { TRACK_MODES } from "../../sports/volleyball/actions";
import { isViewer } from "../../app/viewAs";
import { setUi } from "../../app/ui";
import { contactUrl, placeUrl } from "../../cloud/links";
import { can } from "../../app/plan";
import { useEffect, useState } from "react";
import { FORMATS, SCORING } from "../track/TrackPage";
import { canPrompt, installed, isIOS, onInstallChange, promptInstall } from "../../app/install";
import { all, setPrefs, setSettings, state, team, toast } from "../../data/store";
import { AI_DAILY_DEFAULT, AI_MODE } from "../../app/flags";
import { Card, ConfirmButton, copyText, Seg, SetRow, Switch } from "../../ui/kit";
import { ask, AiError, getKey, setKey } from "../../ai/client";
import { authSettings, cloudAvailable, config, currentUser, fn, rpc, setConfig, signOut, forgetDevices } from "../../cloud/client";
import { deleteAccount, isLinked } from "../../cloud/sync";
import { APP_VERSION, LEGAL, LEGAL_EMAIL } from "../../app/legal";
import { eraseDevice } from "../../data/db";
import { offlineAllowed, skipAccounts } from "../../cloud/AuthPage";
import { go } from "../../app/router";
import { LOC_KINDS, locChoice } from "../../data/model";

export function SettingsPage() {
  const t = team()!, s = t.settings, p = state.prefs;
  const admin = useAdmin();
  const counts = { teams: all("teams").length, players: all("players").length, matches: all("matches").length, events: all("logs").reduce((n, l) => n + l.events.length, 0) };
  return <div className="page" style={{ maxWidth: 820 }}>
    <div className="pagehead"><h1>Settings</h1></div>
    <Card title="Look">
      <SetRow title="Theme"><Seg value={p.theme} onChange={(v) => setPrefs({ theme: v })} options={[["light", "Light"], ["dark", "Dark"]]} label="Theme" /></SetRow>
      <SetRow title="Text and button size" sub="Large is easier to hit on a tablet courtside."><Seg value={p.size} onChange={(v) => setPrefs({ size: v })} options={[["normal", "Normal"], ["large", "Large"]]} label="Size" /></SetRow>
      {!isViewer(t.id) && <SetRow title="Team color" sub="Change it on the Team tab."><button className="btn sm" onClick={() => go("team")}>Team tab</button></SetRow>}
    </Card>
    {!isViewer(t.id) && <Card title={`Tracking · ${t.name}`}>
      <SetRow title="What to track" sub="Full stats has every button. Basic stats is the box score: kills, attempts, errors, aces, serve errors, assists, blocks and digs. Points only just keeps score, rally by rally. You can also switch on the Track screen."><Seg value={can("fullStats") ? s.trackMode || "full" : s.trackMode === "points" ? "points" : "basic"} onChange={(v) => setSettings({ trackMode: v })} options={TRACK_MODES.filter(([k]) => k !== "full" || can("fullStats")).map(([k, l]) => [k, l] as [typeof k, string])} label="What to track" /></SetRow>
      <div className="setgroup">
        <div className="setgroup-hd"><b>Ask where the ball landed</b><span>After the play, tap the court. Feeds the tendency court and the Live court. Choose for each kind of play.</span></div>
        {LOC_KINDS.map((k) => <SetRow key={k.kind} title={k.title} sub={k.sub}>
          <select className="input" style={{ width: "auto", maxWidth: 220 }} aria-label={"Where it landed: " + k.title} value={locChoice(s, k.kind)} onChange={(e) => setSettings({ locAsk: { ...LOC_KINDS.reduce((o, x) => ({ ...o, [x.kind]: locChoice(s, x.kind) }), {}), [k.kind]: e.target.value } })}>
            {k.choices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </SetRow>)}
      </div>
      <SetRow title="Ask for their jersey number" sub="After their kills, aces and errors, so you can scout their players."><Switch checked={s.askOpp} onChange={(v) => setSettings({ askOpp: v })} label="Ask for their number" /></SetRow>
      <SetRow title="Subs allowed per set" sub="0 means no limit. High school is usually 15, club 12 or 15."><input className="input" style={{ width: 80 }} type="number" min={0} max={30} value={s.subLimit} onChange={(e) => setSettings({ subLimit: Math.max(0, +e.target.value || 0) })} aria-label="Subs per set" /></SetRow>
      <SetRow title="Default match format"><div className="row"><Seg value={s.bestOf} onChange={(v) => setSettings({ bestOf: v })} options={FORMATS} label="Format" /><select className="input" style={{ width: "auto" }} value={s.scoring || "25"} onChange={(e) => setSettings({ scoring: e.target.value })} aria-label="Scoring">{SCORING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div></SetRow>
      <SetRow title="Type-in stat codes" sub="A box on the Track screen for typing stats on a keyboard: 7k is #7 kill, 12ace is #12 ace, 4p3 is a 3 pass, ok11 is their #11 kill. Laptops and tablets only. Saved on this device."><Switch checked={!!p.quick} onChange={(v) => setPrefs({ quick: v })} label="Type-in stat codes" /></SetRow>
      <SetRow title="Focus mode button" sub="A Focus button on the Track screen that hides the side panels and makes the buttons bigger, for an assistant tracking on a phone. Saved on this device."><Switch checked={!!p.labsFocus} onChange={(v) => setPrefs({ labsFocus: v, focus: v ? p.focus : false })} label="Focus mode button" /></SetRow>
      <SetRow title="Zone numbers on drawing boards"><Switch checked={!s.hideZones} onChange={(v) => setSettings({ hideZones: !v })} label="Show zone numbers" /></SetRow>
    </Card>}
    <InstallCard />
    {t && !isViewer(t.id) && <Card title="Players' view">
      <SetRow title="See what players see" sub="Players and families who join with a view-only code get Home, Stats and the Team tab: results, the roster, everyone's stats and your announcements. They never see tracking, scouting, practice plans, drills or the court."><button className="btn sm" onClick={() => { setUi({ previewPlayer: true }); go("home"); }}>Preview</button></SetRow>
    </Card>}
    <CloudSettings admin={admin} />
    {admin && <section className="set-admin" aria-label="Admin">
      <div className="set-admin-hd"><b>Admin</b><span>Only FloorCall admins see this part.</span></div>
      <AdminLink />
      <SetupCheck />
    </section>}
    {AI_MODE !== "off" && (admin || (t && !isViewer(t.id))) && <AiKey />}
    <Card title="Your data">
      <p className="small">Saved on this device: {counts.teams} {counts.teams === 1 ? "team" : "teams"}, {counts.players} {counts.players === 1 ? "player" : "players"}, {counts.matches} {counts.matches === 1 ? "match or practice" : "matches and practices"}, {counts.events.toLocaleString()} recorded plays.</p>
      <p className="small muted" style={{ marginTop: 6 }}>{state.persistent ? "Your browser has agreed to keep this data." : "Your browser may clear this data if space runs low."} Save a backup from Team → Backup to move data to another device or keep a copy.</p>
      <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => go("team")}>Backup & restore</button><button className="btn sm" onClick={() => { location.reload(); toast("Reloaded"); }}>Reload app</button></div>
    </Card>
    <HelpCard />
    <PrivacyCard />
    <p className="small muted" style={{ textAlign: "center" }}>FloorCall {APP_VERSION} · <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy</a> · <a href={LEGAL.terms} target="_blank" rel="noopener">Terms</a></p>
  </div>;
}

function CloudSettings({ admin }: { admin: boolean }) {
  const own = (() => { try { return JSON.parse(localStorage.getItem("bs-cloud-config") || "null"); } catch { return null; } })();
  const [url, setUrl] = useState(own?.url || ""), [key, setKeyV] = useState(own?.key || ""), [open, setOpen] = useState(!!own);
  const user = currentUser();
  return <Card title="Cloud">
    <SetRow title="Account" sub={cloudAvailable() ? (user ? "Signed in as " + user.email + ". Sync and sharing are on the Team tab." : "Sign in on the Team tab to sync teams and share them with other coaches.") : "Cloud sync isn't set up in this version."}>
      {user ? <button className="btn sm" onClick={() => { signOut(); toast("Signed out"); }}>Sign out</button> : <button className="btn sm" onClick={() => go("team")}>Team tab</button>}
    </SetRow>
    {!admin && !own ? null : !open ? <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Use my own Supabase project</button> : <div className="stack" style={{ marginTop: 8 }}>
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
    <p className="small muted">Put FloorCall on your home screen. It opens full screen, works without signal in the gym, and keeps your data on the device.</p>
    {canPrompt() ? <button className="btn primary" onClick={async () => { if (await promptInstall()) toast("Installed"); }}>Install FloorCall</button>
      : isIOS() ? <p className="small">On iPhone or iPad: tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.</p>
      : <p className="small">In Chrome or Edge, use the install icon in the address bar, or the browser menu → <b>Install FloorCall</b>.</p>}
  </Card>;
}

/** True for FloorCall admins (the admins table in Supabase). Coaches, players and families never see the setup and background settings. */
export function useAdmin() {
  const [ok, setOk] = useState(false);
  useEffect(() => { if (currentUser()) import("../admin/AdminPage").then((m) => m.amAdmin()).then(setOk); }, []);
  return ok;
}
function AdminLink() {
  return <Card title="Admin console"><div className="row between"><span className="small">Sign-ups, active teams, live matches, coach verification, and review of uploaded photos and logos.</span><button className="btn sm primary" onClick={() => go("admin")}>Open admin</button></div></Card>;
}

/** AI in this app: a switch to hide the AI buttons on this device, and a coach's own Anthropic key (calls then go on
 * the coach's own bill, straight from this browser; the key stays on this device). */
function AiKey() {
  const [key, setK] = useState(getKey()), [show, setShow] = useState(false), [testing, setTesting] = useState(false), [msg, setMsg] = useState(""), [, bump] = useState(0);
  const [me, setMe] = useState<{ used: number; limit: number | null; own_key: boolean } | null>(null);
  useEffect(() => { if (cloudAvailable() && currentUser()) rpc("my_ai", {}).then(setMe).catch(() => setMe(null)); }, []);
  const test = async () => {
    setKey(key.trim()); setTesting(true); setMsg("");
    try { await ask("Reply with the single word: ready", { tier: "quick", maxTokens: 10 }); setMsg("Connected. AI features use your key now."); }
    catch (e) { setMsg(e instanceof AiError ? e.message : "Couldn't connect."); }
    setTesting(false);
  };
  const off = !!state.prefs.noAi, limit = me?.limit ?? AI_DAILY_DEFAULT, mayKey = AI_MODE === "own-key" || !!me?.own_key || !!getKey();
  return <Card title="AI features">
        <div className="stack">
          <SetRow title="Show AI buttons" sub="Match, practice and season reports, scouting reports, timeout talking points, player report cards, the film summary, and lineup and practice suggestions. Your stats, charts and clip searches never need AI. Saved on this device.">
            <Switch checked={!off} onChange={(v) => { setPrefs({ noAi: !v }); bump((x) => x + 1); }} label="Show AI buttons" /></SetRow>
          {!off && AI_MODE === "included" && me && <p className="small">{getKey() ? "Using your own Anthropic key: no daily limit." : `${me.used} of ${limit} AI requests used today. The count resets each day.`}</p>}
          {!off && !mayKey && <p className="small muted">Need more AI requests, or want to use your own Anthropic account with no limit? <a href={contactUrl("app", "billing", "AI: more requests or my own key")}>Ask us</a>.</p>}
          {!off && mayKey && <>
          <p className="small muted">{AI_MODE === "included" ? "Your account can use your own Anthropic API key (from console.anthropic.com): no daily limit, billed to your Anthropic account." : "To use AI, paste your own API key from console.anthropic.com. Calls are billed to your Anthropic account."} The key stays on this device only.</p>
          <div className="row">
            <input className="input grow" type={show ? "text" : "password"} value={key} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" autoComplete="off" aria-label="API key" style={{ minWidth: 200 }} />
            <button className="btn sm" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
          </div>
          <div className="row">
            <button className="btn primary" disabled={!key.trim() || testing} onClick={test}>{testing ? "Testing…" : "Save and test"}</button>
            {getKey() && <button className="btn" onClick={() => { setKey(""); setK(""); setMsg("Key removed."); }}>Remove key</button>}
          </div>
          {msg && <p className="hint">{msg}</p>}</>}
        </div>
      </Card>;
}

/** Setup check: walks through what the live app needs (Supabase schema, sign-in, sync, AI) and says what's missing. */
const SCHEMA_VERSION = 38;
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
    try {
      const c = config(), r = c ? await fetch(`${c.url}/storage/v1/object/public/media/setup-check.png`, { headers: { apikey: c.key } }) : null, txt = r ? await r.text() : "";
      if (r) out.push(/bucket not found/i.test(txt) ? { label: "Photos and logos", state: "todo", detail: "The media storage for player photos and team logos isn't there yet. Run the latest supabase/schema.sql (version 12) in the SQL Editor." }
        : { label: "Photos and logos", state: "ok", detail: "Photos and logos upload to your project's media storage." });
    } catch { /* offline: the Database row already says so */ }
    try {
      const st = await authSettings();
      out.push(st.disable_signup ? { label: "Sign-up emails", state: "warn", detail: "New sign-ups are turned off in Supabase (Authentication → Sign In / Providers). Coaches can't create accounts until you turn them back on." }
        : st.mailer_autoconfirm ? { label: "Sign-up emails", state: "warn", detail: "New accounts aren't email-verified yet. Connect an email provider, then turn on Confirm email (README: Sign-up and password emails). Signing in on a new device already emails a code, so that needs the provider too." }
        : { label: "Sign-up emails", state: "warn", detail: "New accounts must confirm their email. Supabase's built-in email only reaches your own team, so connect an email provider (Authentication → Emails → SMTP Settings) or turn off Confirm email. Skip this if you already did." });
    } catch { /* older projects: nothing to report */ }
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
    if (user) {
      try { await fn("notify", { action: "key" }); out.push({ label: "Family notifications", state: "ok", detail: "The notify Edge Function is deployed with its keys. Families can turn on match notifications on your team page." }); }
      catch (e: any) {
        out.push(e?.status === 404 ? { label: "Family notifications", state: "todo", detail: "Optional: deploy the notify Edge Function (supabase/functions/notify/index.ts, with Verify JWT turned off) so families get a notification when a match starts and ends. Then add its keys below." }
          : e?.status === 503 ? { label: "Family notifications", state: "todo", detail: "The notify function is deployed but has no keys. Make them below and add them in Supabase → Edge Functions → Secrets." }
          : { label: "Family notifications", state: "warn", detail: "The notify function didn't answer: " + (e?.message || "unknown error") + "." });
      }
    }
    out.push(LEGAL_EMAIL ? { label: "Privacy contact", state: "ok", detail: "Your Privacy Policy and Terms list " + LEGAL_EMAIL + " for questions." } : { label: "Privacy contact", state: "todo", detail: "Your Privacy Policy needs a contact email for privacy requests. Add it as legal.email in package.json (or ask your developer)." });
    out.push(installed() ? { label: "Installed on this device", state: "ok", detail: "Opened from the home screen." } : { label: "Installed on this device", state: "warn", detail: "Optional: add it to your home screen (see Install the app above) so it opens full screen and works offline." });
    setChecks(out); setBusy(false);
  };
  return <Card title="Setup check" actions={<button className="btn sm" disabled={busy} onClick={run}>{busy ? "Checking…" : checks ? "Check again" : "Run check"}</button>}>
    {!checks ? <p className="small muted">Checks the database, your account, team sync and AI, and tells you exactly what's left to set up.</p>
      : <ul className="check-list">{checks.map((c) => <li key={c.label} className={"sc-" + c.state}><span className="sc-dot" aria-hidden="true">{c.state === "ok" ? "✓" : c.state === "todo" ? "!" : "·"}</span><div><b>{c.label}</b><p className="small" style={{ margin: 0 }}>{c.detail}</p></div></li>)}</ul>}
    {checks?.some((c) => c.label === "Family notifications" && c.state === "todo") && <NotifyKeys />}
  </Card>;
}

/** Makes the key pair the notify function signs notifications with (VAPID). Made on this device; nothing is sent anywhere. */
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function makeVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64url(pub), privateKey: jwk.d! };
}
function NotifyKeys() {
  const [k, setK] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const row = (name: string, v: string) => <div className="field"><span className="label">{name}</span><div className="row" style={{ gap: 6 }}><input className="input" readOnly value={v} aria-label={name} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => copyText(v).then((ok) => toast(ok ? name + " copied." : "Couldn't copy."))}>Copy</button></div></div>;
  return <div className="stack" style={{ marginTop: 12 }}>
    {!k ? <button className="btn sm" onClick={() => makeVapidKeys().then(setK).catch(() => toast("This browser can't make the keys. Try Chrome, Edge or Safari."))}>Make notification keys</button>
      : <>{row("VAPID_PUBLIC_KEY", k.publicKey)}{row("VAPID_PRIVATE_KEY", k.privateKey)}
        <p className="small muted" style={{ margin: 0 }}>Add both in Supabase → Edge Functions → Secrets, plus VAPID_SUBJECT set to mailto: and your contact email. Keep the private key there only; if you lose it, make a new pair (families then turn notifications on again).</p></>}
  </div>;
}

/** Privacy, legal documents and deleting data. */
/** What a coach needs to report a problem: version, device and app state. No names, stats or email. */
export function diagnostics(): string {
  const u = currentUser(), t = team();
  return [`FloorCall ${APP_VERSION}`, `Browser: ${navigator.userAgent}`, `Screen: ${screen.width}×${screen.height} (window ${innerWidth}×${innerHeight})`,
    `Installed: ${matchMedia("(display-mode: standalone)").matches ? "yes" : "no"} · Online: ${navigator.onLine ? "yes" : "no"} · Signed in: ${u ? "yes" : "no"}`,
    `Teams on this device: ${all("teams").length} · This team synced: ${t && isLinked(t.id) ? "yes" : "no"}`, `Page: ${location.hash || "#/"}`].join("\n");
}

function HelpCard() {
  const report = () => window.open(contactUrl("app", "bug", diagnostics()), "_blank", "noopener");
  return <Card title="Help and feedback">
    <div className="row">
      <a className="btn sm" href={placeUrl("home")} target="_blank" rel="noopener">Everything FloorCall does</a>
      <a className="btn sm" href={LEGAL.accessibility} target="_blank" rel="noopener">Accessibility</a>
      <a className="btn sm" href={contactUrl("app")} target="_blank" rel="noopener">Contact us</a>
      <button className="btn sm" onClick={report}>Report a problem</button>
      <a className="btn sm" href={contactUrl("app", "idea")} target="_blank" rel="noopener">Suggest a feature</a>
    </div>
    <p className="small muted" style={{ margin: "8px 0 0" }}>Problem reports include the app version, your browser and screen size, so we can reproduce it. No player names or stats.</p>
  </Card>;
}

function PrivacyCard() {
  const user = currentUser(), t = team();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "deleted">("idle"), [typed, setTyped] = useState(""), [err, setErr] = useState("");
  const erase = async () => { await eraseDevice(); location.replace(location.pathname); };
  return <Card title="Privacy and your data">
    <div className="stack">
      <div className="row"><a className="btn sm" href={LEGAL.privacy} target="_blank" rel="noopener">Privacy Policy</a><a className="btn sm" href={LEGAL.terms} target="_blank" rel="noopener">Terms of Service</a>
        <a className="btn sm" href={LEGAL.consent + (t ? "#team=" + encodeURIComponent(t.name) : "")} target="_blank" rel="noopener">Parent and guardian form</a>
        <a className="btn sm" href={LEGAL.schools} target="_blank" rel="noopener">For schools</a></div>
      <p className="small muted" style={{ margin: 0 }}>FloorCall doesn't sell data, show ads or track you. Export everything any time from Team → Backup.</p>
      {user ? <>
        {step === "idle" && <SetRow title="Delete your account" sub="Removes your account and every cloud team you own (for everyone on it), and takes you off other teams. Data on this device stays unless you erase it too."><button className="btn sm" onClick={() => setStep("confirm")}>Delete account</button></SetRow>}
        {step === "confirm" && <div className="banner warn" style={{ display: "block" }}>
          <p><b>This can't be undone.</b> Cloud teams you own are deleted for every coach and viewer on them, along with their share links. Save a backup first if you might want the data. Type <b>DELETE</b> to confirm.</p>
          <div className="row" style={{ marginTop: 8 }}><input className="input" style={{ width: 140 }} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm" />
            <button className="btn sm danger" disabled={typed.trim() !== "DELETE"} onClick={async () => { setStep("busy"); setErr(""); try { await deleteAccount(); signOut(); forgetDevices(); if (!offlineAllowed()) { try { sessionStorage.setItem("bs-deleted", "1"); } catch { /* ignore */ } await eraseDevice(); location.replace(location.pathname); return; } skipAccounts(); setStep("deleted"); toast("Account deleted"); } catch (e: any) { setErr(e?.message || "Couldn't delete the account. Check your connection and try again."); setStep("confirm"); } }}>Delete my account</button>
            <button className="btn sm" onClick={() => { setStep("idle"); setTyped(""); }}>Cancel</button></div>
          {err && <p className="hint warn">{err}</p>}
        </div>}
        {step === "busy" && <p className="small">Deleting…</p>}
      </> : step === "deleted" ? null : <p className="small muted" style={{ margin: 0 }}>You're not signed in, so everything is stored only on this device.</p>}
      {step === "deleted" && <p className="hint">Your account is deleted. Your teams are still saved on this device; erase them below if you want them gone here too.</p>}
      <SetRow title="Erase this device" sub="Deletes every team, match and setting FloorCall stored in this browser. Synced teams stay in the cloud for their other coaches.">
        <ConfirmButton className="btn sm" confirmText="Erase everything here?" onConfirm={erase}>Erase this device</ConfirmButton></SetRow>
    </div>
  </Card>;
}
