/** Which tournament is on today. Its own module so Home can ask without loading the Tournament page. */
import { team, todayISO } from "../data/store";
import { isOn, Tournament } from "./model";

export const tournamentsOf = (): Tournament[] => (team()?.tournaments || []).slice().sort((a, b) => b.start.localeCompare(a.start));
export const todaysTournament = (): Tournament | null => tournamentsOf().find((t) => isOn(t, todayISO())) || null;
