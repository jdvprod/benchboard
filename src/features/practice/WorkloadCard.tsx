/** Workload (coaches only): who's had a much bigger week than usual, or no day off, from practices and matches. */
import { useMemo, useState } from "react";
import { activePlayers, matchesOf, playerName, plansOf, replayOf, setSettings, team, todayISO } from "../../data/store";
import { LoadEntry, MIN_PER_RALLY, SPIKE, workload } from "../../sports/volleyball/load";
import { playTime } from "../../sports/volleyball/playtime";
import { Card } from "../../ui/kit";

export function useWorkload() {
  return useMemo(() => {
    const today = todayISO(), ps = activePlayers(), ids = ps.map((p) => p.id), e: LoadEntry[] = [];
    for (const p of plansOf()) {
      if (p.date > today) continue;
      const min = p.blocks.reduce((s, b) => s + (b.minutes || 0), 0); if (!min) continue;
      const a = p.attendance;
      const who = a && Object.keys(a).length ? ids.filter((id) => a[id] === "in" || a[id] === "late") : p.status === "done" ? ids : [];
      for (const id of who) e.push({ date: p.date, id, min });
    }
    for (const m of matchesOf()) {
      if (m.date > today) continue;
      const R = replayOf(m); if (!R) continue;
      for (const r of playTime(R.sets, ids).rows) if (r.rallies) e.push({ date: m.date, id: r.id, min: r.rallies * MIN_PER_RALLY });
    }
    return { rows: workload(e, ids, today), any: e.length > 0 };
  }, [plansOf().length, matchesOf().length]);
}

/** The Monday of the week a date falls in. */
export const weekOf = (iso: string) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

export function WorkloadCard() {
  const { rows, any } = useWorkload(), [all, setAll] = useState(false), t = team();
  if (!any || !t || t.settings.noWorkload) return null;
  const wk = weekOf(todayISO()), hard = (t.settings.hardWeeks || []).includes(wk);
  const toggleHard = () => setSettings({ hardWeeks: hard ? (t.settings.hardWeeks || []).filter((x) => x !== wk) : [...(t.settings.hardWeeks || []).filter((x) => x >= weekOf(todayISO().slice(0, 4) + "-01-01")), wk] });
  const flagged = rows.filter((r) => r.flag), shown = all ? rows : flagged;
  return <Card title="Workload this week">
    {hard ? <p className="wl-hard"><b>Hard week on purpose.</b> Conditioning and toughness are the point this week, so big weeks are expected. Players far above their usual still show below, so you know who to keep an eye on.</p>
      : <p className="small muted" style={{ marginTop: 0 }}>{flagged.length ? `${flagged.length} ${flagged.length === 1 ? "player is" : "players are"} well above their usual week, or haven't had a day off. Your call what to do with it.` : "Everyone is close to their usual week."}</p>}
    {shown.length > 0 && <div className="tbl"><table className="wl-t">
      <thead><tr><th className="l">Player</th><th title="Minutes in the last 7 days">This week</th><th title="Average week over the 4 weeks before">Usual</th><th>Days in a row</th><th className="l">Note</th></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.id} className={r.flag && !hard ? "wl-flag" : r.flag ? "wl-planned" : ""}><td className="l">{playerName(r.id)}</td><td>{r.week} min</td><td>{r.avg != null ? r.avg + " min" : "—"}</td><td>{r.streak || "—"}</td>
        <td className="l">{r.flag === "spike" ? `${r.ratio!.toFixed(1)}× a usual week${hard ? " (planned)" : ""}` : r.flag === "streak" ? "No day off in a week" : r.avg == null ? "Not enough history yet" : ""}</td></tr>)}</tbody>
    </table></div>}
    <div className="row" style={{ gap: 14 }}>
      <button className="linkish small" onClick={() => setAll(!all)}>{all ? "Show only flagged players" : "Show every player"}</button>
      <button className="linkish small" aria-pressed={hard} onClick={toggleHard}>{hard ? "Not a hard week after all" : "Hard week on purpose"}</button>
      <button className="linkish small" onClick={() => setSettings({ noWorkload: true })}>Hide this card</button>
    </div>
    <p className="keys">Minutes come from practices (each block's minutes, for players marked in or late) and tracked matches (about 30 seconds per rally on the court). Flagged at {SPIKE}× the four weeks before, or seven days straight. High school and other teams aren't counted. Research on young athletes links sudden, unplanned jumps in weekly load with overuse injuries, while steady hard work builds the fitness that protects them. This is information, not medical advice. You can bring the card back in Settings.</p>
  </Card>;
}
