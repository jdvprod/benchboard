/** Team announcements: a coach writes a message; everyone following the team on Floorcall Live gets a notification
 * and reads it there. One way on purpose: no replies and no direct messages with players. */
import { isViewer } from "../../app/viewAs";
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, fn, rpc, userMeta } from "../../cloud/client";
import { isLinked, roleOn } from "../../cloud/sync";
import { siteUrl } from "../../cloud/links";
import { team, toast } from "../../data/store";
import { Card, ConfirmButton } from "../../ui/kit";

interface Post { id: string; body: string; by: string; pinned: boolean; at: string; reads: number }
export const when = (iso: string) => { const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days < 1 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : days < 7 ? d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };

export function Announcements() {
  const t = team()!, role = roleOn(t.id), can = !isViewer(t.id) && (role === "owner" || role === "coach");
  const [posts, setPosts] = useState<Post[] | null>(null), [text, setText] = useState(""), [pin, setPin] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ready = cloudAvailable() && !!currentUser() && isLinked(t.id) && !t.sample;
  const load = () => rpc("posts_for_team", { t: t.id }).then((d) => setPosts(d || [])).catch((e) => setErr(e?.message || "Couldn't load announcements."));
  useEffect(() => { if (ready) load(); }, [t.id, ready]);
  if (!ready) return <Card title="Announcements"><p className="small muted">Send a message to every player and parent following the team: practice changes, what to bring, bus times. {t.sample ? "Make your own team to use it." : "Sync this team (Cloud sync, on this page) and share its team page first."}</p></Card>;
  const send = async () => {
    const body = text.trim(); if (!body) return;
    setBusy(true); setErr("");
    try {
      const p: Post = await rpc("post_send", { t: t.id, b: body, pin });
      setPosts([p, ...(posts || [])].sort((a, b) => +b.pinned - +a.pinned || b.at.localeCompare(a.at))); setText(""); setPin(false);
      const r = await fn("notify", { action: "send", team_id: t.id, match_id: p.id, kind: "post", title: `${t.name}: message from ${userMeta().name || "your coach"}`, body: body.slice(0, 200), base: siteUrl("live") }).catch(() => null);
      toast(r && r.sent ? `Sent. ${r.sent} ${r.sent === 1 ? "device" : "devices"} notified.` : "Posted to your team page.");
    } catch (e: any) { setErr(e?.message || "Couldn't send. Check your connection."); }
    setBusy(false);
  };
  const change = async (p: Post, o: { pin?: boolean; del?: boolean }) => {
    try { await rpc("post_update", { pid: p.id, pin: o.pin ?? null, del: !!o.del }); await load(); } catch (e: any) { setErr(e?.message || "Couldn't change it."); }
  };
  return <Card title="Announcements">
    {can ? <div className="ann-new">
      <textarea className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Practice moved to 4:00 tomorrow. Bring both jerseys." aria-label="Announcement" />
      <div className="row between">
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin to the top</label>
        <button className="btn primary sm" disabled={busy || !text.trim()} onClick={send}>{busy ? "Sending…" : "Send to followers"}</button>
      </div>
    </div> : null}
    {err && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{err}</p>}
    {posts && posts.length > 0 && <ul className="ann-list">{posts.map((p) => <li key={p.id} className={p.pinned ? "pin" : ""}>
      <p>{p.body}</p>
      <div className="ann-meta"><span>{p.pinned ? "Pinned · " : ""}{p.by} · {when(p.at)} · read by {p.reads}</span>
        {can && <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => change(p, { pin: !p.pinned })}>{p.pinned ? "Unpin" : "Pin"}</button><ConfirmButton className="btn sm ghost" confirmText="Delete for everyone?" onConfirm={() => change(p, { del: true })}>Delete</ConfirmButton></span>}</div>
    </li>)}</ul>}
    {posts && !posts.length && <p className="small muted">{can ? "Nothing sent yet." : "No announcements yet. Your coaches' messages show up here and on Floorcall Live."}</p>}
    {can && <p className="small muted">Followers get a notification and read it on your team page on Floorcall Live (they need a free account). Messages go one way: nobody can reply here, and there are no private messages with players.</p>}
  </Card>;
}
