import { recordOf } from "../../sports/volleyball/engine";
import type { Replay } from "../../sports/volleyball/engine";
import { useState } from "react";
import { parseRosterLine } from "./parseRoster";
import { LEGAL, LEGAL_VERSION } from "../../app/legal";
import { currentUser } from "../../cloud/client";
import { all, deleteMatch, deleteTeam, get, matchesOf, patch, player, remove, replayOf, save, seasonsOf, setTeamPatch, team, teamPlayers, toast, uid, opponentsOf, defaultSeasonName, oppKey } from "../../data/store";
import { Player } from "../../data/model";
import { POSITIONS } from "../../sports/volleyball/actions";
import { Card, ConfirmButton, download, fmtDate } from "../../ui/kit";
import { exportAll, importBackup } from "../../data/backup";
import { TEAM_COLORS } from "../../app/theme";
import { NewTeamForm } from "./Welcome";
import { go } from "../../app/router";
import { setUi } from "../../app/ui";
import { AiCard } from "../../ui/ai";
import { scoutPrompt } from "../../ai/prompts";
import { CloudCard } from "../../cloud/CloudCard";
import { isLinked } from "../../cloud/sync";

export function TeamPage({ sub }: { sub?: string }) {
  if (sub === "new") return <div className="page"><Card title="Add a team"><NewTeamForm /></Card></div>;
  return <div className="page">
    <div className="pagehead"><h1>{team()!.name}</h1></div>
    <div className="stack">
      <Roster />
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="stack"><TeamInfo /><History /></div>
        <div className="stack"><CloudCard /><Opponents /><Backup /></div>
      </div>
    </div>
  </div>;
}

function TeamInfo() {
  const t = team()!, seasons = seasonsOf();
  const [newSeason, setNewSeason] = useState("");
  return <Card title="Team">
    <div className="stack">
      <div className="two">
        <label className="field"><span className="label">Team name</span><input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && setTeamPatch({ name: e.target.value.trim() })} /></label>
        <label className="field"><span className="label">Level</span><input defaultValue={t.level} onBlur={(e) => setTeamPatch({ level: e.target.value.trim() })} /></label>
      </div>
      <div><div className="label">Season</div>
        <div className="row" style={{ marginTop: 6 }}>
          <select className="input" style={{ width: "auto" }} value={t.activeSeasonId || ""} onChange={(e) => setTeamPatch({ activeSeasonId: e.target.value })}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input className="input" style={{ width: 150 }} placeholder={defaultSeasonName()} value={newSeason} onChange={(e) => setNewSeason(e.target.value)} />
          <button className="btn sm" onClick={() => { const s = { id: uid("s"), teamId: t.id, name: newSeason.trim() || defaultSeasonName(), createdAt: Date.now() }; save("seasons", s, true); setTeamPatch({ activeSeasonId: s.id }); setNewSeason("");
            const now = new Date(), lastClass = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
            const grads = all("players").filter((p) => p.teamId === t.id && p.active && p.grad && p.grad <= lastClass);
            if (grads.length) toast(`New season started. ${grads.length} ${grads.length === 1 ? "player has" : "players have"} graduated.`, { label: "Move off roster", fn: () => { grads.forEach((p) => patch("players", p.id, { active: false })); toast(`${grads.length} graduated ${grads.length === 1 ? "player" : "players"} moved off the roster (their stats stay)`); } });
            else toast("New season started"); }}>Start new season</button>
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>New matches go into the active season. Stats can show one season or all of them.</p>
      </div>
      {t.sample && <div className="banner warn"><p>This is the sample team. Delete it when you're done exploring.</p><ConfirmButton onConfirm={() => { deleteTeam(t.id); toast("Sample team deleted"); go("track"); }}>Delete sample team</ConfirmButton></div>}
    </div>
  </Card>;
}

