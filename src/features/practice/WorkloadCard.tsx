/** Workload (coaches only): who's had a much bigger week than usual, or no day off, from practices and matches. */
import { useMemo, useState } from "react";
import { activePlayers, matchesOf, playerName, plansOf, replayOf, todayISO } from "../../data/store";
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

export function WorkloadCard() {
  const { rows, any } = useWorkload(), [all, setAll] = useState(false);
  if (!any) return null;
  const flagged = rows.filter((r) => r.flag), shown = all ? rows : flagged;
  return <Card title="Workload this week">
    <p className="small muted" style={{ marginTop: 0 }}>{flagged.length ? `${flagged.length} ${flagged.length === 1 ? "player has" : "players have"} a much bigger week than usual, or no day off. Consider a lighter day.` : "Everyone is close to their usual week."}</p>
    {shown.length > 0 && <div className="tbl"><table className="wl-t">
      <thead><tr><th className="l">Player</th><th title="Minutes in the last 7 days">This week</th><th title="Average week over the 4 weeks before">Usual</th><th>Days in a row</th><th className="l">Note</th></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.id} className={r.flag ? "wl-flag" : ""}><td className="l">{playerName(r.id)}</td><td>{r.week} min</td><td>{r.avg != null ? r.avg + " min" : "—"}</td><td>{r.streak || "—"}</td>
        <td className="l">{r.flag === "spike" ? `${r.ratio!.toFixed(1)}× a usual week` : r.flag === "streak" ? "No day off in a week" : r.avg == null ? "Not enough history yet" : ""}</td></tr>)}</tbody>
    </table></div>}
    <button className="linkish small" onClick={() => setAll(!all)}>{all ? "Show only flagged players" : "Show every player"}</button>
    <p className="keys">Minutes come from practices (each block's minutes, for players marked in or late) and tracked matches (about 30 seconds per rally on the court). Flagged at {SPIKE}× the four weeks before, or seven days straight. High school and other teams aren't counted. Research on young athletes links sudden jumps in weekly load to overuse injuries; this isn't medical advice.</p>
  </Card>;
}
