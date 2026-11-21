/** Notes: coaches write a note about a game, a practice or film to the whole team, a position group or one player.
 * Players and parents read the notes meant for them. One way on purpose: no replies, no threads, nothing between
 * players. A note for a player reaches the accounts a coach linked to that player (her own and her parents'). */
import { useEffect, useMemo, useState } from "react";
import { cloudAvailable, CloudError, currentUser, rpc } from "../../cloud/client";
import { isLinked, roleOn } from "../../cloud/sync";
import { isViewer } from "../../app/viewAs";
import { matchesOf, plansOf, setTeamPatch, team, teamPlayers, toast } from "../../data/store";
import type { Player } from "../../data/model";
import { Card, ConfirmButton, Seg } from "../../ui/kit";
import { when } from "../team/Announcements";
import "./notes.css";

export type NoteKind = "game" | "practice" | "film" | "general";
export interface Note { id: string; kind: NoteKind; about: string | null; match_id: string | null; title: string | null; body: string; audience: "team" | "players"; players: string[]; group: string | null; by: string; at: string; edited: string | null; read: boolean; reads: number | null }
const KINDS: [NoteKind, string][] = [["game", "Game"], ["practice", "Practice"], ["film", "Film"], ["general", "General"]];
const KIND_NAME = Object.fromEntries(KINDS) as Record<NoteKind, string>;

/** Position groups a coach sends to in one tap. Pure. */
export const GROUPS: [string, (p: Pick<Player, "pos">) => boolean][] = [
  ["Outsides", (p) => /^(OH|LS|outside)/i.test(p.pos)], ["Middles", (p) => /^(MB|MH|middle)/i.test(p.pos)], ["Opposites", (p) => /^(OPP|RS|RH|opposite|right)/i.test(p.pos)],
  ["Setters", (p) => /^(S|setter)$/i.test(p.pos.trim())], ["Liberos and DS", (p) => /^(L|DS|lib)/i.test(p.pos)],
  ["Hitters", (p) => /^(OH|LS|MB|MH|OPP|RS|RH)/i.test(p.pos)], ["Passers", (p) => /^(OH|LS|L|DS|lib)/i.test(p.pos)],
];
export const groupOf = (players: Pick<Player, "id" | "pos">[], ids: string[]): string | null => {
  const set = new Set(ids);
  for (const [name, f] of GROUPS) { const g = players.filter(f).map((p) => p.id); if (g.length > 1 && g.length === set.size && g.every((x) => set.has(x))) return name; }
  return null;
};
const nameOf = (p?: Player) => (p ? `#${p.num} ${p.first} ${p.last}`.trim() : "a player");
const errText = (e: unknown) => (e instanceof CloudError ? e.message : "Couldn't reach FloorCall. Check your connection.");

