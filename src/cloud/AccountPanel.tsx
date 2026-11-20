/** Account settings, the same on every FloorCall site: name, sign-in email, password, email updates, sign out and
 * delete the account. The coaching app shows it on its Account page; the other sites open it from the account button
 * in the header. */
import { useEffect, useRef, useState } from "react";
import { CloudError, currentUser, rpc, sendPasswordReset, signOut, updateEmail, updateMeta, updatePassword, userMeta } from "./client";
import { contactUrl } from "./links";
import "./accountpanel.css";

const KIND: Record<string, string> = { coach: "Coach", athlete: "Athlete", parent: "Parent", fan: "Fan" };
const err = (e: unknown) => (e instanceof CloudError ? e.message : "Couldn't reach FloorCall. Check your connection.");

export function AccountPanel({ from, onSignedOut }: { from: string; onSignedOut?: () => void }) {
  const u = currentUser(), m = userMeta();
  const [name, setName] = useState(m.name || ""), [email, setEmail] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ k: string; t: string; bad?: boolean } | null>(null), [busy, setBusy] = useState(""), [del, setDel] = useState(""), [, bump] = useState(0);
  if (!u) return null;
  const run = async (k: string, f: () => Promise<unknown>, ok: string) => { setBusy(k); setMsg(null); try { await f(); setMsg({ k, t: ok }); bump((x) => x + 1); } catch (e) { setMsg({ k, t: err(e), bad: true }); } setBusy(""); };
  const note = (k: string) => msg?.k === k ? <p className={"ap-msg" + (msg.bad ? " bad" : "")} role={msg.bad ? "alert" : "status"}>{msg.t}</p> : null;
  const pwBad = pw && pw.length < 8 ? "Use at least 8 characters." : pw2 && pw !== pw2 ? "The two passwords don't match." : "";
  return <div className="ap">
    <section className="ap-sec ap-who">
      <span className="ap-avatar" aria-hidden="true">{(m.name || u.email).slice(0, 1).toUpperCase()}</span>
      <div><b>{m.name || u.email}</b><span>{u.email}{m.kind ? ` · ${KIND[m.kind] || m.kind} account` : ""}</span></div>
    </section>

    <section className="ap-sec"><h3>Your name</h3>
      <div className="ap-row"><input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" maxLength={80} />
        <button className="btn" disabled={busy === "name" || !name.trim() || name.trim() === (m.name || "")} onClick={() => run("name", () => updateMeta({ name: name.trim() }), "Name saved.")}>Save</button></div>
      {note("name")}</section>

    <section className="ap-sec"><h3>Sign-in email</h3>
      <p className="ap-sub">Now: <b>{u.email}</b>. We'll send a link to the new address; the change happens when you open it.</p>
      <div className="ap-row"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="New email" aria-label="New email" autoComplete="email" />
        <button className="btn" disabled={busy === "email" || !/^\S+@\S+\.\S+$/.test(email.trim()) || email.trim().toLowerCase() === u.email.toLowerCase()} onClick={() => run("email", () => updateEmail(email.trim()), `Check ${email.trim()} for a link to confirm the change.`)}>Change email</button></div>
      {note("email")}</section>

    <section className="ap-sec"><h3>Password</h3>
      <div className="ap-grid">
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" aria-label="New password" autoComplete="new-password" />
        <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Type it again" aria-label="New password again" autoComplete="new-password" />
      </div>
      {pwBad && <p className="ap-msg bad">{pwBad}</p>}
      <div className="ap-row"><button className="btn" disabled={busy === "pw" || !pw || pw !== pw2 || pw.length < 8} onClick={() => run("pw", async () => { await updatePassword(pw); setPw(""); setPw2(""); }, "Password changed.")}>Change password</button>
        <button className="ap-link" onClick={() => run("pw", () => sendPasswordReset(u.email), `We sent a reset link to ${u.email}.`)}>Email me a reset link instead</button></div>
      {note("pw")}</section>

    <section className="ap-sec"><h3>Email from FloorCall</h3>
      <label className="ap-check"><input type="checkbox" checked={m.email_ok === true} onChange={(e) => run("news", () => updateMeta({ email_ok: e.target.checked }), e.target.checked ? "You'll get news and new features." : "No more news emails. You'll still get sign-in and security emails.")} />
        News and new features <span className="ap-sub">(sign-in and security emails always come)</span></label>
      {note("news")}</section>

    <section className="ap-sec ap-actions">
      <button className="btn" onClick={() => { signOut(); onSignedOut ? onSignedOut() : location.reload(); }}>Sign out of this site</button>
      <a className="btn" href={contactUrl(from, "question")}>Help and contact</a>
      <a className="btn ghost" href="../legal/privacy.html" target="_blank" rel="noopener">Privacy</a>
    </section>

    <details className="ap-sec ap-danger"><summary>Delete your account</summary>
      <p className="ap-sub">This deletes your FloorCall account on every site: your sign-in, your answers and sign-ups, and any cloud team you own (for everyone on it). Teams saved on a device stay there. It can't be undone.</p>
      <div className="ap-row"><input className="input" value={del} onChange={(e) => setDel(e.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm" />
        <button className="btn danger" disabled={del.trim() !== "DELETE" || busy === "del"} onClick={() => run("del", async () => { await rpc("delete_my_account", {}); signOut(); setTimeout(() => (onSignedOut ? onSignedOut() : location.reload()), 1200); }, "Your account is deleted.")}>Delete account</button></div>
      {note("del")}</details>
  </div>;
}

/** The account button in a site's header: the person's initial, opening Account settings in a dialog. */
export function AccountButton({ from }: { from: string }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null), u = currentUser();
  useEffect(() => { if (!open) return; box.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open]);
  if (!u) return null;
  return <>
    <button className="ap-btn" onClick={() => setOpen(true)} aria-label="Account settings" title={u.email}>{(userMeta().name || u.email).slice(0, 1).toUpperCase()}</button>
    {open && <div className="ap-back" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="ap-dialog" role="dialog" aria-modal="true" aria-labelledby="ap-h" tabIndex={-1} ref={box}>
        <div className="ap-hd"><h2 id="ap-h">Account</h2><button className="ap-x" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
        <AccountPanel from={from} />
      </div></div>}
  </>;
}
