/** Features that are built but not offered yet. Flip to true to turn one on; the code stays in place either way. */
/** Player fees (Team → Player fees, Club → Fees). On hold until it's wanted. Fees still sync safely if turned on (schema v29).
 * When turning it on, also bring back its What's New entry and the "Player fees" section of public/legal/privacy.html (both in commit cf8470b). */
export const FEES = false;

/** Paid plans (see the "Floorcall pricing and payments plan" doc). Off: every team has every feature.
 * On: teams without a paid plan get the Free limits below. Payments go through Stripe Checkout and a Supabase `billing`
 * function (not built yet; needs the Stripe keys in Supabase secrets). */
export const BILLING = false;
export type Plan = "free" | "team" | "club";
export const PLANS: Record<Plan, { name: string; price: string; coaches: number; aiPerDay: number; film: boolean; scouting: boolean }> = {
  free: { name: "Free", price: "$0", coaches: 2, aiPerDay: 5, film: false, scouting: false },
  team: { name: "Team", price: "$149 per team per year, or $19 a month", coaches: Infinity, aiPerDay: Infinity, film: true, scouting: true },
  club: { name: "Club", price: "$99 per team per year, 4 teams or more", coaches: Infinity, aiPerDay: Infinity, film: true, scouting: true },
};
/** What a team may use. Until billing is on, everything. */
export const planOf = (t?: { plan?: Plan } | null): Plan => (BILLING ? t?.plan || "free" : "team");
export const can = (t: { plan?: Plan } | null | undefined, f: "film" | "scouting") => PLANS[planOf(t)][f];
