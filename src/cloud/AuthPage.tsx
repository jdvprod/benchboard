/** Sign in, create account, password reset, and the account screen. Shares a split "scoreboard" shell with first-run setup. */
import { AccountPanel } from "./AccountPanel";
import { LEGAL } from "../app/legal";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { setPrefs, state, team, toast } from "../data/store";
import { placeUrl } from "./links";
import { acceptTerms, CloudError, cloudAvailable, currentUser, resendConfirmation, sendDeviceCode, sendPasswordReset, signIn, verifyDeviceCode, signOut, signUp, updateMeta, updatePassword, userMeta } from "./client";
import { isLinked, linkTeam, pendingCount, restoreTeams, status, syncNow } from "./sync";
import { go } from "../app/router";
import { Card } from "../ui/kit";
import { Badge, badgeFor } from "./Badge";
import { useCoachStatus } from "./CoachVerify";

/* Sample numbers for the stat sheet on the sign-in panel. */
const SHEET: [string, string, number, number, number, string, string][] = [
  ["7", "Maya", 14, 2, 31, ".387", "2.41"],
  ["9", "Riley", 11, 3, 24, ".333", "—"],
  ["14", "Kenzie", 9, 4, 27, ".185", "—"],
  ["4", "Jordan", 6, 1, 19, ".263", "2.18"],
];
const ROT: [string, number][] = [["R1", 64], ["R2", 58], ["R3", 41], ["R4", 71], ["R5", 55], ["R6", 62]];

function StatSheet() {
  return <div className="auth-sheet" aria-hidden="true">
    <div className="auth-sheet-hd"><span>vs Buchanan · Set 3</span><span className="live">Live</span></div>
    <table><thead><tr><th>#</th><th>Player</th><th>K</th><th>E</th><th>TA</th><th>Hit %</th><th>Pass</th></tr></thead>
      <tbody>{SHEET.map(([n, nm, k, e, ta, h, ps], i) => <tr key={n}><td>{n}</td><td>{nm}</td><td>{k}</td><td>{e}</td><td>{ta}</td><td className={i === 0 ? "hi" : ""}>{h}</td><td>{ps}</td></tr>)}</tbody></table>
    <div className="auth-rot">
      <div className="auth-rot-hd"><span>Side-out by rotation</span><b>59%</b></div>
      <div className="auth-bars">{ROT.map(([r, v]) => <div key={r} className={v < 50 ? "low" : v === 71 ? "top" : ""}><i style={{ height: v + "%" }} /><span>{r}</span></div>)}</div>
    </div>
  </div>;
}

