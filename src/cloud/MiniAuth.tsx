/** Sign in / create a free account, inline, for Benchboard Live (families and fans) and Benchboard Recruit (athletes).
 * One account works everywhere: the coach app, Live and Recruit. */
import "./miniauth.css";
import { FormEvent, useState } from "react";
import { AccountKind, acceptTerms, cloudAvailable, currentUser, needsTermsAgreement, sendPasswordReset, signIn, signOut, signUp, userMeta } from "./client";

const KINDS: [AccountKind, string][] = [["athlete", "An athlete"], ["parent", "A parent or family member"], ["fan", "A fan"], ["coach", "A coach"]];

export function MiniAuth({ kind = "fan", title, sub, onIn, legalBase = "../legal/", t = (x: string) => x }: { kind?: AccountKind; title: string; sub?: string; onIn: () => void; legalBase?: string; t?: (en: string) => string }) {
  const [mode, setMode] = useState<"up" | "in" | "forgot" | "check" | "sent">("up");
  const [name, setName] = useState(""), [who, setWho] = useState<AccountKind>(kind), [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [agree, setAgree] = useState(false), [news, setNews] = useState(kind !== "athlete"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  if (!cloudAvailable()) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setMsg(t("Enter your email address.")); return; }
    if (mode === "forgot") { setBusy(true); try { await sendPasswordReset(email.trim()); setMode("sent"); } catch (x: any) { setMsg(x?.message || t("Couldn't send the link.")); } setBusy(false); return; }
    if (mode === "up" && name.trim().length < 2) { setMsg(t("Enter your name.")); return; }
    if (pw.length < (mode === "up" ? 8 : 1)) { setMsg(mode === "up" ? t("Use a password with at least 8 characters.") : t("Enter your password.")); return; }
    if (mode === "up" && !agree) { setMsg(t("Confirm you're 13 or older and agree to the Terms and Privacy Policy.")); return; }
    setBusy(true);
    try {
      if (mode === "up") { const r = await signUp(email.trim(), pw, { name: name.trim(), kind: who, email_ok: news }); if (r === "confirm-email") { setMode("check"); setBusy(false); return; } }
      else { await signIn(email.trim(), pw); if (needsTermsAgreement()) await acceptTerms(); }
      onIn();
    } catch (x: any) { setMsg(x?.message || t("Couldn't sign in. Try again.")); }
    setBusy(false);
  };
  if (mode === "check" || mode === "sent") return <div className="ma ma-done" role="status">
    <b>{t("Check your email")}</b>
    <p>{mode === "check" ? <>{t("We sent a link to")} <b>{email}</b>. {t("Open it to finish creating your account, then come back here and sign in.")}</> : <>{t("If this email has an account, a reset link is on its way:")} <b>{email}</b></>}</p>
    <button className="btn" onClick={() => setMode("in")}>{t("Sign in")}</button>
  </div>;
  return <form className="ma" onSubmit={submit} noValidate>
    <div className="ma-hd"><b>{title}</b>{sub && <p>{sub}</p>}</div>
    {mode !== "forgot" && <div className="ma-seg" role="group" aria-label={t("Account")}><button type="button" aria-pressed={mode === "up"} onClick={() => { setMode("up"); setMsg(""); }}>{t("Create free account")}</button><button type="button" aria-pressed={mode === "in"} onClick={() => { setMode("in"); setMsg(""); }}>{t("Sign in")}</button></div>}
    {mode === "up" && <>
      <label>{t("Your name")}<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t("I'm")}<select value={who} onChange={(e) => { const k = e.target.value as AccountKind; setWho(k); setNews(k !== "athlete"); }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
    </>}
    <label>{t("Email")}<input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    {mode !== "forgot" && <label>{t("Password")}<input type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === "up" ? t("At least 8 characters") : ""} /></label>}
    {mode === "up" && <>
      <label className="ma-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{t("I'm 13 or older and agree to the")} <a href={legalBase + "terms.html"} target="_blank" rel="noopener">{t("Terms")}</a> {t("and")} <a href={legalBase + "privacy.html"} target="_blank" rel="noopener">{t("Privacy Policy")}</a>. {t("If I'm under 18, a parent or guardian agrees too.")}</span></label>
      <label className="ma-check"><input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} /><span>{t("Send Benchboard news and new features to my inbox.")}</span></label>
    </>}
    {msg && <p className="ma-err" role="alert">{msg}</p>}
    <button className="btn primary ma-go" disabled={busy}>{t(busy ? "One moment…" : mode === "up" ? "Create free account" : mode === "in" ? "Sign in" : "Send reset link")}</button>
    {mode === "in" && <button type="button" className="ma-link" onClick={() => setMode("forgot")}>{t("Forgot password?")}</button>}
    {mode === "forgot" && <button type="button" className="ma-link" onClick={() => setMode("in")}>{t("Back to sign in")}</button>}
  </form>;
}

/** "Signed in as Maya · Sign out" */
export function SignedIn({ onOut, t = (x: string) => x }: { onOut?: () => void; t?: (en: string) => string }) {
  const u = currentUser(); if (!u) return null;
  return <p className="ma-who">{t("Signed in as")} <b>{userMeta().name || u.email}</b> · <button className="ma-link" onClick={() => { signOut(); onOut?.(); }}>{t("Sign out")}</button></p>;
}