function Roster() {
  const t = team()!, ps = teamPlayers();
  const [showInactive, setShowInactive] = useState(false), [paste, setPaste] = useState<string | null>(null);
  const add = () => { const p: Player = { id: uid("p"), teamId: t.id, num: "", first: "", last: "", pos: "OH", grad: null, height: "", active: true, goals: [], notes: "" }; save("players", p); setTimeout(() => document.getElementById("num-" + p.id)?.focus(), 30); };
  const upd = (id: string, k: keyof Player, v: any) => patch("players", id, { [k]: v } as any);
  const shown = ps.filter((p) => showInactive || p.active);
  return <Card title={`Roster · ${ps.filter((p) => p.active).length} players`} actions={<><label className="btn sm" style={{ cursor: "pointer" }}>Import CSV<input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((txt) => toast(importRosterCsv(txt))); e.target.value = ""; }} /></label><button className="btn sm" disabled={!ps.length} onClick={() => download(`${t.name} roster.csv`, rosterCsv(), "text/csv")}>Export CSV</button><button className="btn sm" onClick={() => setPaste(paste == null ? "" : null)}>Paste list</button><button className={"btn sm" + (ps.length ? " primary" : "")} onClick={add}>Add player</button></>}>
    {!t.sample && ps.length > 0 && !t.rosterConsent && <div className="banner accent" style={{ marginBottom: 12 }}>
      <p><b>Permission to record players.</b> Before tracking, make sure your school or club allows it and families have agreed, especially for players under 18. Our <a href={LEGAL.consent + "#team=" + encodeURIComponent(t.name)} target="_blank" rel="noopener">parent and guardian form</a> covers stats, team pages and recruiting profiles.</p>
      <button className="btn sm primary" onClick={() => { setTeamPatch({ rosterConsent: { at: Date.now(), by: currentUser()?.email || "this device", version: LEGAL_VERSION } }); toast("Thanks. You can find the parent form any time in Settings."); }}>I have permission</button>
    </div>}
    {paste != null && <div className="stack" style={{ marginBottom: 12 }}>
      <label className="field"><span className="label">One player per line: number, name, position, then grad year or class (Fr, So, Jr, Sr) and height if you have them</span>
        <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"7 Maya Chen OH 2027\n12 Sofia Nguyen MB 5'11\" Jr.\n#1 Ava Ramirez setter"} autoFocus /></label>
      <div className="row"><button className="btn sm primary" disabled={!paste.trim()} onClick={() => { toast(addPasted(paste)); setPaste(null); }}>Add players</button><button className="btn sm" onClick={() => setPaste(null)}>Cancel</button></div>
    </div>}
    {!ps.length && paste == null && <div className="empty-roster">
      <p style={{ margin: 0 }}><b>Add your roster to start tracking.</b> The fastest way: copy it from a spreadsheet, email or MaxPreps and paste it in, one player per line.</p>
      <div className="row"><button className="btn sm primary" onClick={() => setPaste("")}>Paste a roster</button><button className="btn sm" onClick={add}>Add one player</button></div>
    </div>}
    {shown.length > 0 && <div className="tbl roster-tbl"><table>
      <thead><tr><th className="l">#</th><th className="l">First</th><th className="l">Last</th><th className="l">Pos</th><th className="l">Grad</th><th className="l">Height</th><th /></tr></thead>
      <tbody>{shown.map((p) => <tr key={[p.id, p.num, p.first, p.last, p.grad, p.height].join("|")} style={p.active ? undefined : { opacity: 0.55 }}>
        <td className="l"><input id={"num-" + p.id} className="input" style={{ width: 56 }} inputMode="numeric" defaultValue={p.num} onBlur={(e) => upd(p.id, "num", e.target.value.trim())} aria-label="Jersey number" /></td>
        <td className="l"><input className="input" style={{ minWidth: 90 }} placeholder="First" defaultValue={p.first} onBlur={(e) => upd(p.id, "first", e.target.value.trim())} aria-label="First name" /></td>
        <td className="l"><input className="input" style={{ minWidth: 90 }} placeholder="Last" defaultValue={p.last} onBlur={(e) => upd(p.id, "last", e.target.value.trim())} aria-label="Last name" /></td>
        <td className="l"><select className="input" style={{ width: 78 }} value={p.pos} onChange={(e) => upd(p.id, "pos", e.target.value)} aria-label="Position">{POSITIONS.map((x) => <option key={x}>{x}</option>)}</select></td>
        <td className="l"><input className="input" style={{ width: 72 }} inputMode="numeric" defaultValue={p.grad ?? ""} onBlur={(e) => upd(p.id, "grad", e.target.value ? +e.target.value : null)} aria-label="Graduation year" placeholder="Grad" /></td>
        <td className="l"><input className="input" style={{ width: 66 }} defaultValue={p.height} onBlur={(e) => upd(p.id, "height", e.target.value.trim())} aria-label="Height" placeholder={`5'9"`} /></td>
        <td><div className="row" style={{ flexWrap: "nowrap" }}><button className="btn sm" onClick={() => go("player", p.id)}>View</button>{p.active ? <button className="btn sm ghost" onClick={() => upd(p.id, "active", false)} title="Hide from the roster; stats are kept">Remove</button> : <button className="btn sm" onClick={() => upd(p.id, "active", true)}>Restore</button>}</div></td>
      </tr>)}</tbody></table></div>}
    {ps.some((p) => !p.active) && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setShowInactive(!showInactive)}>{showInactive ? "Hide removed players" : "Show removed players"}</button>}
  </Card>;
}

