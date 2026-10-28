/** Account, team sync, invites and joining, shown on the Team tab. */
import { siteUrl } from "./links";
import { useEffect, useState } from "react";
import { team, toast } from "../data/store";
import { Card, ConfirmButton, copyText } from "../ui/kit";
import { cloudAvailable, CloudError, currentUser, sendPasswordReset, signIn, signOut, signUp } from "./client";
import { createInvite, isLinked, joinWithCode, linkTeam, members, pendingCount, removeMember, roleOn, shareLive, shareSeason, status, syncNow, unlinkTeam, shareBoard } from "./sync";
import { go } from "../app/router";
import { QrButton } from "../ui/QrButton";

const errText = (e: unknown) => (e instanceof CloudError ? e.message : "Something went wrong. Try again.");

export function AuthForm({ onDone }: { onDone?: () => void }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const run = async (f: () => Promise<string | void>) => { setBusy(true); setMsg(""); try { const m = await f(); if (m) setMsg(m); else onDone?.(); } catch (e) { setMsg(errText(e)); } setBusy(false); };
  return <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await signIn(email.trim(), pw); toast("Signed in"); }); }}>
    <div className="two">
      <label className="field"><span className="label">Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label className="field"><span className="label">Password</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} /></label>
    </div>
    <div className="row">
      <button className="btn primary" disabled={busy || !email || !pw} type="submit">Sign in</button>
      <button className="btn" type="button" disabled={busy || !email || pw.length < 6} onClick={() => run(async () => { const r = await signUp(email.trim(), pw); if (r === "confirm-email") return "Account created. Check your email for a confirmation link, then sign in here."; toast("Account created"); })}>Create account</button>
      <button className="btn sm ghost" type="button" disabled={busy || !email} onClick={() => run(async () => { await sendPasswordReset(email.trim()); return "If that email has an account, a reset link is on its way."; })}>Forgot password</button>
    </div>
    {msg && <p className="hint">{msg}</p>}
  </form>;
}

