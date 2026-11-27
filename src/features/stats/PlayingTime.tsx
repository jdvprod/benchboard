/** Playing time (coaches only): who played how much, from the lineups and subs you tracked. */
import { useMemo } from "react";
import { playerName, teamPlayers } from "../../data/store";
import { playTime } from "../../sports/volleyball/playtime";
import { Card } from "../../ui/kit";
import { Scope } from "./scope";

const pct = (x: number) => Math.round(x * 100) + "%";

export function PlayingTime({ S }: { S: Scope }) {
  const R = useMemo(() => {
    const ids = new Set(teamPlayers().filter((p) => p.active).map((p) => p.id));
    for (const s of S.sets) for (const r of s.rallies) r.onCourt.forEach((id) => ids.add(id));
    return playTime(S.sets, [...ids]);
  }, [S.key, S.sets.length]);
  const missing = R.sets - R.withLineup;
  return <Card title="Playing time">
    <p className="small muted" style={{ marginTop: 0 }}>Only coaches see this. It counts every rally each player was on the court, from the lineups and subs you tracked. Handy for playing-time conversations after the weekend.</p>
    {!R.withLineup ? <p className="empty">{R.sets ? "These sets were tracked without a lineup, so there's no playing time to count. Set the starting lineup (and subs) when you track." : "No sets tracked yet."}</p> : <>
      <div className="tbl"><table className="pt-t">
        <thead><tr><th className="l">Player</th><th>Sets</th><th title="Sets started">Started</th><th>Rallies</th><th title="Share of the team's rallies">Share</th><th title="Points won minus lost while on the court">+/−</th></tr></thead>
        <tbody>{R.rows.map((r) => <tr key={r.id} className={r.rallies ? "" : "muted"}><td className="l">{playerName(r.id)}</td><td>{r.sets}</td><td>{r.started}</td><td>{r.rallies}</td>
          <td><span className="pt-bar" aria-hidden="true"><i style={{ width: pct(r.share) }} /></span>{pct(r.share)}</td><td>{r.rallies ? (r.won - r.lost > 0 ? "+" : "") + (r.won - r.lost) : "—"}</td></tr>)}</tbody>
      </table></div>
      <p className="keys">{R.rallies} rallies in {R.withLineup} {R.withLineup === 1 ? "set" : "sets"}.{missing > 0 ? ` ${missing} ${missing === 1 ? "set was" : "sets were"} tracked without a lineup and aren't counted.` : ""} A libero counts for the rallies they were in.</p>
    </>}
  </Card>;
}
