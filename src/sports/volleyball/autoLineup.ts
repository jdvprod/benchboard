/** A sensible first lineup from positions: setter in 1, opposite in 4, outsides in 2 and 5, middles in 3 and 6
 * (each pair across from each other). Missing positions are filled with whoever's left. lu[i] is position i+1. */
export function autoLineup<T extends { id: string; pos: string }>(players: T[]): { lu: string[]; lib: string | null } {
  const lib = players.find((p) => p.pos === "L")?.id || null;
  const pool = players.filter((p) => p.id !== lib);
  const used = new Set<string>();
  const take = (...pos: string[]) => { for (const want of pos) { const p = pool.find((x) => !used.has(x.id) && x.pos === want); if (p) { used.add(p.id); return p.id; } } return null; };
  // slot order of importance: setter, both middles, both outsides, opposite (a second setter in a 6-2)
  const slots: (string | null)[] = [null, null, null, null, null, null];
  slots[0] = take("S");
  slots[2] = take("MB"); slots[5] = take("MB");
  slots[1] = take("OH"); slots[4] = take("OH");
  slots[3] = take("OPP", "S", "OH");
  for (let i = 0; i < 6; i++) if (!slots[i]) { const p = pool.find((x) => !used.has(x.id) && x.pos !== "DS") || pool.find((x) => !used.has(x.id)); if (p) { used.add(p.id); slots[i] = p.id; } }
  return { lu: slots.filter(Boolean) as string[], lib };
}
