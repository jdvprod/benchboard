/** Teams this phone follows on Jumpset Live; signed in, the list is kept with the account so every phone has it. */
import { currentUser, updateMeta, userMeta } from "../cloud/client";

/** Teams this phone has followed, most recent first (a family with kids on several teams sees them all on the home page). */
export type Followed = { code: string; name: string; logo?: string | null };
export const myTeams = (): Followed[] => { try { const a = JSON.parse(localStorage.getItem("bbl-teams") || "null"); if (Array.isArray(a)) return a; const l = JSON.parse(localStorage.getItem("bbl-last") || "null"); return l ? [l] : []; } catch { return []; } };
export function rememberTeam(t: Followed) {
  try { localStorage.setItem("bbl-teams", JSON.stringify([t, ...myTeams().filter((x) => x.code !== t.code)].slice(0, 8))); } catch { /* private window */ }
  // signed in: the team follows the account to every device
  if (currentUser()) { const have = userMeta().teams || []; if (have[0] !== t.code) updateMeta({ teams: [t.code, ...have.filter((c) => c !== t.code)].slice(0, 12) }).catch(() => {}); }
}
export const forgetTeam = (code: string) => {
  try { localStorage.setItem("bbl-teams", JSON.stringify(myTeams().filter((x) => x.code !== code))); localStorage.removeItem("bbl-last"); } catch { /* private window */ }
  if (currentUser() && (userMeta().teams || []).includes(code)) updateMeta({ teams: (userMeta().teams || []).filter((c) => c !== code) }).catch(() => {});
};

/** After signing in: add the teams this phone already follows to the account. */
export function syncFollowed() {
  if (!currentUser()) return;
  const have = userMeta().teams || [], local = myTeams().map((t) => t.code).filter((c) => !have.includes(c));
  if (local.length) updateMeta({ teams: [...local, ...have].slice(0, 12) }).catch(() => {});
}
