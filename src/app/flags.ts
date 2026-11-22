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

/** Tests can turn billing on in the browser (globalThis.__FC_TEST_BILLING) to check the free tier without a build. */
export const billingOn = () => BILLING || !!(globalThis as any).__FC_TEST_BILLING;

/** Free forever vs. the Team plan (once billing is on). A team without a plan, after its trial, keeps the free tier:
 * points-only and basic-stats tracking, FloorCall Live, stats helper links, schedule and calendar, roster and lineups,
 * announcements and notes, and the box score with each player's numbers. The Team (or Club) plan adds the rest. */
export type Feature = "fullStats" | "deepStats" | "quickAnswers" | "ai" | "scouting" | "film" | "practice" | "exports" | "club";
export const PAID: Record<Feature, string> = {
  fullStats: "Full stats tracking: passing grades, every button, rotations and serve receive",
  deepStats: "Rotations, serve and pass, situations, opponent and trend stats",
  quickAnswers: "Quick answers",
  ai: "AI match reports, timeout cards and scouting reports",
  scouting: "Scouting and matchup pages",
  film: "Film Room",
  practice: "Practice plans and drills",
  exports: "Spreadsheets, season reports, graphics and videos",
  club: "Club tools for several teams",
};
export const FREE_LIST = ["Points only and basic stats tracking", "FloorCall Live for families", "Stats helper links for parents", "Schedule, calendar, roster and lineups", "Announcements and notes", "Box score and each player's numbers"];
/** Whether a team may use a feature: everything while billing is off, during the trial and on a plan; afterwards only the free tier. */
export const featureOk = (_f: Feature, a: Access) => a.ok;

export type Access = { ok: true; why: "billing off" | "paid" | "trial"; endsAt?: number; note?: string } | { ok: false; why: "trial over" };
/** The free trial covers a team's first match or its first 24 hours, whichever gives more:
 * it ends 24 hours after the team was made once a match is finished, and in any case after 14 days. */
export function access(t: { createdAt: number; plan?: Plan; paidUntil?: string } | null | undefined, finishedMatches: number, now = Date.now(), today = new Date(now).toISOString().slice(0, 10)): Access {
  if (!billingOn()) return { ok: true, why: "billing off" };
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

/** Who pays for AI. "included": signed-in coaches use FloorCall's key (your Anthropic credits, AI_DAILY_LIMIT per coach
 * per day), and a coach can add their own key in Settings instead. "own-key": only coaches who add their own Anthropic
 * key in Settings get AI, on their own bill; FloorCall's key is never used. "off": no AI anywhere. */
export const AI_MODE: "included" | "own-key" | "off" = "included";
/** The daily number of AI requests per coach, unless an admin set another for that account. Keep in step with the
 * AI_DAILY_LIMIT secret on the ai function (40 when it isn't set). Higher plans can raise it later. */
export const AI_DAILY_DEFAULT = 40;

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
