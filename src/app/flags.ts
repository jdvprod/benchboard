/** Features that are built but not offered yet. Flip to true to turn one on; the code stays in place either way. */
/** Player fees (Team → Player fees, Club → Fees). On hold until it's wanted. Fees still sync safely if turned on (schema v29).
 * When turning it on, also bring back the "Player fees" section of public/legal/privacy.html (commit cf8470b). */
export const FEES = false;

/** Paid plans (see the "FloorCall pricing and payments plan" doc). Off: every team has every feature, nobody pays.
 * On: anyone can make an account and gets a free trial, then the team needs a plan. Players and families on a team
 * with a plan are included. Payments go through Stripe Checkout and a Supabase `billing` function (not built yet;
 * it needs the Stripe keys in Supabase secrets) that sets the team's plan and paid-through date. */
export const BILLING = false;
export type Plan = "team" | "club" | "player" | "trainer";
/** FloorCall Live is the only free product. Academy, Beach and Recruit's athlete tools need an account (SiteGate) and,
 * once billing is on, a plan: a team's plan covers its coaches, players and families; the Player plan covers one person. */
export const PLANS: Record<Plan, { name: string; price: string; per: string }> = {
  team: { name: "Team", price: "$149", per: "per team per year, or $19 a month" },
  club: { name: "Club", price: "$99", per: "per team per year, 4 teams or more" },
  player: { name: "Player", price: "$4.99", per: "a month, or $39 a year: Academy, Beach and the recruiting tools" },
  trainer: { name: "Trainer", price: "$9.99", per: "a month, or $89 a year: FloorCall Lessons, with the trainer's athletes and parents included (included with a Team or Club plan)" },
};
export const TRIAL_HOURS = 24, TRIAL_MAX_DAYS = 14;
/** A Team or Club plan covers this many players on a roster (proposal; see the pricing doc). Past it, the coach asks
 * us for a bigger roster. Only shown once BILLING is on. */
export const ROSTER_INCLUDED = 20;
export const rosterOver = (players: number) => (BILLING ? Math.max(0, players - ROSTER_INCLUDED) : 0);

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

/** Which AI features are offered. Each one spends AI credits (the `ai` Supabase function, AI_DAILY_LIMIT calls per
 * coach per day). The open-ended "ask" chats are off: the stats and film already show the answers, and coaches decide.
 * Finding clips and stats by typing ("kills by #7 in set 2") never needs AI; clipSearch is only the fallback for a
 * search the built-in reader can't understand, and it's the cheapest call. */
export const AI_FEATURES = {
  askStats: false,      // Stats → "Ask your stats" chat
  askFilm: false,       // Film Room → Breakdown → "Ask about this match"
  clipSearch: true,     // Film Room / season clip search: AI only when the typed search isn't understood
  reports: true,        // Stats → Match report, Practice report, Season review
  scouting: true,       // Team → opponent and Matchup → Scouting report
  timeout: true,        // Tracker → Timeout card (talking points)
  reportCard: true,     // Player → Report card
  filmSummary: true,    // Film Room → Breakdown summary
  lineup: true,         // Lineup → Suggest a lineup
  practice: true,       // Practice → Suggest a practice
};
