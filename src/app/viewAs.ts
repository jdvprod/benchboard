/** Players and families (view-only members) see the team's stats and schedule, never the coaching tools.
 * A coach can preview exactly that from Settings → "See what players see". */
import { ui } from "./ui";
import { roleOn } from "../cloud/sync";

export const isViewer = (teamId?: string) => ui.previewPlayer || (!!teamId && roleOn(teamId) === "viewer");
/** Pages for coaches only. */
export const COACH_ONLY = ["track", "lineup", "formations", "matchup", "tournament", "practice", "court", "film", "live", "labs", "tryouts", "club"];