export function NotesPage({ to }: { to?: string }) {
  const t = team()!, role = roleOn(t.id), coach = !isViewer(t.id) && (role === "owner" || role === "coach");
  const ready = cloudAvailable() && !!currentUser() && isLinked(t.id) && !t.sample;
  const [notes, setNotes] = useState<Note[] | null>(null), [err, setErr] = useState(""), [edit, setEdit] = useState<Note | null>(null), [filter, setFilter] = useState<"all" | NoteKind>("all");
  const load = () => rpc("team_notes_list", { t: t.id }).then((d: Note[]) => { setNotes(d || []); setErr(""); }).catch((e) => setErr(errText(e)));
  useEffect(() => { if (ready) load(); }, [t.id, ready]);
  // a player or parent reading the page has read what's on it
  useEffect(() => { if (!coach && notes) notes.filter((n) => !n.read).forEach((n) => rpc("note_read", { nid: n.id }).catch(() => {})); }, [notes, coach]);
  const P = teamPlayers(t.id);
  if (!ready) return <div className="page notes"><header className="nt-head"><h1>Notes</h1></header>
    <Card><p className="muted">{coach ? "Write notes to the team, a position group or one player about a game, a practice or what you saw on film. Players and parents read them here; nobody can reply." : "Notes from your coaches show up here."}</p>
      <p className="small muted">{t.sample ? "Make your own team to use notes." : coach ? "Notes need team sync: turn on Cloud sync in Settings, then invite your players and parents (Team → Invite) as view-only members." : "Ask your coach to invite you to the team."}</p></Card></div>;
  const shown = (notes || []).filter((n) => filter === "all" || n.kind === filter);
  return <div className="page notes">
    <header className="nt-head"><h1>Notes</h1><p className="muted">{coach ? "To the team, a group or one player. One way: players and parents read them, nobody replies." : "From your coaches. Notes for you and notes for the whole team."}</p></header>
    <div className={coach ? "nt-grid" : ""}>
      {coach && <div className="stack"><Compose key={edit?.id || to || "new"} players={P} edit={edit} to={to} onDone={() => { setEdit(null); load(); }} />
        <WhoIsWho players={P} /></div>}
      <section className="stack" aria-label="Notes">
        <div className="row between nt-bar"><h2 className="nt-h2">{coach ? "Sent" : "Your notes"} {notes && <small className="muted">{notes.length}</small>}</h2>
          {notes && notes.length > 2 && <Seg value={filter} options={[["all", "All"], ...KINDS]} onChange={setFilter} label="Kind of note" />}</div>
        {err && <p className="hint warn" role="alert">{err}</p>}
        {!notes && !err && <p className="muted">Loading notes…</p>}
        {notes && !shown.length && <p className="empty">{coach ? "Nothing sent yet. Your first note could be what to work on before the next match." : "No notes yet. When your coach writes to you or the team, it shows up here."}</p>}
        <ul className="nt-list">{shown.map((n) => <li key={n.id} className={"nt" + (!coach && !n.read ? " new" : "")}>
          <div className="nt-meta"><span className={"nt-kind k-" + n.kind}>{KIND_NAME[n.kind]}</span>{n.about && <span className="nt-about">{n.about}</span>}{!coach && !n.read && <span className="nt-new">New</span>}</div>
          {n.title && <h3>{n.title}</h3>}
          <p className="nt-body">{n.body}</p>
          <div className="nt-foot"><span>{n.by} · {when(n.at)}{n.edited ? " · edited" : ""}</span>
            <span className="nt-to">{n.audience === "team" ? "To the team" : coach ? `To ${n.group || n.players.map((id) => nameOf(P.find((p) => p.id === id))).join(", ")}` : n.group ? `To ${n.group}` : "To you"}</span>
            {coach && n.reads != null && <span>Read by {n.reads}</span>}
            {coach && <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => { setEdit(n); scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
              <ConfirmButton className="btn sm ghost" confirmText="Delete for everyone?" onConfirm={async () => { try { await rpc("team_note_delete", { t: t.id, nid: n.id }); load(); toast("Note deleted"); } catch (e) { setErr(errText(e)); } }}>Delete</ConfirmButton></span>}
          </div>
        </li>)}</ul>
      </section>
    </div>
  </div>;
}

function Compose({ players, edit, to, onDone }: { players: Player[]; edit: Note | null; to?: string; onDone: () => void }) {
  const t = team()!;
  const games = matchesOf(t.id).filter((m) => m.kind === "match").slice(0, 30), practices = plansOf(t.id).slice(0, 30);
  const [kind, setKind] = useState<NoteKind>(edit?.kind || (to ? "general" : "game"));
  const [about, setAbout] = useState(edit?.about || ""), [mid, setMid] = useState(edit?.match_id || "");
  const [aud, setAud] = useState<"team" | "players">(edit?.audience || (to ? "players" : "team")), [ids, setIds] = useState<string[]>(edit?.players || (to ? [to] : []));
  const [title, setTitle] = useState(edit?.title || ""), [body, setBody] = useState(edit?.body || ""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const group = useMemo(() => groupOf(players, ids), [ids, players]);
  const pickGame = (id: string) => { setMid(id); const m = games.find((x) => x.id === id); setAbout(m ? `vs ${m.opp} · ${new Date(m.date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}` : ""); };
  const pickPractice = (id: string) => { const p = practices.find((x) => x.id === id); setAbout(p ? `${p.title || "Practice"} · ${new Date(p.date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })}` : ""); };
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.concat(id)));
  const send = async () => {
    setBusy(true); setErr("");
    try {
      await rpc("team_note_save", { t: t.id, nid: edit?.id || null, k: kind, ab: about, mid: kind === "game" || kind === "film" ? mid : "", ti: title, bo: body, aud, ps: aud === "players" ? ids : [], grp: aud === "players" ? group : null });
      toast(edit ? "Note updated" : aud === "team" ? "Sent to the team" : `Sent to ${group || (ids.length === 1 ? nameOf(players.find((p) => p.id === ids[0])) : ids.length + " players")}`);
      setBody(""); setTitle(""); onDone();
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const ok = body.trim() && (aud === "team" || ids.length);
  return <Card title={edit ? "Edit note" : "New note"} className="nt-compose" actions={edit ? <button className="btn sm ghost" onClick={onDone}>Cancel</button> : undefined}>
    <div className="stack">
      <div className="field"><span className="label">About</span><Seg value={kind} options={KINDS} onChange={(k) => { setKind(k); setMid(""); setAbout(""); }} label="What the note is about" /></div>
      {(kind === "game" || kind === "film") && games.length > 0 && <label className="field"><span className="label">Which match</span>
        <select className="input" value={mid} onChange={(e) => pickGame(e.target.value)}><option value="">{kind === "film" ? "Not one match (scouting, other film)" : "Pick a match"}</option>{games.map((m) => <option key={m.id} value={m.id}>vs {m.opp} · {m.date}</option>)}</select></label>}
      {kind === "practice" && practices.length > 0 && <label className="field"><span className="label">Which practice</span>
        <select className="input" defaultValue="" onChange={(e) => pickPractice(e.target.value)}><option value="">Pick a practice plan, or type below</option>{practices.map((p) => <option key={p.id} value={p.id}>{p.title || "Practice"} · {p.date}</option>)}</select></label>}
      <label className="field"><span className="label">Label <span className="muted">(optional)</span></span><input className="input" value={about} maxLength={120} onChange={(e) => setAbout(e.target.value)} placeholder={kind === "film" ? "Scouting: Central's outsides" : kind === "practice" ? "Tuesday practice" : "Before the weekend"} /></label>
      <div className="field"><span className="label">To</span>
        <Seg value={aud} options={[["team", "Whole team"], ["players", "Players"]]} onChange={setAud} label="Who the note is for" /></div>
      {aud === "players" && <div className="nt-pick">
        <div className="nt-groups" role="group" aria-label="Position groups">{GROUPS.map(([name, f]) => { const g = players.filter(f).map((p) => p.id); if (g.length < 2) return null; const on = group === name;
          return <button key={name} type="button" aria-pressed={on} onClick={() => setIds(on ? [] : g)}>{name} <small>{g.length}</small></button>; })}</div>
        <ul className="nt-players">{players.map((p) => <li key={p.id}><label><input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} /><b className="num">#{p.num}</b> {p.first} {p.last} <small className="muted">{p.pos}</small></label></li>)}</ul>
        <p className="small muted">{ids.length ? `${ids.length} selected${group ? ` (${group})` : ""}.` : "Pick a group or players."} Each player's note reaches the accounts you link to her below.</p>
      </div>}
      <label className="field"><span className="label">Title <span className="muted">(optional)</span></span><input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Serve receive" /></label>
      <label className="field"><span className="label">Note</span><textarea className="input" rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "film" ? "What we saw on film: their 4 swings line when the set is tight. Block line, dig cross." : "What went well, what to work on, one thing to focus on next time."} /></label>
      {err && <p className="hint warn" role="alert">{err}</p>}
      <div className="row"><button className="btn primary" disabled={busy || !ok} onClick={send}>{busy ? "Sending…" : edit ? "Save changes" : aud === "team" ? "Send to the team" : `Send to ${group || (ids.length === 1 ? players.find((p) => p.id === ids[0])?.first || "player" : ids.length + " players")}`}</button></div>
    </div>
  </Card>;
}

/** Coaches say which account belongs to which player (a player's own account and her parents'). */
function WhoIsWho({ players }: { players: Player[] }) {
  const t = team()!;
  const [rows, setRows] = useState<{ user_id: string; email: string | null; players: string[] }[] | null>(null), [err, setErr] = useState(""), [open, setOpen] = useState(false);
  const load = () => rpc("team_member_links", { t: t.id }).then((r: { user_id: string; email: string | null; players: string[] }[]) => {
    setRows(r);
    // getting started: families are linked once every player and parent account is
    const tm = team(); if (tm && r.length && r.every((x) => x.players.length) && !tm.onboard?.linked) setTeamPatch({ onboard: { ...(tm.onboard || {}), linked: Date.now() } });
  }).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, [t.id]);
  if (!rows) return null;
  const unlinked = rows.filter((r) => !r.players.length).length;
  const link = async (u: string, ps: string[]) => { try { await rpc("team_link_member", { t: t.id, u, ps }); await load(); } catch (e) { setErr(errText(e)); } };
  return <Card title="Who's who" className="nt-who" actions={rows.length ? <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Done" : unlinked ? `Link ${unlinked}` : "Change"}</button> : undefined}>
    {!rows.length ? <p className="small muted">Invite players and parents (Team → Invite, view-only). Then link each account to a player here, so notes for that player reach them.</p>
      : <p className="small muted">{unlinked ? `${unlinked} of ${rows.length} player and parent accounts aren't linked to a player yet. They still read team notes.` : `All ${rows.length} player and parent accounts are linked.`}</p>}
    {open && <ul className="nt-links">{rows.map((r) => <li key={r.user_id}><span className="nt-email">{r.email || "Account"}</span>
      <select className="input" aria-label={"Player for " + (r.email || "account")} value={r.players[0] || ""} onChange={(e) => link(r.user_id, e.target.value ? [e.target.value, ...r.players.slice(1).filter((x) => x !== e.target.value)] : r.players.slice(1))}>
        <option value="">Not linked</option>{players.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}</select>
      {r.players.length > 0 && <select className="input" aria-label={"Second player for " + (r.email || "account")} value={r.players[1] || ""} onChange={(e) => link(r.user_id, [r.players[0], ...(e.target.value ? [e.target.value] : [])])}>
        <option value="">No second player</option>{players.filter((p) => p.id !== r.players[0]).map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}</select>}
    </li>)}</ul>}
    {err && <p className="hint warn" role="alert">{err}</p>}
  </Card>;
}