/** Dark panel on the left (top on phones), content on the right. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className="auth">
    <aside className="auth-board">
      <div className="auth-brand"><img className="brandmark" src="brand/mark-white.png" alt="" width="28" height="28" /><b>FloorCall</b></div>
      <div className="auth-hero">
        <h2 className="auth-head">Live stats and advanced metrics for volleyball coaches.</h2>
        <StatSheet />
      </div>
      <div className="auth-feats">
        <ul>
          <li>Tap-to-track stats, offline in any gym</li>
          <li>Hitting, passing, side-out and rotation metrics</li>
          <li>Lineups, rotations and practice plans</li>
          <li>Assistants track together. Parents follow live.</li>
        </ul>
        <ul className="soon">
          <li><a href={placeUrl("home")} style={{ color: "#9BD3F2" }}>See everything FloorCall does</a><span style={{ border: 0 }} /></li>
          <li>FloorCall Recruit profiles and clips <span>Early access</span></li>
          <li>College coach search <span>Coming soon</span></li>
        </ul>
      </div>
    </aside>
    <main className={"auth-main" + (wide ? " wide" : "")}><div className="auth-inner">{children}</div></main>
  </div>;
}

const errText = (e: unknown) => (e instanceof CloudError ? e.message : "Something went wrong. Try again.");
type Mode = "signin" | "signup" | "check" | "forgot" | "sent" | "newpw" | "device";

export function AuthPage({ initial = "signin", onSkip }: { initial?: Mode; onSkip?: () => void }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<{ field?: "email" | "pw" | "agree" | "name"; text: string } | null>(null);
  const [agree, setAgree] = useState(false), [name, setName] = useState(""), [news, setNews] = useState(true), [code, setCode] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setErr(null); if (mode !== "newpw" && mode !== "device") emailRef.current?.focus(); }, [mode]);

  const afterSignIn = async () => {
    toast("Signed in");
    try { await restoreTeams(); } catch { /* sync shows its own status */ }
    const pending = sessionStorage.getItem("bs-join");
    if (pending) { sessionStorage.removeItem("bs-join"); go("join", pending); return; }
    go(team() ? "track" : "team");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (mode !== "newpw" && !/^\S+@\S+\.\S+$/.test(email.trim())) return setErr({ field: "email", text: "Enter your email address." });
    if ((mode === "signin" || mode === "signup" || mode === "newpw") && pw.length < (mode === "signin" ? 1 : 8)) return setErr({ field: "pw", text: mode === "signin" ? "Enter your password." : "Use at least 8 characters." });
    if (mode === "signup" && name.trim().length < 2) return setErr({ field: "name", text: "Enter your name." });
    if (mode === "signup" && !agree) return setErr({ field: "agree", text: "Please confirm you're 13 or older and agree to the Terms and Privacy Policy." });
    setBusy(true);
    try {
      if (mode === "signin") { if (await signIn(email.trim(), pw) === "check-device") { setPw(""); setCode(""); setMode("device"); } else await afterSignIn(); }
      else if (mode === "signup") { const r = await signUp(email.trim(), pw, { name: name.trim(), kind: "coach", email_ok: news }); if (r === "confirm-email") setMode("check"); else await afterSignIn(); }
      else if (mode === "forgot") { await sendPasswordReset(email.trim()); setMode("sent"); }
      else if (mode === "newpw") { await updatePassword(pw); toast("Password updated"); go(team() ? "track" : "team"); }
    } catch (e2) {
      const t = errText(e2);
      setErr({ field: /password/i.test(t) ? "pw" : /email/i.test(t) ? "email" : undefined, text: t });
    }
    setBusy(false);
  };

  if (!cloudAvailable()) return <AuthShell><h1 className="auth-title">Accounts aren't set up</h1><p className="auth-sub">This version of FloorCall runs on this device only.</p>{onSkip && <button className="auth-btn" onClick={onSkip}>Continue</button>}</AuthShell>;

  if (mode === "check" || mode === "sent") return <AuthShell>
    <div className="auth-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></svg></div>
    <h1 className="auth-title">Check your email</h1>
    <p className="auth-sub">{mode === "check" ? <>We sent a confirmation link to <b>{email}</b>. Open it on this device to finish creating your account.</> : <>If <b>{email}</b> has an account, a link to reset your password is on its way.</>}</p>
    <div className="auth-actions">
      <button className="auth-btn" onClick={() => setMode("signin")}>Back to sign in</button>
      {mode === "check" && <button className="auth-link" disabled={busy} onClick={async () => { setBusy(true); try { await resendConfirmation(email); toast("Sent again"); } catch (e) { toast(errText(e)); } setBusy(false); }}>Didn't get it? Send again</button>}
    </div>
  </AuthShell>;

  if (mode === "device") return <AuthShell>
    <div className="auth-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></svg></div>
    <h1 className="auth-title">Check your email</h1>
    <p className="auth-sub">This device hasn't signed in to your account before, so we sent a code to <b>{email}</b>. Enter it here, or open the link in that email on this device.</p>
    <form className="auth-form" noValidate onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      if (code.replace(/\D/g, "").length < 6) return setErr({ text: "Enter the code from the email." });
      setBusy(true); try { await verifyDeviceCode(email.trim(), code); await afterSignIn(); } catch (e2) { setErr({ text: errText(e2) }); } setBusy(false);
    }}>
      <div className="auth-field">
        <label htmlFor="auth-code">Code</label>
        <input id="auth-code" className="auth-code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} />
      </div>
      {err && <p className="auth-err box" role="alert">{err.text}</p>}
      <button className="auth-btn" type="submit" disabled={busy} aria-busy={busy}>{busy ? <span className="auth-spin" aria-label="Working" /> : "Verify and sign in"}</button>
    </form>
    <div className="auth-foot">
      <p>No email? Check spam, or <button className="auth-link" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await sendDeviceCode(email.trim()); toast("New code sent"); } catch (e2) { setErr({ text: errText(e2) }); } setBusy(false); }}>send a new code</button></p>
      <p><button className="auth-link" onClick={() => setMode("signin")}>Back to sign in</button></p>
    </div>
  </AuthShell>;

  const title = { signin: "Sign in to FloorCall", signup: "Create your account", forgot: "Reset your password", newpw: "Choose a new password" }[mode];
  const sub = { signin: "Your teams, stats and lineups on every device.", signup: "Free for coaches. Your teams sync across your devices and staff, and families follow along live.", forgot: "Enter the email you use for FloorCall and we'll send you a reset link.", newpw: "You're signed in. Set a new password to finish." }[mode];
  const cta = { signin: "Sign in", signup: "Create account", forgot: "Send reset link", newpw: "Save password" }[mode];

  return <AuthShell>
    <h1 className="auth-title">{title}</h1>
    <p className="auth-sub">{sub}</p>
    {(() => { try { return sessionStorage.getItem("bs-deleted"); } catch { return null; } })() && <p className="auth-err box" role="status">Your account and the teams you owned are deleted, and this device is cleared.</p>}
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "signup" && <div className={"auth-field" + (err?.field === "name" ? " bad" : "")}>
        <label htmlFor="auth-name">Your name</label>
        <input id="auth-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Coach Rivera" aria-invalid={err?.field === "name"} />
        {err?.field === "name" && <p className="auth-err" role="alert">{err.text}</p>}
      </div>}
      {mode !== "newpw" && <div className={"auth-field" + (err?.field === "email" ? " bad" : "")}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" ref={emailRef} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.org" aria-invalid={err?.field === "email"} />
        {err?.field === "email" && <p className="auth-err" role="alert">{err.text}</p>}
      </div>}
      {mode !== "forgot" && <div className={"auth-field" + (err?.field === "pw" ? " bad" : "")}>
        <div className="auth-row"><label htmlFor="auth-pw">{mode === "newpw" ? "New password" : "Password"}</label>
          {mode === "signin" && <button type="button" className="auth-link small" onClick={() => setMode("forgot")}>Forgot password?</button>}</div>
        <div className="auth-pw">
          <input id="auth-pw" type={show ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === "signin" ? "" : "At least 8 characters"} aria-invalid={err?.field === "pw"} />
          <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
        </div>
        {err?.field === "pw" && <p className="auth-err" role="alert">{err.text}</p>}
      </div>}
      {mode === "signup" && <div className={"auth-agree" + (err?.field === "agree" ? " bad" : "")}>
        <label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I'm 13 or older and agree to the <a href={LEGAL.terms} target="_blank" rel="noopener">Terms of Service</a> and <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy Policy</a>, including resolving disputes by individual arbitration (you can opt out). If I'm under 18, a parent or guardian agrees too.</span></label>
        {err?.field === "agree" && <p className="auth-err" role="alert">{err.text}</p>}
      </div>}
      {mode === "signup" && <div className="auth-agree"><label><input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} /><span>Send FloorCall news and new features to my inbox. Turn it off any time in Account.</span></label></div>}
      {err && !err.field && <p className="auth-err box" role="alert">{err.text}</p>}
      <button className="auth-btn" type="submit" disabled={busy} aria-busy={busy}>{busy ? <span className="auth-spin" aria-label="Working" /> : cta}</button>
    </form>
    <div className="auth-foot">
      {mode === "signin" && <p>New to FloorCall? <button className="auth-link" onClick={() => setMode("signup")}>Create an account</button></p>}
      {mode === "signup" && <p>Already have an account? <button className="auth-link" onClick={() => setMode("signin")}>Sign in</button></p>}
      {mode === "forgot" && <p><button className="auth-link" onClick={() => setMode("signin")}>Back to sign in</button></p>}
      {onSkip && offlineAllowed() && (mode === "signin" || mode === "signup") && <div className="auth-skip"><button className="auth-btn alt" onClick={onSkip}>Use without an account</button><span>Everything stays on this device. You can sign in later.</span></div>}
      <p className="auth-legal">By using FloorCall you agree to the <a href={LEGAL.terms} target="_blank" rel="noopener">Terms</a> and <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy Policy</a>.</p>
    </div>
  </AuthShell>;
}

