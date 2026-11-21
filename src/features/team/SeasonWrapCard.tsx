/** Team tab → Season wrap-up: a note from the coach for each player, then one printable (or PDF) booklet with the
 * team's season and a page per player. */
import { useState } from "react";
import { matchesOf, replayOf, seasonsOf, setTeamPatch, team, teamPlayers } from "../../data/store";
import { Card, download } from "../../ui/kit";
import { printHtml } from "../../ui/print";
import { Game, wrapHtml } from "./seasonWrap";

export function SeasonWrapCard() {
  const t = team()!, se = seasonsOf().find((x) => x.id === t.activeSeasonId), sid = t.activeSeasonId || "all";
  const [open, setOpen] = useState(false);
  const games: Game[] = matchesOf().filter((m) => m.kind === "match" && !m.imported?.season && (!t.activeSeasonId || m.seasonId === t.activeSeasonId)).reverse()
    .map((m) => ({ m, R: replayOf(m)! })).filter((g) => g.R && g.R.sets.some((s) => s.us + s.them > 0));
  if (games.length < 2) return null;
  const players = teamPlayers().filter((p) => p.active);
  const notes = t.wrapNotes?.[sid] || {};
  const setNote = (id: string, v: string) => setTeamPatch({ wrapNotes: { ...(t.wrapNotes || {}), [sid]: { ...notes, [id]: v } } });
  const html = () => wrapHtml(t, se?.name || "Season", games, players, t.wrapNotes?.[sid] || {});
  const file = `${t.name} ${se?.name || "season"} wrap-up.html`.replace(/[^\w\- .]+/g, "");
  return <Card title="Season wrap-up" actions={<div className="row"><button className="btn sm primary" onClick={() => printHtml(html())}>Print or save PDF</button><button className="btn sm" onClick={() => download(file, html(), "text/html")}>Download</button></div>}>
    <p className="small muted">A booklet for the end of the season: the team's record and matches, then a page for each player with their numbers, best match and biggest improvement. Add a short note for each player first; families love these.</p>
    {!open ? <button className="btn sm" onClick={() => setOpen(true)}>Write player notes ({Object.values(notes).filter((x) => x.trim()).length} of {players.length})</button>
      : <ul className="wrap-notes">{players.map((p) => <li key={p.id}><label className="field"><span className="label">#{p.num} {p.first} {p.last}</span>
        <textarea rows={2} defaultValue={notes[p.id] || ""} maxLength={600} placeholder="What they did well this season, and one thing to work on in the off-season" onBlur={(e) => setNote(p.id, e.target.value)} /></label></li>)}</ul>}
  </Card>;
}
