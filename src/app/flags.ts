/** Features that are built but not offered yet. Flip to true to turn one on; the code stays in place either way. */
/** Player fees (Team → Player fees, Club → Fees). On hold until it's wanted. Fees still sync safely if turned on (schema v29).
 * When turning it on, also bring back the "Player fees" section of public/legal/privacy.html (commit cf8470b). */
export const FEES = false;

/** Paid plans (see the "Floorcall pricing and payments plan" doc). Off: every team has every feature, nobody pays.
 * On: anyone can make an account and gets a free trial, then the team needs a plan. Players and families on a team
 * with a plan are included. Payments go through Stripe Checkout and a Supabase `billing` function (not built yet;
 * it needs the Stripe keys in Supabase secrets) that sets the team's plan and paid-through date. */
export const BILLING = false;
export type Plan = "team" | "club";
export const PLANS: Record<Plan, { name: string; price: string; per: string }> = {
  team: { name: "Team", price: "$149", per: "per team per year, or $19 a month" },
  club: { name: "Club", price: "$99", per: "per team per year, 4 teams or more" },
};
export const TRIAL_HOURS = 24, TRIAL_MAX_DAYS = 14;

export type Access = { ok: true; why: "billing off" | "paid" | "trial"; endsAt?: number; note?: string } | { ok: false; why: "trial over" };
/** The free trial covers a team's first match or its first 24 hours, whichever gives more:
 * it ends 24 hours after the team was made once a match is finished, and in any case after 14 days. */
export function access(t: { createdAt: number; plan?: Plan; paidUntil?: string } | null | undefined, finishedMatches: number, now = Date.now(), today = new Date(now).toISOString().slice(0, 10)): Access {
  if (!BILLING) return { ok: true, why: "billing off" };
  return accessWith(t, finishedMatches, now, today);
}
export function accessWith(t: { createdAt: number; plan?: Plan; paidUntil?: string } | null | undefined, finishedMatches: number, now: number, today: string): Access {
  if (!t) return { ok: true, why: "trial" };
  if (t.plan && t.paidUntil && t.paidUntil >= today) return { ok: true, why: "paid" };
  const day = t.createdAt + TRIAL_HOURS * 3600e3, cap = t.createdAt + TRIAL_MAX_DAYS * 86400e3;
  if (now < day) return { ok: true, why: "trial", endsAt: finishedMatches ? day : Math.min(cap, Math.max(day, now)), note: finishedMatches ? "first day" : "until your first match is done" };
  if (!finishedMatches && now < cap) return { ok: true, why: "trial", endsAt: cap, note: "until your first match is done" };
  return { ok: false, why: "trial over" };
}