function History() {
  const t = team()!, ms = matchesOf(), seasons = seasonsOf();
  const [season, setSeason] = useState<string>(t.activeSeasonId || "all");
  const list = ms.filter((m) => season === "all" || m.seasonId === season);
  return <Card title="Matches & practices" actions={<select className="input" style={{ width: "auto" }} value={season} onChange={(e) => setSeason(e.target.value)}><option value="all">All seasons</option>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}>
    {!list.length && <p className="empty">Nothing recorded yet.</p>}
    <ul className="log">{list.map((m) => {
      const R = replayOf(m), live = t.currentMatchId === m.id;
      const res = R && m.kind !== "drills" ? `${R.wonUs}–${R.wonThem}` : "";
      return <li key={m.id} style={{ gridTemplateColumns: "1fr auto" }}>
        <span><b>{m.kind === "match" ? "vs " + m.opp : m.opp}</b>{live && <span className="tag good">Live</span>}{m.kind !== "match" && <span className="tag">{m.kind === "scrimmage" ? "Scrimmage" : "Practice"}</span>}<br />
          <span className="small muted">{fmtDate(m.date)}{m.site ? " · " + m.site : ""}{m.event ? " · " + m.event : ""}{R ? " · " + R.sets.map((s) => s.us + "-" + s.them).join(", ") : ""}</span></span>
        <span className="row" style={{ flexWrap: "nowrap" }}>
          {res && <b className={"num " + (R!.wonUs > R!.wonThem ? "us" : R!.wonThem > R!.wonUs ? "them" : "")} style={{ color: R!.wonUs > R!.wonThem ? "var(--us)" : R!.wonThem > R!.wonUs ? "var(--them)" : undefined }}>{res}</b>}
          <button className="btn sm" onClick={() => { setUi({ statsScope: "m:" + m.id }); go("stats"); }}>Stats</button>
          {!live && <button className="btn sm ghost" onClick={() => { setTeamPatch({ currentMatchId: m.id }); patch("matches", m.id, { status: "live" }); go(m.kind === "match" ? "track" : "practice"); }}>Reopen</button>}
          <ConfirmButton className="btn sm ghost" confirmText="Delete?" onConfirm={() => { deleteMatch(m.id); toast("Deleted"); }}>✕</ConfirmButton>
        </span>
      </li>;
    })}</ul>
  </Card>;
}

