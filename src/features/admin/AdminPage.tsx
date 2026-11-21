/** Admin console for the people who run FloorCall: sign-ups, active teams, what's live, and a review of every uploaded
 * photo and logo with a one-tap take-down. Only accounts listed in the admins table can open it (the database checks). */
import { useEffect, useState } from "react";
import { Card, ConfirmButton, download, Kpi } from "../../ui/kit";
import { config, resendConfirmation, rpc, sendPasswordReset } from "../../cloud/client";
import { toast } from "../../data/store";
import { COLLEGE_SEARCH } from "../../recruit/flags";
import { AI_DAILY_DEFAULT } from "../../app/flags";

interface Overview { users: number; users7: number; teams: number; activeTeams7: number; matches: number; matches7: number; liveNow: number; teamPages: number; gamecasts: number; recruitProfiles: number; notifyPhones: number; errors?: { message: string; count: number; users: number; last: string; version: string; page: string; stack?: string }[];
  recentUsers: { email: string; at: string }[]; teamsList: { id: string; name: string; members: number; matches: number; last: string | null; created: string }[]; at: string }
interface Pic { path: string; at: string; team: string | null }
interface Staff { user_id: string; email: string; name: string; school: string; title?: string; status: "pending" | "approved" | "denied"; at: string }

const ago = (iso?: string | null) => { if (!iso) return "never"; const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** True when the signed-in account is a FloorCall admin (cached for the session). */
let adminCache: Promise<boolean> | null = null;
export const amAdmin = () => (adminCache ||= rpc("is_admin", {}).then((x) => x === true).catch(() => false));

type CoachReq = { user_id: string; email: string; name: string; org: string; title: string | null; phone: string | null; status: "pending" | "approved" | "denied"; at: string };
/** Team admins: coaches who asked to put teams in the cloud. Check the school's or club's staff page before approving. */
function CoachRequests({ list, onDecide }: { list: CoachReq[]; onDecide: (c: CoachReq, approve: boolean) => void }) {
  const [all, setAll] = useState(false);
  const waiting = list.filter((c) => c.status === "pending"), shown = all ? list : waiting;
  return <Card title={`Coach verification${waiting.length ? ` (${waiting.length} waiting)` : ""}`} actions={<button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? "Only waiting" : `Show all ${list.length}`}</button>}>
    <p className="small muted" style={{ marginBottom: 8 }}>Head coaches and club directors who want to sync a team. Check the school's or club's staff page (or call the number) before approving. Assistants are approved by their own head coach, not here.</p>
    {!shown.length ? <p className="empty">{all ? "No requests yet." : "Nobody is waiting."}</p> : <div className="tbl"><table><thead><tr><th className="l">Coach</th><th className="l">School or club</th><th className="l">Contact</th><th>Status</th><th></th></tr></thead>
      <tbody>{shown.map((c) => <tr key={c.user_id}><td className="l">{c.name || "(no name)"}{c.title ? <div className="small muted">{c.title}</div> : null}</td><td className="l">{c.org || "–"}</td><td className="l small">{c.email}{c.phone ? <div className="muted">{c.phone}</div> : null}</td>
        <td>{c.status === "pending" ? <b>Waiting · {ago(c.at)}</b> : c.status === "approved" ? "Verified" : "Turned down"}</td>
        <td><div className="row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>{c.status !== "approved" && <button className="btn sm primary" onClick={() => onDecide(c, true)}>Verify</button>}
          {c.status !== "denied" && <button className="btn sm ghost" onClick={() => onDecide(c, false)}>{c.status === "approved" ? "Remove" : "Turn down"}</button>}</div></td></tr>)}</tbody></table></div>}
  </Card>;
}