export function CloudCard() {
  const [seasonUrl, setSeasonUrl] = useState(""), [boardUrl, setBoardUrl] = useState("");
  const t = team()!, user = currentUser(), linked = isLinked(t.id);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [invite, setInvite] = useState<{ code: string; role: string } | null>(null);
  const [joinCode, setJoinCode] = useState(""), [mem, setMem] = useState<{ user_id: string; role: string; email: string | null }[] | null>(null);
  useEffect(() => { setMem(null); setInvite(null); if (user && linked) members(t.id).then(setMem).catch(() => setMem(null)); }, [t.id, user?.id, linked]);
  const act = async (f: () => Promise<void>) => { setBusy(true); setErr(""); try { await f(); } catch (e) { setErr(errText(e)); } setBusy(false); };

  if (!cloudAvailable()) return <Card title="Cloud sync">
    <p className="small">Sync lets your assistants track on their own phones and gives parents a live link. It isn't switched on in this version yet.</p>
    <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => go("settings")}>Set up in Settings</button></div>
  </Card>;

  if (!user) return <Card title="Cloud sync">
    <div className="stack">
      <p className="small">Sign in to sync your teams across devices, share them with other coaches, and send parents a live link. Your teams keep working offline either way.</p>
      <div className="row"><button className="btn primary" onClick={() => go("account")}>Sign in</button><button className="btn" onClick={() => go("account", "signup")}>Create account</button></div>
    </div>
  </Card>;

  const isOwnerOrCoach = mem?.find((m) => m.user_id === user.id)?.role !== "viewer";
  const link = invite ? location.origin + location.pathname + "#/join/" + invite.code : "";
  return <Card title="Cloud sync" actions={<span className="small muted">{user.email} · <button className="btn sm ghost" onClick={() => { signOut(); toast("Signed out"); }}>Sign out</button></span>}>
    <div className="stack">
      {t.sample ? <p className="small muted">The sample team stays on this device. Create or pick your own team to sync it.</p>
        : !linked ? <>
          <p className="small"><b>{t.name}</b> is only on this device. Turn on sync to back it up and share it with other coaches.</p>
          <div className="row"><button className="btn primary" disabled={busy} onClick={() => act(async () => { await linkTeam(t.id); toast("Team synced"); setMem(await members(t.id)); })}>{busy ? "Uploading…" : "Sync this team"}</button></div>
        </> : <>
          <p className="small"><span className="tag good" style={{ marginLeft: 0 }}>Synced</span> {status.state === "syncing" ? "Syncing…" : status.state === "error" ? <span style={{ color: "var(--bad)" }}>{status.error}</span> : status.last ? `Up to date · ${new Date(status.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting to sync"}{pendingCount() ? ` · ${pendingCount()} changes waiting` : ""}</p>
          <div className="row"><button className="btn sm" disabled={status.state === "syncing"} onClick={() => syncNow()}>Sync now</button></div>
          {roleOn(t.id) === "viewer" && <p className="hint">You have view-only access to this team: you see everything the coaches record, and changes made on this device stay here.</p>}
          <div className="label">Coaches and viewers</div>
          {mem ? <ul className="log">{mem.map((m) => <li key={m.user_id} style={{ gridTemplateColumns: "1fr auto auto" }}><span>{m.email || "Coach"}{m.user_id === user.id ? " (you)" : ""}</span><span className="tag" style={{ marginLeft: 0 }}>{m.role}</span>
            {m.user_id !== user.id && m.role !== "owner" ? <ConfirmButton className="btn sm ghost" confirmText="Remove?" onConfirm={() => act(async () => { await removeMember(t.id, m.user_id); setMem(await members(t.id)); })}>✕</ConfirmButton> : <span />}</li>)}</ul> : <p className="small muted">Loading…</p>}
          {isOwnerOrCoach && <div className="row">
            <button className="btn sm" disabled={busy} onClick={() => act(async () => setInvite({ code: await createInvite(t.id, "coach"), role: "coach" }))}>Invite a coach</button>
            <button className="btn sm" disabled={busy} onClick={() => act(async () => setInvite({ code: await createInvite(t.id, "viewer"), role: "viewer" }))}>Invite view-only</button>
          </div>}
          {invite && <div className="hint"><div>Send this to the {invite.role === "coach" ? "coach" : "viewer"}. They open the link (or enter the code on their Team tab) after signing in:</div>
            <div className="row" style={{ marginTop: 6 }}><b style={{ fontFamily: "var(--display)", fontSize: 22, letterSpacing: ".12em" }}>{invite.code}</b><button className="btn sm" onClick={() => copyText(link).then((ok) => toast(ok ? "Link copied" : link))}>Copy link</button></div>
            <div className="small muted" style={{ marginTop: 4 }}>{invite.role === "coach" ? "Coaches can track matches, edit the roster and plan practices." : "View-only accounts can see everything but not change it."}</div></div>}
          {isOwnerOrCoach && <>
            <div className="label">Team page on Benchboard Live</div>
            <p className="small muted" style={{ margin: 0 }}>A separate public site for families and fans: live scores during matches, results, schedule, box scores and every player's stats. Last names show as initials, and nobody can change anything. Families can open the link or type the code at Benchboard Live.</p>
            <div className="row"><button className="btn sm" disabled={busy || !t.activeSeasonId} onClick={() => act(async () => { const r = await shareSeason(t.id, t.activeSeasonId!); setSeasonUrl(r.url); const ok = await copyText(r.url); toast(ok ? "Team page link copied. Share it with families." : "Team page: " + r.url); })}>Share team page</button>
              {seasonUrl && <QrButton url={seasonUrl} title="Scan to follow the team on Benchboard Live" label="QR code" />}
              {seasonUrl && <span className="small">Code <b style={{ fontFamily: "var(--display)", letterSpacing: ".12em" }}>{seasonUrl.split("/").pop()}</b></span>}
              {seasonUrl && <a className="small" href={seasonUrl} target="_blank" rel="noopener" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seasonUrl}</a>}</div>
            <div className="label">Recruiting board on Benchboard Recruit</div>
            <p className="small muted" style={{ margin: 0 }}>One link for college coaches listing every player whose recruiting profile you've shared (only with the family's permission, from each player's page), with verified stats and highlight clips.</p>
            <div className="row"><button className="btn sm" disabled={busy} onClick={() => act(async () => { const r = await shareBoard(t.id); setBoardUrl(r.url); const ok = await copyText(r.url); toast(ok ? "Recruiting board link copied." : "Recruiting board: " + r.url); })}>Share recruiting board</button>
              {boardUrl && <a className="small" href={boardUrl} target="_blank" rel="noopener" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{boardUrl}</a>}</div>
          </>}
          <div className="row"><ConfirmButton className="btn sm ghost" confirmText="Stop syncing on this device?" onConfirm={() => { unlinkTeam(t.id); toast("Stopped syncing this team on this device"); }}>Stop syncing on this device</ConfirmButton></div>
        </>}
      <div className="label" style={{ marginTop: 6 }}>Join a team</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); act(async () => { await joinWithCode(joinCode); toast("Joined the team"); setJoinCode(""); }); }}>
        <input className="input" style={{ maxWidth: 160, textTransform: "uppercase", letterSpacing: ".1em" }} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="CODE" aria-label="Invite code" />
        <button className="btn sm" disabled={busy || joinCode.trim().length < 4} type="submit">Join</button>
      </form>
      {err && <p className="hint warn">{err}</p>}
    </div>
  </Card>;
}

/** #/join/CODE */
export function JoinPage({ code }: { code: string }) {
  const user = currentUser();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle"), [err, setErr] = useState("");
  const join = async () => { setState("busy"); setErr(""); try { await joinWithCode(code); setState("done"); toast("Joined the team"); go("team"); } catch (e) { setErr(errText(e)); setState("idle"); } };
  return <div className="page" style={{ maxWidth: 620 }}>
    <Card title={`Join a team · ${code}`}>
      {!cloudAvailable() ? <p>Cloud sync isn't set up in this version of the app.</p>
        : !user ? <div className="stack"><p className="small">Sign in or create an account first. Then you'll join the team.</p><div className="row"><button className="btn primary" onClick={() => { try { sessionStorage.setItem("bs-join", code); } catch { /* ignore */ } go("account"); }}>Sign in</button></div></div>
          : <div className="stack"><p className="small">Signed in as {user.email}.</p><div className="row"><button className="btn primary" disabled={state === "busy"} onClick={join}>{state === "busy" ? "Joining…" : "Join team"}</button></div></div>}
      {err && <p className="hint warn" style={{ marginTop: 8 }}>{err}</p>}
    </Card>
  </div>;
}

/** "Share live link" for parents, on the Live screen. */
export const liveUrlFor = (matchId: string) => { try { const u = localStorage.getItem("bs-live-url-" + matchId) || ""; const old = /#\/watch\/([A-Z0-9]+)/i.exec(u); return old ? siteUrl("live", "g/" + old[1]) : u; } catch { return ""; } };
export function ShareLive({ matchId }: { matchId: string }) {
  const t = team()!, [busy, setBusy] = useState(false), [url, setUrlState] = useState(() => liveUrlFor(matchId));
  const setUrl = (u: string) => { setUrlState(u); try { localStorage.setItem("bs-live-url-" + matchId, u); } catch { /* private mode */ } };
  if (!cloudAvailable() || t.sample) return null;
  if (!currentUser() || !isLinked(t.id)) return <button className="btn sm" onClick={() => go("team")} title="Sign in and sync this team to share a live link">Share with parents</button>;
  return <span className="row" style={{ flexWrap: "nowrap" }}>
    <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await shareLive(t.id, matchId); setUrl(r.url); const ok = await copyText(r.url); toast(ok ? "Gamecast link copied. Text it to parents." : "Gamecast: " + r.url); } catch (e) { toast(errText(e)); } setBusy(false); }}>{busy ? "Making link…" : "Share gamecast"}</button>
    {url && <QrButton url={url} title="Scan to follow the match live" label="QR code" />}
    {url && <span className="small muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>}
  </span>;
}
