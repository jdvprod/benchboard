/** A short text recap of a match for the team group chat or social post: result, set scores, three standouts, the link. */
import { Match } from "../../data/model";
import { player, team } from "../../data/store";
import { aggregate, Replay } from "../../sports/volleyball/engine";
import { blocks } from "../../sports/volleyball/metrics";

export function recapText(m: Match, R: Replay, link = ""): string {
  const t = team()!, A = aggregate(R.sets), sets = R.sets.filter((s) => s.us + s.them > 0).map((s) => `${s.us}-${s.them}`).join(", ");
  const res = R.wonUs > R.wonThem ? `${t.name} def. ${m.opp} ${R.wonUs}–${R.wonThem}` : R.wonThem > R.wonUs ? `${m.opp} def. ${t.name} ${R.wonThem}–${R.wonUs}` : `${t.name} and ${m.opp} split ${R.wonUs}–${R.wonThem}`;
  const ok = (id: string) => { const p = player(id); return p && !p.hidePublic && p.first ? p : null; };
  const used = new Set<string>(), lines: string[] = [];
  for (const [f, one, many, min] of [[(s: any) => s.K, "kill", "kills", 3], [(s: any) => s.AST, "assist", "assists", 8], [(s: any) => s.D, "dig", "digs", 6], [(s: any) => s.SA, "ace", "aces", 2], [(s: any) => blocks(s), "block", "blocks", 2]] as const) {
    if (lines.length >= 3) break;
    const top = Object.entries(A.ps).filter(([id]) => ok(id) && !used.has(id)).map(([id, s]) => [id, +f(s).toFixed(1)] as [string, number]).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= min) { const p = ok(top[0])!; used.add(top[0]); lines.push(`${p.first} ${p.last}`.trim() + ` ${top[1]} ${top[1] === 1 ? one : many}`); }
  }
  return [`${R.matchOver || m.status === "done" ? "Final" : "In progress"}: ${res}${sets ? ` (${sets})` : ""}${m.event ? ` · ${m.event}` : ""}`, lines.join(" · "), link ? `Box score: ${link}` : ""].filter(Boolean).join("\n");
}