type Msg = { id: string; created_at: string; name: string | null; email: string; topic: string; message: string; site: string | null; status: "open" | "done" };
const TOPIC: Record<string, string> = { question: "Question", bug: "Problem", club: "Club or school", billing: "Billing", privacy: "Privacy", idea: "Idea" };
/** Messages from the Contact page and each site's Help link. Reply by email, then mark them done. */
function Messages({ list, onDone }: { list: Msg[]; onDone: (m: Msg, done: boolean) => void }) {
  const [all, setAll] = useState(false);
  const open = list.filter((m) => m.status === "open"), shown = all ? list : open;
  return <Card title={`Messages${open.length ? ` (${open.length} open)` : ""}`} actions={<button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? "Only open" : `Show all ${list.length}`}</button>}>
    {!shown.length ? <p className="empty">{all ? "No messages yet." : "Nothing waiting for a reply."}</p> : <ul className="log admin-msgs">{shown.map((m) => <li key={m.id}>
      <div className="admin-msg-hd"><b>{TOPIC[m.topic] || m.topic}</b><span className="small muted">{m.name ? m.name + " · " : ""}{m.email} · from {m.site || "the website"} · {ago(m.created_at)}</span></div>
      <p className="admin-msg-body">{m.message}</p>
      <div className="row"><a className="btn sm primary" href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your FloorCall message")}&body=${encodeURIComponent("\n\n> " + m.message.split("\n").slice(0, 8).join("\n> "))}`}>Reply by email</a>
        <button className="btn sm ghost" onClick={() => onDone(m, m.status === "open")}>{m.status === "open" ? "Mark done" : "Reopen"}</button></div>
    </li>)}</ul>}
  </Card>;
}

/** Support: find an account by email, see its teams and status, resend its emails, and move a team to another coach. */
interface Acct { id: string; email: string; created: string | null; confirmed: string | null; last_sign_in: string | null; name: string | null; kind: string | null; terms: string | null; admin: boolean; verify: string | null;
  teams: { id: string; name: string; role: string; status: string; owner: string; members: number }[]; lessons: number; ai: { limit: number | null; own_key: boolean } | null; ai_today: number }
function FindAccount() {
  const [email, setEmail] = useState(""), [a, setA] = useState<Acct | null | undefined>(undefined), [err, setErr] = useState(""), [to, setTo] = useState<Record<string, string>>({});
  const look = async (em = email) => { setErr(""); try { setA(await rpc("admin_account", { em: em.trim() })); } catch (e: any) { setErr(e?.message || "Couldn't look that up."); } };
  const day = (x: string | null) => (x ? new Date(x).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "never");
  const send = async (f: () => Promise<unknown>, done: string) => { try { await f(); toast(done); } catch (e: any) { toast(e?.message || "Couldn't send it."); } };
  return <Card title="Find an account" actions={<span className="small muted">For support emails: check an account, resend its emails, or move a team to another coach.</span>}>
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (email.trim()) look(); }}>
      <input className="input grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their@email.com" aria-label="Account email" />
      <button className="btn primary" disabled={!email.trim()}>Look up</button></form>
    {err && <p className="hint warn" role="alert">{err}</p>}
    {a === null && <p className="empty">No account with that email. They may have used another address, or never finished signing up.</p>}
    {a && <div className="stack" style={{ marginTop: 10 }}>
      <div className="admin-acct"><b>{a.name || a.email}</b> <span className="muted small">{a.email} · {a.kind || "coach"}{a.admin ? " · admin" : ""}{a.verify ? ` · verification ${a.verify}` : ""}</span>
        <p className="small">Joined {day(a.created)} · email {a.confirmed ? "confirmed" : <b>not confirmed</b>} · last sign-in {day(a.last_sign_in)} · terms v{a.terms || "?"} · {a.lessons} Lessons athletes · AI today {a.ai_today}{a.ai ? ` (limit ${a.ai.limit ?? "default"}${a.ai.own_key ? ", own key" : ""})` : ""}</p></div>
      <div className="row">{!a.confirmed && <button className="btn sm" onClick={() => send(() => resendConfirmation(a.email), "Confirmation email sent again")}>Resend confirmation</button>}
        <button className="btn sm" onClick={() => send(() => sendPasswordReset(a.email), "Password reset link sent")}>Send password reset</button>
        <a className="btn sm ghost" href={`mailto:${a.email}`}>Email them</a></div>
      {a.teams.length ? <div className="tbl"><table><thead><tr><th className="l">Team</th><th>Role</th><th>People</th><th className="l">Owner</th><th className="l">Move to</th></tr></thead>
        <tbody>{a.teams.map((t) => <tr key={t.id}><td className="l">{t.name || t.id}</td><td>{t.role}{t.status === "pending" ? " (waiting)" : ""}</td><td>{t.members}</td><td className="l small">{t.owner}</td>
          <td className="l"><div className="row" style={{ flexWrap: "nowrap", gap: 6 }}><input className="input" style={{ minWidth: 150 }} type="email" placeholder="new owner's email" aria-label={"New owner for " + (t.name || t.id)} value={to[t.id] || ""} onChange={(e) => setTo({ ...to, [t.id]: e.target.value })} />
            <ConfirmButton className="btn sm" confirmText="Move it?" onConfirm={async () => { try { await rpc("admin_transfer_team", { t: t.id, em: (to[t.id] || "").trim() }); toast("Team moved"); look(a.email); } catch (e: any) { toast(e?.message || "Couldn't move it."); } }}>Move</ConfirmButton></div></td></tr>)}</tbody></table></div>
        : <p className="small muted">Not on any synced team.</p>}
    </div>}
  </Card>;
}