/** #/account when signed in. */
export function AccountPage() {
  const u = currentUser()!, t = team();
  return <div className="page" style={{ maxWidth: 720 }}>
    <div className="pagehead"><h1>Account</h1></div>
    <Card>
      <div className="acct">
        <span className="avatar big">{u.email.slice(0, 1).toUpperCase()}</span>
        <div className="grow" style={{ minWidth: 0 }}><b style={{ fontSize: 17 }}>{u.email}</b> <CoachBadge />
          <p className="small muted">{status.state === "error" ? status.error : status.last ? "Synced " + new Date(status.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Signed in"}</p></div>
        <button className="btn" onClick={() => syncNow()}>Sync now</button>
      </div>
    </Card>
    {t && <Card title={t.name}>
      <p className="small">{isLinked(t.id) ? "This team syncs to your account. Invite coaches from the Team tab." : t.sample ? "The sample team stays on this device." : "This team is only on this device."}</p>
      <div className="row" style={{ marginTop: 10 }}>
        {!isLinked(t.id) && !t.sample && <button className="btn sm primary" onClick={() => linkTeam(t.id).then(() => toast("Team synced")).catch((e) => toast(errText(e)))}>Sync this team</button>}
        <button className="btn sm" onClick={() => go("team")}>Team & sharing</button></div>
    </Card>}
    <Card title="Account settings"><AccountPanel from="app" onSignedOut={() => { toast("Signed out"); go("track"); }} /></Card>
  </div>;
}

/** Sidebar account chip. */
export function AccountChip() {
  const u = currentUser();
  if (!cloudAvailable()) return null;
  return <a className="tab acct-chip wide-only" href="#/account">
    {u ? <span className={"avatar " + syncDot()}>{u.email.slice(0, 1).toUpperCase()}</span> : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>}
    <span>{u ? u.email : "Sign in"}</span>{u && <CoachBadge short />}
  </a>;
}
/** Coaches see whether FloorCall has verified them; players, parents and fans see nothing. */
function CoachBadge({ short }: { short?: boolean }) {
  const kindCoach = userMeta().kind === "coach" || !userMeta().kind;
  const [s] = useCoachStatus();
  const b = kindCoach ? badgeFor(s) : null;
  if (!b || (short && b !== "verified" && b !== "admin")) return null;
  return <Badge kind={b} short={short} />;
}

/** Status dot on the avatar: synced, waiting (offline or changes pending) or error. */
export function syncDot() {
  if (!currentUser()) return "";
  if (status.state === "error") return "dot-err";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "dot-wait";
  return pendingCount() ? "dot-wait" : "dot-ok";
}
export const skipAccounts = () => setPrefs({ offline: true });
/** Accounts are required whenever the cloud is set up. Using the app with no account is only for development and tests. */
export const offlineAllowed = () => { try { return localStorage.getItem("bs-allow-offline") === "1"; } catch { return false; } };
export const wantsAuthGate = () => cloudAvailable() && !currentUser() && !(state.prefs.offline && offlineAllowed());

/** Shown once to signed-in coaches who haven't agreed to the current Terms and Privacy Policy (older accounts, or after a change). */
export function TermsGate() {
  const [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const u = currentUser();
  return <AuthShell>
    <h1 className="auth-title">Our Terms and Privacy Policy</h1>
    <p className="auth-sub">Signed in as <b>{u?.email}</b>. We updated them on November 20, 2026: they now cover every FloorCall site, and disputes are settled by individual arbitration unless you opt out within 30 days (Terms section 24). Please review and agree to keep using your account. In short: your team's data is yours, we don't sell it or show ads, and you need families' permission before tracking or sharing players' information.</p>
    <div className="auth-form">
      <div className={"auth-agree" + (err ? " bad" : "")}><label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I'm 13 or older and agree to the <a href={LEGAL.terms} target="_blank" rel="noopener">Terms of Service</a> and <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy Policy</a>, including resolving disputes by individual arbitration (you can opt out). If I'm under 18, a parent or guardian agrees too.</span></label></div>
      {err && <p className="auth-err box" role="alert">{err}</p>}
      <button className="auth-btn" disabled={busy} onClick={async () => {
        if (!agree) { setErr("Check the box to agree."); return; }
        setBusy(true); setErr("");
        try { await acceptTerms(); toast("Thanks"); go(team() ? "track" : "team"); } catch (e) { setErr(errText(e)); }
        setBusy(false);
      }}>{busy ? <span className="auth-spin" aria-label="Working" /> : "Agree and continue"}</button>
    </div>
    <div className="auth-foot"><p><button className="auth-link" onClick={() => { signOut(); location.hash = "#/track"; }}>Sign out instead</button></p></div>
  </AuthShell>;
}
