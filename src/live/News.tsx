/** Team announcements on FloorCall Live: signed-in followers read what the coach posted. */
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../cloud/client";
import { MiniAuth } from "../cloud/MiniAuth";
import { tr } from "../lib/i18n";

interface Post { id: string; body: string; by: string; pinned: boolean; at: string; new: boolean }
const when = (iso: string) => { const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days < 1 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { weekday: days < 7 ? "short" : undefined, month: "short", day: "numeric" }); };

export function TeamNews({ code, team, full }: { code: string; team: string; full?: boolean }) {
  const [, bump] = useState(0), [posts, setPosts] = useState<Post[] | null>(null), signed = !!currentUser();
  useEffect(() => { if (signed && cloudAvailable()) rpc("posts_by_code", { c: code }).then((d) => setPosts(d || [])).catch(() => setPosts([])); }, [code, signed]);
  if (!cloudAvailable()) return null;
  if (!signed) return full ? <section className="lv-card lv-news"><div className="lv-h"><h2>{tr("Announcements")}</h2></div>
    <p className="lv-note">{tr("Messages from {team}'s coaches are for followers. Sign in or create a free account to read them.", { team })}</p>
    <MiniAuth kind="parent" title={tr("Read team announcements")} onIn={() => bump((x) => x + 1)} t={tr} /></section> : null;
  if (!posts) return full ? <p className="lv-empty">{tr("Loading…")}</p> : null;
  const list = full ? posts : posts.filter((p) => p.pinned || p.new).slice(0, 2);
  if (!list.length) return full ? <section className="lv-card lv-news"><div className="lv-h"><h2>{tr("Announcements")}</h2></div><p className="lv-note">{tr("No announcements from the coaches yet.")}</p></section> : null;
  return <section className="lv-card lv-news">
    <div className="lv-h"><h2>{tr("Announcements")}</h2>{!full && <a href={`#/t/${code}/news`}>{tr("All ›")}</a>}</div>
    <ul>{list.map((p) => <li key={p.id} className={(p.pinned ? "pin " : "") + (p.new ? "new" : "")}>
      <p>{p.body}</p><small>{p.new ? tr("New") + " · " : ""}{p.pinned ? tr("Pinned") + " · " : ""}{p.by} · {when(p.at)}</small>
    </li>)}</ul>
  </section>;
}