function Opponents() {
  const opps = opponentsOf();
  const [sel, setSel] = useState<string>(opps[0]?.id || "");
  const [name, setName] = useState("");
  const o = get("opponents", sel) || opps[0];
  const played = o ? matchesOf().filter((m) => m.kind === "match" && oppKey(m.opp) === oppKey(o.name)) : [];
  const recO = recordOf(played.map((m) => replayOf(m)).filter(Boolean) as Replay[]), rec = [recO.w, recO.l];
  return <div className="stack">
    <Card title="Opponents & scouting">
      <div className="stack">
        <div className="row">
          <select className="input grow" style={{ width: "auto", flexBasis: 160 }} value={o?.id || ""} onChange={(e) => setSel(e.target.value)}>{opps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}{!opps.length && <option>No opponents yet</option>}</select>
          <input className="input" style={{ width: 150 }} placeholder="Add opponent" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn sm" disabled={!name.trim()} onClick={() => { const n = { id: uid("o"), teamId: team()!.id, name: name.trim(), notes: "", scout: "", scoutAt: null }; save("opponents", n); setSel(n.id); setName(""); }}>Add</button>
        </div>
        {o && <>
          <p className="small muted">{played.length ? `Played ${played.length}${rec[0] + rec[1] ? ` · record ${rec[0]}–${rec[1]}` : ""}` : "No matches recorded against them yet."}</p>
          <label className="field"><span className="label">Notes on {o.name} (kept for every match against them)</span><textarea rows={4} key={o.id} defaultValue={o.notes} placeholder="Best hitters, setter tendencies, serve targets, what worked last time…" onBlur={(e) => patch("opponents", o.id, { notes: e.target.value })} /></label>
          <div className="row"><button className="btn sm primary" onClick={() => go("matchup", o.id)}>Open matchup</button><button className="btn sm" onClick={() => { setUi({ courtTab: "tendency" }); go("court", o.id); }}>Their tendencies on the court</button><ConfirmButton className="btn sm ghost" onConfirm={() => { remove("opponents", o.id); setSel(""); }}>Delete opponent</ConfirmButton></div>
        </>}
      </div>
    </Card>
    {o && <AiCard key={o.id} title={`Scouting report: ${o.name}`} desc="Built from every match you've recorded against them plus your notes. Saved for next time." button="Write scouting report" prompt={() => scoutPrompt(o.name)} saved={o.scout} savedAt={o.scoutAt} onSave={(text) => patch("opponents", o.id, { scout: text, scoutAt: Date.now() })} filename={o.name + " scouting report"} />}
  </div>;
}

function Backup() {
  const [msg, setMsg] = useState("");
  const onFile = (f?: File | null) => { if (!f) return; const r = new FileReader(); r.onload = () => setMsg(importBackup(String(r.result || "")).message); r.readAsText(f); };
  const t = team()!;
  return <Card title="Backup & restore">
    <div className="stack">
      <p className="small">Everything is saved on this device. Save a backup to move it to another device or keep a copy. Restoring skips anything you already have. Backups from the first version of Benchboard import as a new team.</p>
      <div className="row">
        <button className="btn sm" onClick={() => { download(`Benchboard ${t.name} ${new Date().toISOString().slice(0, 10)}.json`, exportAll(t.id), "application/json"); toast("Backup saved"); }}>Save this team</button>
        <button className="btn sm" onClick={() => { download(`Benchboard all teams ${new Date().toISOString().slice(0, 10)}.json`, exportAll(), "application/json"); toast("Backup saved"); }}>Save all teams</button>
        <label className="btn sm" style={{ cursor: "pointer" }}>Restore a backup<input type="file" accept=".json,application/json" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      {msg && <p className="hint">{msg}</p>}
      {!t.sample && <div className="row" style={{ marginTop: 6 }}><ConfirmButton className="btn sm ghost" confirmText={isLinked(t.id) ? "Remove from this device? It stays in the cloud." : "Delete this team and all its data?"} onConfirm={() => { deleteTeam(t.id); toast(isLinked(t.id) ? "Removed from this device" : "Team deleted"); go("track"); }}>{isLinked(t.id) ? "Remove from this device" : "Delete team"}</ConfirmButton></div>}
    </div>
  </Card>;
}