/** AI access: give one account more (or fewer) AI requests a day, or let it use its own Anthropic key. */
interface Grant { email: string; limit: number | null; own_key: boolean; note: string | null; at: string; today: number }
function AiAccess() {
  const [list, setList] = useState<Grant[] | null>(null), [email, setEmail] = useState(""), [lim, setLim] = useState(""), [own, setOwn] = useState(false), [note, setNote] = useState(""), [err, setErr] = useState("");
  useEffect(() => { rpc("admin_ai_list", {}).then(setList).catch(() => setList([])); }, []);
  const save = async (em: string, l: number | null, o: boolean, n: string | null) => { setErr(""); try { setList(await rpc("admin_ai_grant", { em, lim: l, own: o, why: n })); setEmail(""); setLim(""); setOwn(false); setNote(""); toast("AI access saved"); } catch (e: any) { setErr(e?.message || "Couldn't save."); } };
  return <Card title="AI access" actions={<span className="small muted">Every coach gets {AI_DAILY_DEFAULT} AI requests a day. Change it for one account here, or let it use its own Anthropic key.</span>}>
    <form className="row" style={{ alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); if (email.trim()) save(email.trim(), lim.trim() === "" ? null : Math.max(0, +lim | 0), own, note.trim() || null); }}>
      <label className="field" style={{ flex: "2 1 220px" }}><span className="label">Account email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" aria-label="Email to change AI access for" /></label>
      <label className="field" style={{ flex: "1 1 110px" }}><span className="label">Requests a day</span><input value={lim} onChange={(e) => setLim(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={String(AI_DAILY_DEFAULT)} /></label>
      <label className="row small" style={{ gap: 6, paddingBottom: 10 }}><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> May use own key</label>
      <label className="field" style={{ flex: "2 1 200px" }}><span className="label">Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (asked by email on …)" /></label>
      <button className="btn primary" disabled={!email.trim()}>Save</button>
    </form>
    {err && <p className="hint warn" role="alert">{err}</p>}
    {list && list.length > 0 && <div className="tbl" style={{ marginTop: 10 }}><table><thead><tr><th className="l">Account</th><th>Per day</th><th>Own key</th><th>Today</th><th className="l">Note</th><th /></tr></thead>
      <tbody>{list.map((g) => <tr key={g.email}><td className="l small">{g.email}</td><td>{g.limit ?? AI_DAILY_DEFAULT}</td><td>{g.own_key ? "Yes" : "–"}</td><td>{g.today}</td><td className="l small muted">{g.note || ""}</td>
        <td><button className="btn sm ghost" onClick={() => save(g.email, null, false, null)}>Reset</button></td></tr>)}</tbody></table></div>}
  </Card>;
}

export function AdminPage() {
  const [acc, setAcc] = useState<{ byKind: Record<string, number>; emailOk: number } | null>(null), [o, setO] = useState<Overview | null>(null), [pics, setPics] = useState<Pic[] | null>(null), [err, setErr] = useState(""), [staff, setStaff] = useState<Staff[]>([]), [coaches, setCoaches] = useState<CoachReq[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const load = async () => {
    rpc("admin_support", {}).then(setMsgs).catch(() => setMsgs(null));
    try { setO(await rpc("admin_overview", {})); setPics(await rpc("admin_pictures", { lim: 60 })); setStaff(await rpc("admin_college_staff", {}).catch(() => [])); setCoaches(await rpc("admin_coach_requests", {}).catch(() => null)); setAcc(await rpc("admin_accounts", {}).catch(() => null)); setErr(""); }
    catch (e: any) { setErr(/admins only/i.test(e?.message || "") ? "This account isn't a FloorCall admin." : e?.message || "Couldn't load the admin console."); }
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const base = config()?.url + "/storage/v1/object/public/media/";
  if (err) return <div className="page"><Card title="Admin"><p>{err}</p><p className="small muted">To make an account an admin, run this in Supabase → SQL Editor:<br /><code>insert into public.admins select id from auth.users where email = 'you@example.com';</code></p></Card></div>;
  if (!o) return <div className="page"><p className="empty">Loading…</p></div>;
  return <div className="page">
    <div className="pagehead"><h1>Admin</h1><div className="row"><span className="small muted">Updated {ago(o.at)}</span><button className="btn sm" onClick={load}>Refresh</button></div></div>
    <div className="kpis">
      <Kpi label="Accounts" value={String(o.users)} sub={`${o.users7} new this week`} />
      <Kpi label="Teams" value={String(o.teams)} sub={`${o.activeTeams7} active this week`} />
      <Kpi label="Matches" value={String(o.matches)} sub={`${o.matches7} this week`} />
      <Kpi label="Live now" value={String(o.liveNow)} sub="matches being tracked" />
      <Kpi label="Shared" value={String(o.teamPages)} sub={`team pages · ${o.gamecasts} gamecasts · ${o.recruitProfiles} recruit`} />
      <Kpi label="Family phones" value={String(o.notifyPhones)} sub="get match notifications" />
    </div>
    {acc && <Card title="Accounts" actions={<button className="btn sm" onClick={async () => {
      try { const rows: { email: string; name: string; kind: string; joined: string }[] = await rpc("admin_email_list", {}); const q = (x: string) => '"' + String(x || "").replace(/"/g, '""') + '"';
        download("floorcall-news-list.csv", "email,name,kind,joined\n" + rows.map((x) => [q(x.email), q(x.name), q(x.kind), q(x.joined)].join(",")).join("\n"), "text/csv"); toast(`${rows.length} people on the news list`); }
      catch (e: any) { toast(e?.message || "Couldn't get the list."); } }}>Download news email list</button>}>
      <div className="row" style={{ gap: 18 }}>{(["coach", "athlete", "parent", "fan"] as const).map((k) => <span key={k}><b className="num" style={{ fontSize: 22 }}>{acc.byKind[k] || 0}</b> <span className="small muted">{k === "coach" ? "coaches" : k === "athlete" ? "athletes" : k === "parent" ? "parents" : "fans"}</span></span>)}
        <span><b className="num" style={{ fontSize: 22 }}>{acc.emailOk}</b> <span className="small muted">said yes to news emails</span></span></div>
      <p className="small muted" style={{ marginTop: 8 }}>Only people who said yes are on the list. Every news email needs an unsubscribe link and your mailing address (CAN-SPAM); send it from an email service such as Resend, Postmark or Mailchimp.</p>
    </Card>}
    <div className="grid2" style={{ alignItems: "start" }}>
      <Card title="Most active teams"><div className="tbl"><table><thead><tr><th className="l">Team</th><th>Coaches</th><th>Matches</th><th>Last active</th></tr></thead>
        <tbody>{o.teamsList.map((t) => <tr key={t.id}><td className="l">{t.name || "(no name)"}</td><td>{t.members}</td><td>{t.matches}</td><td>{ago(t.last)}</td></tr>)}</tbody></table></div></Card>
      <Card title="New accounts"><ul className="log">{o.recentUsers.map((u) => <li key={u.email + u.at} style={{ gridTemplateColumns: "1fr auto" }}><span>{u.email}</span><span className="small muted">{ago(u.at)}</span></li>)}</ul></Card>
    </div>
    {msgs && <Messages list={msgs} onDone={async (m, done) => { try { await rpc("admin_support_done", { mid: m.id, done }); setMsgs((x) => x && x.map((y) => (y.id === m.id ? { ...y, status: done ? "done" : "open" } : y))); } catch (e: any) { toast(e?.message || "Couldn't save."); } }} />}
    {coaches && <CoachRequests list={coaches} onDecide={async (c, approve) => { await rpc("admin_decide_coach", { uid: c.user_id, approve }); setCoaches((x) => x && x.map((y) => (y.user_id === c.user_id ? { ...y, status: approve ? "approved" : "denied" } : y))); toast(approve ? `${c.name || c.email} can sync teams now` : "Turned down"); }} />}
    {COLLEGE_SEARCH && <Card title="College coaches" actions={<span className="small muted">Approve staff who can search listed players on FloorCall Recruit. Check the school's staff directory first.</span>}>
      {!staff.length ? <p className="empty">No requests yet.</p> : <div className="tbl"><table><thead><tr><th className="l">Name</th><th className="l">School</th><th className="l">Email</th><th>Status</th><th></th></tr></thead>
        <tbody>{staff.map((s) => <tr key={s.user_id}><td className="l">{s.name}{s.title ? <div className="small muted">{s.title}</div> : null}</td><td className="l">{s.school}</td><td className="l small">{s.email}</td><td>{s.status === "pending" ? <b>Waiting</b> : s.status === "approved" ? "Approved" : "Turned down"}</td>
          <td><div className="row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>{s.status !== "approved" && <button className="btn sm primary" onClick={async () => { await rpc("admin_decide_college", { uid: s.user_id, approve: true }); setStaff((x) => x.map((y) => (y.user_id === s.user_id ? { ...y, status: "approved" } : y))); }}>Approve</button>}
            {s.status !== "denied" && <button className="btn sm ghost" onClick={async () => { await rpc("admin_decide_college", { uid: s.user_id, approve: false }); setStaff((x) => x.map((y) => (y.user_id === s.user_id ? { ...y, status: "denied" } : y))); }}>{s.status === "approved" ? "Remove access" : "Turn down"}</button>}</div></td></tr>)}</tbody></table></div>}
    </Card>}
    <FindAccount />
    <AiAccess />
    <Card title="Problems in the last two weeks" actions={<span className="small muted">Crashes coaches hit, newest first. No team data is sent, only the error and the screen.</span>}>
      {!o.errors?.length ? <p className="empty">No problems reported.</p> : <ul className="log admin-errs">{o.errors.map((e) => <li key={e.message}>
        <details><summary><b>{e.message}</b><span className="small muted"> · {e.count}× · {e.users} {e.users === 1 ? "coach" : "coaches"} · {e.page} · v{e.version} · {ago(e.last)}</span></summary>{e.stack && <pre>{e.stack}</pre>}</details></li>)}</ul>}
    </Card>
    <Card title="Photos and logos" actions={<span className="small muted">Newest first. Take down anything that isn't a team logo or an appropriate player photo.</span>}>
      {!pics?.length ? <p className="empty">No pictures uploaded yet.</p> : <div className="admin-pics">{pics.map((p) => <figure key={p.path}>
        <img src={base + p.path} alt="" loading="lazy" />
        <figcaption><b>{p.team || "Unknown team"}</b><span>{/\/player-/.test(p.path) ? "Player photo" : /\/team-/.test(p.path) ? "Team logo" : "Opponent logo"} · {ago(p.at)}</span></figcaption>
        <ConfirmButton className="btn sm ghost" confirmText="Take down?" onConfirm={async () => { try { await rpc("admin_remove_picture", { path: p.path }); setPics((x) => (x || []).filter((y) => y.path !== p.path)); toast("Taken down. It's gone from the app and the public pages."); } catch (e: any) { toast(e?.message || "Couldn't take it down."); } }}>Take down</ConfirmButton>
      </figure>)}</div>}
    </Card>
  </div>;
}
