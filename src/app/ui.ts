/** Screen state shared between components (not saved). */
import { emit } from "../data/store";

export type Panel = null | "fix" | "lineup" | "sub" | "tag" | "timeout" | "teams" | "plan" | "job";
export const ui = {
  sel: null as string | null,          // selected player on the pad
  panel: null as Panel,                // open editor on the Track screen
  follow: null as null | { id: string; half: "us" | "them" | null; askOpp: boolean; label: string },
  statsScope: "match" as string,       // season | practice | match | s1..s5
  statsSeason: "" as string,
  prevRally: false,                    // stats-only device: put the next entry in the rally that just ended
  courtTab: "tendency" as "tendency" | "playbook" | "boards",
  filmAsk: "" as string,               // a question for Film Room's season search, from a player page
  previewPlayer: false,                // a coach is looking at the app the way their players and families see it
};
export function setUi(p: Partial<typeof ui>) { Object.assign(ui, p); emit(); }
