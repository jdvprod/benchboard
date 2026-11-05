/** Admin console for the people who run Benchboard: sign-ups, active teams, what's live, and a review of every uploaded
 * photo and logo with a one-tap take-down. Only accounts listed in the admins table can open it (the database checks). */
import { useEffect, useState } from "react";
import { Card, ConfirmButton, Kpi } from "../../ui/kit";
import { config, rpc } from "../../cloud/client";
import { toast } from "../../data/store";

interface Overview { users: number; users7: number; teams: number; activeTeams7: number; matches: number; matches7: number; liveNow: number; teamPages: number; gamecasts: number; recruitProfiles: number; notifyPhones: number; errors?: { message: string; count: number; users: number; last: string; version: string; page: string; stack?: string }[];
  recentUsers: { email: string; at: string }[]; teamsList: { id: string; name: string; members: number; matches: number; last: string | null; created: string }[]; at: string }
interface Pic { path: string; at: string; team: string | null }

const ago = (iso?: string | null) => { if (!iso) return "never"; const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** True when the signed-in account is a Benchboard admin (cached for the session). */
let adminCache: Promise<boolean> | null = null;
export const amAdmin = () => (adminCache ||= rpc("is_admin", {}).then((x) => x === true).catch(() => false));

export function AdminPage() {
  const [o, setO] = useState<Overview | null>(null), [pics, setPics] = useState<Pic[] | null>(null), [err, setErr] = useState("");
  const load = async () => {
    try { setO(await rpc("admin_overview", {})); setPics(await rpc("admin_pictures", { lim: 60 })); setErr(""); }
    catch (e: any) { setErr(/admins only/i.test(e?.message || "") ? "This account isn't a Benchboard admin." : e?.message || "Couldn't load the admin console."); }
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
    <div className="grid2" style={{ alignItems: "start" }}>
      <Card title="Most active teams"><div className="tbl"><table><thead><tr><th className="l">Team</th><th>Coaches</th><th>Matches</th><th>Last active</th></tr></thead>
        <tbody>{o.teamsList.map((t) => <tr key={t.id}><td className="l">{t.name || "(no name)"}</td><td>{t.members}</td><td>{t.matches}</td><td>{ago(t.last)}</td></tr>)}</tbody></table></div></Card>
      <Card title="New accounts"><ul className="log">{o.recentUsers.map((u) => <li key={u.email + u.at} style={{ gridTemplateColumns: "1fr auto" }}><span>{u.email}</span><span className="small muted">{ago(u.at)}</span></li>)}</ul></Card>
    </div>
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