export { player };

/* ---------- roster CSV ---------- */
const csvCell = (v: unknown) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
function rosterCsv() {
  const rows = [["number", "first", "last", "position", "grad_year", "height", "active"], ...teamPlayers().map((p) => [p.num, p.first, p.last, p.pos, p.grad ?? "", p.height, p.active ? "yes" : "no"])];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}
/** Columns are matched by header name, so exports from other apps work: number/#, first, last (or name), position/pos, grad/class/year, height. */
function importRosterCsv(text: string): string {
  const rows = parseCsv(text.replace(/^\uFEFF/, "")); if (rows.length < 2) return "That file has no players.";
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.some((n) => x === n || x.includes(n)));
  const cNum = col("number", "#", "jersey", "no"), cFirst = col("first"), cLast = col("last"), cName = col("name", "player"), cPos = col("position", "pos"), cGrad = col("grad", "class", "year"), cH = col("height", "ht");
  if (cNum < 0 && cName < 0 && cFirst < 0) return "Couldn't find number or name columns. Use headers like number, first, last, position.";
  const t = team()!, existing = teamPlayers(); let added = 0, updated = 0;
  for (const r of rows.slice(1)) {
    const g = (i: number) => (i >= 0 ? (r[i] || "").trim() : "");
    let first = g(cFirst), last = g(cLast);
    if (!first && !last && cName >= 0) { const parts = g(cName).split(/\s+/); first = parts.shift() || ""; last = parts.join(" "); }
    const num = g(cNum).replace(/^#/, ""); if (!num && !first && !last) continue;
    const posRaw = g(cPos).toUpperCase(), pos = (POSITIONS as readonly string[]).includes(posRaw) ? posRaw : posRaw.startsWith("LIB") ? "L" : posRaw.startsWith("SET") ? "S" : posRaw.startsWith("MID") ? "MB" : posRaw.startsWith("OUT") ? "OH" : posRaw.startsWith("RIGHT") || posRaw.startsWith("OPP") ? "OPP" : posRaw ? "DS" : "OH";
    const gradN = parseInt(g(cGrad)), grad = isFinite(gradN) && gradN > 1990 ? gradN : null;
    const match = existing.find((p) => (num && p.num === num) || (!num && p.first === first && p.last === last));
    if (match) { patch("players", match.id, { first: first || match.first, last: last || match.last, pos: g(cPos) ? pos : match.pos, grad: grad ?? match.grad, height: g(cH) || match.height, active: true }); updated++; }
    else { save("players", { id: uid("p"), teamId: t.id, num, first, last, pos, grad, height: g(cH), active: true, goals: [], notes: "" } as Player); added++; }
  }
  return `Roster imported: ${added} added, ${updated} updated.`;
}

/** "7 Maya Chen OH 2027" per line. Updates players with the same number. */
function addPasted(text: string): string {
  const t = team()!, existing = teamPlayers(); let added = 0, updated = 0;
  for (const line of text.split(/\r?\n/)) {
    const r = parseRosterLine(line); if (!r) continue;
    const match = existing.find((p) => r.num && p.num === r.num);
    if (match) { patch("players", match.id, { first: r.first || match.first, last: r.last || match.last, pos: r.pos || match.pos, grad: r.grad ?? match.grad, height: r.height || match.height, active: true }); updated++; }
    else { save("players", { id: uid("p"), teamId: t.id, num: r.num, first: r.first, last: r.last, pos: r.pos || "OH", grad: r.grad, height: r.height, active: true, goals: [], notes: "" } as Player); added++; }
  }
  return `${added} added${updated ? `, ${updated} updated` : ""}.`;
}
