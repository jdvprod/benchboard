# Benchboard

[![CI](https://github.com/jdvprod/benchboard/actions/workflows/ci.yml/badge.svg)](https://github.com/jdvprod/benchboard/actions/workflows/ci.yml)

_Formerly Bench Stats._

Volleyball stats, lineups, rotations and practice planning for coaches. Works offline, installs like an app on phones, tablets and laptops, and keeps every team's data on the device.

## What's in it

- **Track**: live stat entry by player (a bottom action sheet on phones, jersey-number-then-letter keyboard entry on laptops; Labs adds type-in codes like `7k 12ace ok11` and a big-button focus mode), scoreboard with rotation, server, timeouts and subs, drag-and-drop subs, libero serving, film tags, undo, in-game coach flags, and AI timeout talking points.
- **Stats**: season, practice, match or single-set views. Includes overview KPIs, player totals, per-set and advanced stats (+/−, net points, serve efficiency, ace:error), attack by first contact (in-system, out-of-system, transition), side-out by pass grade, rotations, best six-player units, situations (side-out and point-scoring by score band and lead, runs, rallies after timeouts and errors, first-to-5 and close-set records, serving runs), opponent players, a film index (every play with its video time, filterable by player and play type, linked to a YouTube or Vimeo video, with YouTube chapters export), an Excel export, an AI match report and a share graphic of the final score for social posts.
- **Court**: a tendency court that turns tapped ball locations into zone heat maps and defense, attack and serve recommendations, filterable by opponent, their jersey number, our player and rotation. It also has three saved drawing boards.
- **Labs** (off until turned on): **Formations**: drag players into serve-receive, serving and base-defense spots for all six rotations. It flags overlap (rotation) faults at the serve, shows where each player moves after the serve, and saves named sets like "5-1 three-passer".
- **Lineup**: a starting-six builder with the libero, checks that the lineup is balanced, a preview of all six rotations with season results, "on court now" or "next set" buttons, and an AI lineup suggestion.
- **Practice**: a plan builder with a timeline and drill library, a "what to work on" list built from your stats, AI plans, scrimmages with a roster split and head-to-head stats, drill tracking and history.
- **Player pages**: KPIs, trend charts, match log, goals with progress bars, an AI report card and a downloadable report for players and parents.
- **Live**: an ESPN-style gamecast with box score, momentum, leaders, team stats and play-by-play.
- **Match report**: a one-page report with set scores, score flow, leaders and box score that parents can open on any phone or print.
- **Team**: multiple teams and seasons, roster CSV import and export, (grad year and height for recruiting), opponents with scouting notes, and backup and restore (including v1 backups).
- **Import stats**: bring history over from Hudl or SoloStats (each match's MaxPreps .txt export), MaxPreps, or any .csv/.xlsx spreadsheet: one match, season totals, or a game log with one row per match. Columns are matched automatically and can be changed; players are matched to the roster by number and name.
- **Tournament days**: on Matchup → Tournaments, list pool games (with work-team duties), bracket rounds, courts and times. Pool standings update as matches finish, each game starts tracking with the right format, and Home shows today's next game. Families see the day on Benchboard Live.

## Run it

You need Node.js 18+.

```
npm install
npm run dev      # http://localhost:5173, rebuilds on save
npm run build    # production build in dist/
npm test         # engine tests
```

## Put it online (free)

**Cloudflare Workers** (recommended; the free plan doesn't charge per deploy). `wrangler.jsonc` serves the built `dist/` folder as static assets, and `public/_headers` adds the security headers and content security policy.

1. In Cloudflare, go to **Workers & Pages → Create → Import a repository** and pick `jdvprod/benchboard`.
2. **Project name:** `benchboard` (must match `name` in `wrangler.jsonc`).
3. **Build command:** `npm run build`. **Deploy command:** `npx wrangler deploy`.
4. Optional: under **Variables**, add `NODE_VERSION` = `22`.
5. Under the project's **Settings → Build → Branch control**, set the production branch to `live`, so only releases deploy. Day-to-day work goes to `main`; release with `git push origin main:live`.

The app is then at `https://benchboard.<your-subdomain>.workers.dev` (or a custom domain added under **Settings → Domains & Routes**).

GitHub Pages also works (`.github/workflows/pages.yml`, run by hand) but ignores `_headers`. Netlify works too (`netlify.toml`), but its free plan charges 15 of 300 monthly credits per production deploy and takes the site offline when they run out.

## Accounts, sync and live links (Supabase, free tier)

1. Create a project at supabase.com.
2. In **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key into `src/cloud/config.ts` (both are safe to publish; Row Level Security protects the data).
4. In **Authentication → URL Configuration**, set **Site URL** to your app's address (e.g. `https://benchboard.<your-subdomain>.workers.dev`) and add the same address followed by `/**` to **Redirect URLs**. Without this, sign-up and password-reset emails link to localhost.
5. Until you connect an email provider (see **Sign-up and password emails** below), turn off **Confirm email** in **Authentication → Sign In / Providers → Email**. Supabase's built-in email can't reach your coaches.
6. Open the app → **Settings → Setup check → Run check**. It confirms the database version, your account, team sync and AI, and says what's left.

Then coaches sign in on the Team tab, tap **Sync this team**, and invite assistants with a code. Every match is an event log per device, so several coaches can track the same match and their entries merge. Each device picks a job under **My job** on the Track screen: everything, score only, or stats only (chosen stat groups that count for players but never change the score). Public pages live on their own sites, separate from the coaching app (see **Public sites** below).

## Public sites

The build makes two more sites beside the coaching app, from the same code and deploy. They have no accounts and nothing on them can be changed:

- **Benchboard Live** (`/live/`) for families and fans. **Share team page** on the Team tab gives a link (`/live/#/t/CODE`) and a six-letter code: live scoreboard during matches, schedule and results, season stats, roster and player pages. Every match opens as an ESPN-style game page with Gamecast, Box score, Play-by-play and Team stats tabs. **Share gamecast** on the Live screen gives a link to one match (`/live/#/g/CODE`). Players appear as first name and last initial (or number only when a family asks); coaches' notes and film tags never reach these pages. Old `#/watch/` and `#/season/` links redirect.
- **Benchboard Recruit** (`/recruit/`) for college coaches. A player's page → Recruiting profile → **Share profile link** (after confirming the family agreed) publishes `/recruit/#/p/CODE`: verified season numbers, game log, measurables, contact and highlight clips. **Share recruiting board** on the Team tab lists every shared profile (`/recruit/#/b/CODE`), filterable by class and position. Profiles are snapshots: tap **Update profile link** after new matches.

**Clips.** On Stats → One match → Film, paste the match video link (YouTube, Vimeo or a video file link) or pick a video file on the device, and set **First serve at**. Every play then becomes a clip: watch any filter (a player's kills, every point, our errors) back to back, and from a video file save one clip or the whole reel as a video file. A player's best plays (kills, aces and blocks first) become the highlight clips on their Recruit profile; clips from a file on the device stay on the device.

**Notifications.** On Benchboard Live a family taps **Turn on notifications** on the team page (on iPhone, after adding the page to the Home Screen) and gets a phone notification when a match starts and the final score when it ends, with a tap through to the game. The coach's app sends them automatically after it syncs, once per match however many coaches are tracking. Setting it up:

1. In Supabase → Edge Functions, create a function named `notify` and paste in `supabase/functions/notify/index.ts` (or `supabase functions deploy notify --no-verify-jwt`). Turn off **Verify JWT** for it: families following a team aren't signed in, and the function checks coaches itself.
2. In the app, Settings → Setup check → **Make notification keys**. In Edge Functions → Secrets add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:` plus your contact email).

With a custom domain you can point `live.yourdomain.com` and `recruit.yourdomain.com` at the same Worker and redirect them to `/live/` and `/recruit/` (Cloudflare → Rules → Redirect Rules).

## Sign-up and password emails

Supabase's built-in email only sends to members of your Supabase organization, about 2 emails an hour, so real coaches can't get confirmation or password-reset emails until you connect an email provider:

1. Sign up with an email provider that has a free plan (Resend, Brevo, SendGrid and others work) and verify a domain you own.
2. In Supabase, go to **Authentication → Emails → SMTP Settings**, turn on **Custom SMTP** and paste the provider's host, port, user and password. Use a sender like `Benchboard <no-reply@yourdomain.com>`.
3. In **Authentication → Rate Limits**, raise the email limit if you expect many sign-ups at once (it starts at 30 an hour).
4. In **Authentication → Emails → Templates**, paste the branded templates from `supabase/email-templates/` (subjects: "Confirm your Benchboard email", "Reset your Benchboard password", "Your Benchboard sign-in link", "Confirm your new Benchboard email").

Until then, keep **Confirm email** off (Authentication → Sign In / Providers → Email) so coaches can sign up without an email; only password resets need the provider.

## AI features

Signed-in coaches use AI through the `ai` Supabase Edge Function (`supabase/functions/ai/index.ts`), which holds your Anthropic key and limits each coach to 40 requests a day (`AI_DAILY_LIMIT` to change it). To turn it on:

1. Run the latest `supabase/schema.sql` (version 10; adds the `ai_usage` counter).
2. In Supabase → Edge Functions, create a function named `ai` and paste in `supabase/functions/ai/index.ts` (or `supabase functions deploy ai`).
3. In Edge Functions → Secrets, add `ANTHROPIC_API_KEY`.

A coach can still paste their own Anthropic key in Settings; then calls go straight from the browser with no daily limit.

## Legal and privacy

- `public/legal/`: Privacy Policy, Terms of Service and a printable parent and guardian permission form. Set the operator name, contact email, governing state and effective date in `package.json` → `"legal"`; the build fills them in. Bump `legal.version` when the terms change and signed-in users are asked to agree again.
- Sign-up records which version of the terms was accepted and when (in the account's metadata). Older accounts agree once on their next sign-in.
- Teams get a one-time reminder to confirm they have permission (school, club, families) to record players; recruiting profiles can't be published until the coach confirms family consent, and can be taken down from the player's page.
- Settings → Privacy and your data: delete account (removes the account, every cloud team it owns, and its memberships; `delete_my_account()` in `schema.sql`), erase this device, and links to the documents.
- AI prompts identify players only by jersey number and first name.

These documents are a careful starting point written for this app, not legal advice. Have a lawyer review them before you charge money or sign up schools.

## Tests

- `npm test`: engine unit tests plus backtesting, where thousands of random matches (every action, subs, timeouts, deletes, several devices, stats-only entries, score fixes) are checked against invariants: scores match rallies, rotations follow side-outs, team totals equal player totals, merging devices or deleting entries gives the same result, no metric is ever NaN. `FUZZ_SCALE=60 npm test` runs a deep backtest (about 90,000 matches).
- `npm run e2e`: drives the built app in Chromium on desktop and phone, light and dark, with a mock Supabase (about 450 checks, including accessibility names, WCAG contrast, squeezed text and the content security policy): a full match by keyboard and buttons, match formats (sets to 21, caps, pool play, ending a set early), scrimmages and type-in codes, offline tracking in a gym with no signal or weak Wi-Fi (the test server really drops the connection) and syncing after, family data requests (export and erase a player), players kept off public pages, backups restored on a new device, long names on a small phone, planning, two coaches splitting a match, a phone with a wrong clock, view-only accounts, parent links, the season page, recruiting links, importing Hudl/MaxPreps files and spreadsheets, tournament days, family notifications, AI and the setup check.
- `supabase/test-schema.sh`: runs `schema.sql` twice on a throwaway Postgres, checks the public functions (no coach notes or film tags ever reach public pages), and checks row level security as real coaches (owner, stranger, view-only, last edit wins).

All three run on every push (GitHub Actions).

## Code map

```
src/sports/volleyball/   rules engine (event log → score, rotations, stats), metrics, flags, tendencies
src/data/                data model, IndexedDB storage, store, sample data, backup
src/features/<page>/     one folder per screen
src/ui/                  shared components: cards, charts, court, AI card, drag and drop
src/ai/                  Claude client and prompts
```

Every match is an append-only event log, so stats can be recomputed with new metrics at any time and logs from several devices merge cleanly. That makes accounts and cloud sync (planned with Supabase) and other sports (add `src/sports/<sport>/`) straightforward to add.

## Roadmap

1. A server AI proxy, then paid plans.
2. Rankings and recruiting profiles.
3. Video clips and AI video analysis.
