/** Messages from college coaching staff about this team's listed players. They come to the team's coaches, never to
 * the player; the coach replies by email and decides what to pass on to the family. Part of college search (paused: see recruit/flags). */
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../../cloud/client";
import { isLinked, roleOn } from "../../cloud/sync";
import { team } from "../../data/store";
import { Card } from "../../ui/kit";
import { when } from "./Announcements";

interface Msg { id: string; player: string; code: string; name: string; school: string; title: string; email: string; body: string; at: string; new: boolean }
const mailto = (m: Msg, teamName: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email || "") ? `mailto:${m.email}?subject=${encodeURIComponent(`${m.player || "Your message"} · ${teamName}`)}` : "";

export function CollegeInterest() {
  const t = team()!, role = roleOn(t.id), ok = cloudAvailable() && !!currentUser() && isLinked(t.id) && (role === "owner" || role === "coach");
  const [list, setList] = useState<Msg[] | null>(null);
  useEffect(() => { if (!ok) return; rpc("college_inbox", { t: t.id }).then((d) => { setList(d || []); if ((d || []).some((m: Msg) => m.new)) rpc("college_inbox_read", { t: t.id }).catch(() => {}); }).catch(() => setList(null)); }, [t.id, ok]);
  if (!ok || !list) return null;
  return <Card title="College interest" actions={list.some((m) => m.new) ? <span className="pill">{list.filter((m) => m.new).length} new</span> : undefined}>
    {!list.length ? <p className="small muted">When a college coach writes about one of your listed players, the message shows up here. It comes to you, not the player.</p>
      : <ul className="ci-list">{list.map((m) => <li key={m.id} className={m.new ? "new" : ""}>
        <p className="ci-who"><b>{m.name}</b>{m.title ? `, ${m.title}` : ""} · {m.school}{m.player ? <> about <b>{m.player}</b></> : null}</p>
        <p className="ci-body">{m.body}</p>
        <p className="small muted">{when(m.at)}{mailto(m, t.name) ? <> · <a href={mailto(m, t.name)}>Reply by email</a></> : null}</p>
      </li>)}</ul>}
    <p className="keys">Only this team's coaches see these. Share with the family what you think they should know.</p>
  </Card>;
}
