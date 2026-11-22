/** Is this AI feature shown? Off when FloorCall turns it off (AI_FEATURES, AI_MODE) or the coach hides AI in Settings. */
import { AI_FEATURES, AI_MODE } from "../app/flags";
import { state } from "../data/store";
import { can } from "../app/plan";
export const aiOn = (f: keyof typeof AI_FEATURES) => AI_MODE !== "off" && AI_FEATURES[f] && !state.prefs.noAi && can("ai");
