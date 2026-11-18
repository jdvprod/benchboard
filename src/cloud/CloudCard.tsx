/** Account, team sync, invites and joining, shown on the Team tab. */
import { siteUrl } from "./links";
import { useEffect, useState } from "react";
import { get, seasonsOf, team, toast } from "../data/store";
import { Card, ConfirmButton, copyText, download } from "../ui/kit";
import { cloudAvailable, CloudError, currentUser, signOut } from "./client";
import { CoachVerify, useCoachStatus } from "./CoachVerify";
import { createInvite, decideMember, isLinked, joinedMsg, joinWithCode, linkTeam, Member, members, pendingCount, removeMember, roleOn, shareLive, shareSeason, status, syncNow, unlinkTeam, shareBoard } from "./sync";
import { go } from "../app/router";
import { QrButton } from "../ui/QrButton";
import { flyerHtml, flyerImage } from "../features/team/familyFlyer";

const errText = (e: unknown) => (e instanceof CloudError ? e.message : "Something went wrong. Try again.");

export function CloudCard() {
  const [seasonUrl, setSeasonUrl] = useState(""), [boardUrl, setBoardUrl] = useState("");
  const t = team()!, user = currentUser(), linked = isLinked(t.id);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [invite, setInvite] = useState<{ code: string; role: string } | null>(null);
  const [joinCode, setJoinCode] = useState(""), [mem, setMem] = useState<Member[] | null>(null);
  const [coach, setCoach] = useCoachStatus();
  // players and families don't see who else is on the team
  useEffect(() => { setMem(null); setInvite(null); if (user && linked && roleOn(t.id) !== "viewer") members(t.id).then(setMem).catch(() => setMem(null)); }, [t.id, user?.id, linked]);
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

  const myRole = roleOn(t.id) || mem?.find((m) => m.user_id === user.id)?.role, isOwnerOrCoach = myRole !== "viewer" && myRole !== "pending";
  const link = invite ? location.origin + location.pathname + "#/join/" + invite.code : "";
  return <Card title="Cloud sync" actions={<span className="small muted">{user.email} · <button className="btn sm ghost" onClick={() => { signOut(); toast("Signed out"); }}>Sign out</button></span>}>
    <div className="stack">
      {t.sample ? <p className="small muted">The sample team stays on this device. Create or pick your own team to sync it.</p>
        : !linked && roleOn(t.id) === "pending" ? <p className="small"><b>Waiting for the team's owner to approve you.</b> You joined {t.name} with a coach code. Once the head coach approves you on their Team tab, the team's stats and plans come down to this device.</p>
        : !linked && coach && coach.status !== "approved" ? <CoachVerify s={coach} onChange={setCoach} />
        : !linked ? <>
          <p className="small"><b>{t.name}</b> is only on this device. Turn on sync to back it up and share it with other coaches.</p>
          <div className="row"><button className="btn primary" disabled={busy} onClick={() => act(async () => { await linkTeam(t.id); toast("Team synced"); setMem(await members(t.id)); })}>{busy ? "Uploading…" : "Sync this team"}</button></div>
        </> : <>
          <p className="small"><span className="tag good" style={{ marginLeft: 0 }}>Synced</span> {status.state === "syncing" ? "Syncing…" : status.state === "error" ? <span style={{ color: "var(--bad)" }}>{status.error}</span> : status.last ? `Up to date · ${new Date(status.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting to sync"}{pendingCount() ? ` · ${pendingCount()} changes waiting` : ""}</p>
          <div className="row"><button className="btn sm" disabled={status.state === "syncing"} onClick={() => syncNow()}>Sync now</button></div>
          {roleOn(t.id) === "viewer" && <p className="hint">You follow {t.name} as a player or family member: you see results, stats and announcements as the coaches record them.</p>}
          {roleOn(t.id) !== "viewer" && <div className="label">Coaches and viewers</div>}
          {mem && roleOn(t.id) === "owner" && mem.some((m) => m.status === "pending") && <div className="hint mem-wait">
            <b>{mem.filter((m) => m.status === "pending").length === 1 ? "A coach is" : "Coaches are"} waiting to join</b>
            <span className="small muted">They used your coach code. Approve only people you know coach with you: coaches see scouting, notes and every player's stats.</span>
            <ul className="log">{mem.filter((m) => m.status === "pending").map((m) => <li key={m.user_id} style={{ gridTemplateColumns: "1fr auto auto" }}><span>{m.email || "Coach"}</span>
              <button className="btn sm primary" disabled={busy} onClick={() => act(async () => { await decideMember(t.id, m.user_id, true); toast("Approved"); setMem(await members(t.id)); })}>Approve</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => act(async () => { await decideMember(t.id, m.user_id, false); setMem(await members(t.id)); })}>Turn down</button></li>)}</ul>
          </div>}
          {mem ? <ul className="log">{mem.filter((m) => m.status !== "pending").map((m) => <li key={m.user_id} style={{ gridTemplateColumns: "1fr auto auto" }}><span>{m.email || "Coach"}{m.user_id === user.id ? " (you)" : ""}</span><span className="tag" style={{ marginLeft: 0 }}>{m.role === "viewer" ? "view-only" : m.role}</span>
            {m.user_id !== user.id && m.role !== "owner" ? <ConfirmButton className="btn sm ghost" confirmText="Remove?" onConfirm={() => act(async () => { await removeMember(t.id, m.user_id); setMem(await members(t.id)); })}>✕</ConfirmButton> : <span />}</li>)}</ul> : roleOn(t.id) === "viewer" ? null : <p className="small muted">Loading…</p>}
          {isOwnerOrCoach && <div className="row">
            <button className="btn sm" disabled={busy} onClick={() => act(async () => setInvite({ code: await createInvite(t.id, "coach"), role: "coach" }))}>Invite a coach</button>
            <button className="btn sm" disabled={busy} onClick={() => act(async () => setInvite({ code: await createInvite(t.id, "viewer"), role: "viewer" }))}>Invite view-only</button>
          </div>}
          {invite && <div className="hint"><div>Send this to the {invite.role === "coach" ? "coach" : "viewer"}. They open the link (or enter the code on their Team tab) after signing in:</div>
            <div className="row" style={{ marginTop: 6 }}><b style={{ fontFamily: "var(--display)", fontSize: 22, letterSpacing: ".12em" }}>{invite.code}</b><button className="btn sm" onClick={() => copyText(link).then((ok) => toast(ok ? "Link copied" : link))}>Copy link</button></div>
            <div className="small muted" style={{ marginTop: 4 }}>{invite.role === "coach" ? "Coaches can track matches, edit the roster and plan practices. You approve each one here after they join." : "For players and families: they see stats, results and the schedule, never your scouting, drills or practice plans."}</div></div>}
          {isOwnerOrCoach && <>
            <div className="label">Team page on Floorcall Live</div>
            <p className="small muted" style={{ margin: 0 }}>A separate public site for families and fans: live scores during matches, results, schedule, box scores and every player's stats. Last names show as initials, and nobody can change anything. Families can open the link or type the code at Floorcall Live.</p>
            <div className="row"><button className="btn sm" disabled={busy || !t.activeSeasonId} onClick={() => act(async () => { const r = await shareSeason(t.id, t.activeSeasonId!); setSeasonUrl(r.url); const ok = await copyText(r.url); toast(ok ? "Team page link copied. Share it with families." : "Team page: " + r.url); })}>Share team page</button>
              {seasonUrl && <QrButton url={seasonUrl} title="Scan to follow the team on Floorcall Live" label="QR code" />}
              {seasonUrl && <span className="small">Code <b style={{ fontFamily: "var(--display)", letterSpacing: ".12em" }}>{seasonUrl.split("/").pop()}</b></span>}
              {seasonUrl && <a className="small" href={seasonUrl} target="_blank" rel="noopener" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seasonUrl}</a>}</div>
            {seasonUrl && <div className="row"><span className="small muted">Get families following:</span>
              <button className="btn sm" onClick={() => { const se = seasonsOf().find((x) => x.id === t.activeSeasonId)?.name; download(`${t.name} - follow us live.html`.replace(/[^\w\- .]+/g, ""), flyerHtml(t, seasonUrl, se), "text/html"); toast("Flyer saved. Open it to print for the gym or the team table."); }}>Printable flyer</button>
              <button className="btn sm" onClick={async () => { const se = seasonsOf().find((x) => x.id === t.activeSeasonId)?.name; const b = await flyerImage(t, seasonUrl, se); if (!b) return; const name = `${t.name} - follow us live.png`.replace(/[^\w\- .]+/g, ""), file = new File([b], name, { type: "image/png" }), nav: any = navigator; if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return; } catch { /* save instead */ } } download(name, b, "image/png"); toast("Flyer image saved. Post it in the team group chat."); }}>Flyer image</button></div>}
            <div className="label">Recruiting board on Floorcall Recruit</div>
            <p className="small muted" style={{ margin: 0 }}>One link for college coaches listing every player whose recruiting profile you've shared (only with the family's permission, from each player's page), with verified stats and highlight clips.</p>
            <div className="row"><button className="btn sm" disabled={busy} onClick={() => act(async () => { const r = await shareBoard(t.id); setBoardUrl(r.url); const ok = await copyText(r.url); toast(ok ? "Recruiting board link copied." : "Recruiting board: " + r.url); })}>Share recruiting board</button>
              {boardUrl && <a className="small" href={boardUrl} target="_blank" rel="noopener" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{boardUrl}</a>}</div>
          </>}
          <div className="row"><ConfirmButton className="btn sm ghost" confirmText="Stop syncing on this device?" onConfirm={() => { unlinkTeam(t.id); toast("Stopped syncing this team on this device"); }}>Stop syncing on this device</ConfirmButton></div>
        </>}
      <div className="label" style={{ marginTop: 6 }}>Join a team</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); act(async () => { const id = await joinWithCode(joinCode); toast(joinedMsg(id)); setJoinCode(""); }); }}>
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
  const join = async () => { setState("busy"); setErr(""); try { const id = await joinWithCode(code); setState("done"); toast(joinedMsg(id)); go(get("teams", id) ? "team" : "home"); } catch (e) { setErr(errText(e)); setState("idle"); } };
  return <div className="page" style={{ maxWidth: 620 }}>
    <Card title="Join a team">
      {!cloudAvailable() ? <p>Cloud sync isn't set up in this version of the app.</p>
        : !user ? <div className="stack"><p className="small">Sign in or create an account first. Then you'll join the team.</p><div className="row"><button className="btn primary" onClick={() => { try { sessionStorage.setItem("bs-join", code); } catch { /* ignore */ } go("account"); }}>Sign in</button></div></div>
          : <div className="stack"><p>You've been invited to a team on Floorcall with the code <b className="num" style={{ letterSpacing: ".08em" }}>{code}</b>.</p>
            <p className="small muted">Players and families see the team's results, stats and announcements. Coaches who join are approved by the head coach first. You're signed in as {user.email}.</p><div className="row"><button className="btn primary" disabled={state === "busy"} onClick={join}>{state === "busy" ? "Joining…" : "Join team"}</button></div></div>}
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
