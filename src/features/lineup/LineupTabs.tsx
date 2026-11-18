/** Lineup & rotations and Formations are one tab in the sidebar; this switches between them. */
import { Seg } from "../../ui/kit";
import { go } from "../../app/router";

export function LineupTabs({ here }: { here: "lineup" | "formations" }) {
  return <Seg value={here} onChange={(v) => go(v)} options={[["lineup", "Lineup & rotations"], ["formations", "Formations"]]} label="Lineup section" />;
}
