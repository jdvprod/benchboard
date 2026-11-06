/** What families see on their lock screen when a match starts and when it ends. Pure: unit tested. */
export function startMessage(team: string, opp: string, o: { event?: string; court?: string; time?: string } = {}) {
  return { title: `${team} vs ${opp} is starting`, body: [o.event, o.court ? "Court " + o.court : "", "Follow it live on Jumpset Live"].filter(Boolean).join(" · ") };
}
export function finalMessage(team: string, opp: string, wonUs: number, wonThem: number, sets: [number, number][], event?: string, star?: string) {
  const head = wonUs > wonThem ? `${team} beat ${opp} ${wonUs}–${wonThem}` : wonThem > wonUs ? `${opp} beat ${team} ${wonThem}–${wonUs}` : `${team} and ${opp} split ${wonUs}–${wonThem}`;
  return { title: "Final: " + head, body: [sets.map(([a, b]) => `${a}-${b}`).join(", "), star, event, "Box score on Jumpset Live"].filter(Boolean).join(" · ") };
}

/** The match's standout for the final notification: "Maya C. 14 kills" (the most kills, aces or blocks; digs or assists if nothing else). */
export function starLine(lines: { name: string; K: number; SA: number; BLK: number; D: number; AST: number }[]) {
  const best = (k: "K" | "SA" | "BLK" | "D" | "AST", min: number) => lines.filter((l) => l[k] >= min).sort((a, b) => b[k] - a[k])[0];
  const label: Record<string, [string, string]> = { K: ["kill", "kills"], SA: ["ace", "aces"], BLK: ["block", "blocks"], D: ["dig", "digs"], AST: ["assist", "assists"] };
  for (const [k, min] of [["K", 5], ["SA", 3], ["BLK", 3], ["D", 10], ["AST", 15], ["K", 1]] as const) {
    const b = best(k, min); if (b) { const n = +b[k].toFixed(1); return `${b.name} ${n} ${label[k][n === 1 ? 0 : 1]}`; }
  }
  return undefined;
}

/** One player's night for families who follow them: "Maya C.: 14 kills, 8 digs, 2 aces" (their three biggest numbers). */
export function playerLine(name: string, s: { K: number; SA: number; BLK: number; D: number; AST: number }) {
  const parts = ([["K", "kill", "kills"], ["AST", "assist", "assists"], ["D", "dig", "digs"], ["SA", "ace", "aces"], ["BLK", "block", "blocks"]] as const)
    .map(([k, one, many]) => ({ n: +(s as any)[k].toFixed(1), one, many })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  return parts.length ? `${name}: ${parts.map((x) => `${x.n} ${x.n === 1 ? x.one : x.many}`).join(", ")}` : "";
}
