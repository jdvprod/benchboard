/** What families see on their lock screen when a match starts and when it ends. Pure: unit tested. */
export function startMessage(team: string, opp: string, o: { event?: string; court?: string; time?: string } = {}) {
  return { title: `${team} vs ${opp} is starting`, body: [o.event, o.court ? "Court " + o.court : "", "Follow it live on Benchboard Live"].filter(Boolean).join(" · ") };
}
export function finalMessage(team: string, opp: string, wonUs: number, wonThem: number, sets: [number, number][], event?: string) {
  const head = wonUs > wonThem ? `${team} beat ${opp} ${wonUs}–${wonThem}` : wonThem > wonUs ? `${opp} beat ${team} ${wonThem}–${wonUs}` : `${team} and ${opp} split ${wonUs}–${wonThem}`;
  return { title: "Final: " + head, body: [sets.map(([a, b]) => `${a}-${b}`).join(", "), event, "Box score on Benchboard Live"].filter(Boolean).join(" · ") };
}
