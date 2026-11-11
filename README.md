# Floorcall

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
- **Photos and logos**: a photo for each player (tap the circle on the Team tab, or Add photo on their page; taken or picked on the phone and cropped to a small square), and team logos for your team and every opponent. **Find logo** searches Wikipedia, the school's official logo on Wikidata and its website icon by name; new opponents get their school's logo automatically when exactly one school matches (in your state, once your own logo is set from Wikipedia). Or upload one. They show on the gamecast, Floorcall Live, the stream overlay, Recruit profiles and share graphics. Photos of players kept off public pages never leave the coaches' devices.
- **Player pages**: KPIs, trend charts, match log, goals with progress bars, an AI report card, a downloadable report for players and parents, and a stat graphic (last match or season so far) sized for Instagram. Players kept off public pages don't get one.
- **Live**: an ESPN-style gamecast with box score, momentum, leaders, team stats and play-by-play.
- **Match report**: a one-page report with set scores, score flow, leaders and box score that parents can open on any phone or print.
- **Team**: multiple teams and seasons, roster CSV import and export, (grad year and height for recruiting), opponents with scouting notes, and backup and restore (including v1 backups).
- **Import stats**: bring history over from Hudl or SoloStats (each match's MaxPreps .txt export), MaxPreps, or any .csv/.xlsx spreadsheet: one match, season totals, or a game log with one row per match. Columns are matched automatically and can be changed; players are matched to the roster by number and name.
- **Tournament days**: on Matchup → Tournaments, list pool games (with work-team duties), bracket rounds, courts and times. Pool standings update as matches finish, each game starts tracking with the right format, and Home shows today's next game. Families see the day on Floorcall Live.

**Going live:** follow [LAUNCH.md](LAUNCH.md) and run `npm run launch-check` first.

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
2. **Project name:** `floorcall` (must match `name` in `wrangler.jsonc`).
3. **Build command:** `npm run build`. **Deploy command:** `npx wrangler deploy`.
4. Optional: under **Variables**, add `NODE_VERSION` = `22`.
5. Under the project's **Settings → Build → Branch control**, set the production branch to `live`, so only releases deploy. Day-to-day work goes to `main`; release with `git push origin main:live`.

The app is then at `https://floorcall.<your-subdomain>.workers.dev` (or a custom domain added under **Settings → Domains & Routes**).

GitHub Pages also works (`.github/workflows/pages.yml`, run by hand) but ignores `_headers`. Netlify works too (`netlify.toml`), but its free plan charges 15 of 300 monthly credits per production deploy and takes the site offline when they run out.

## Accounts, sync and live links (Supabase, free tier)

1. Create a project at supabase.com.
2. In **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key into `src/cloud/config.ts` (both are safe to publish; Row Level Security protects the data).
4. In **Authentication → URL Configuration**, set **Site URL** to your app's address (e.g. `https://floorcall.<your-subdomain>.workers.dev`) and add the same address followed by `/**` to **Redirect URLs**. Without this, sign-up and password-reset emails link to localhost.
5. Until you connect an email provider (see **Sign-up and password emails** below), turn off **Confirm email** in **Authentication → Sign In / Providers → Email**. Supabase's built-in email can't reach your coaches.
6. Open the app → **Settings → Setup check → Run check**. It confirms the database version, your account, team sync and AI, and says what's left.

Then coaches sign in on the Team tab, tap **Sync this team**, and invite assistants with a code. Every match is an event log per device, so several coaches can track the same match and their entries merge. Each device picks a job under **My job** on the Track screen: everything, score only, or stats only (chosen stat groups that count for players but never change the score). Public pages live on their own sites, separate from the coaching app (see **Public sites** below).

## Public sites

The build makes two more sites beside the coaching app, from the same code and deploy. Scores, box scores and shared profiles open for anyone with the link; following a team, notifications, team film and the athlete tools need a free account:

- **Floorcall Live** (`/live/`) for families and fans. **Share team page** on the Team tab gives a link (`/live/#/t/CODE`) and a six-letter code: live scoreboard during matches, schedule and results, season stats, roster and player pages. Every match opens as an ESPN-style game page with Gamecast, Box score, Play-by-play and Team stats tabs. **Share gamecast** on the Live screen gives a link to one match (`/live/#/g/CODE`). Players appear as first name and last initial (or number only when a family asks); coaches' notes and film tags never reach these pages. Old `#/watch/` and `#/season/` links redirect.
- **Floorcall Recruit** (`/recruit/`) for college coaches. A player's page → Recruiting profile → **Share profile link** (after confirming the family agreed) publishes `/recruit/#/p/CODE`: verified season numbers, game log, measurables, contact and highlight clips. **Share recruiting board** on the Team tab lists every shared profile (`/recruit/#/b/CODE`), filterable by class and position. Profiles are snapshots: tap **Update profile link** after new matches.

**Highlight videos.** On a player's page, **Make highlight video** turns their best plays into one finished video in the browser: a title card (photo, name, number, class, team), each play with a broadcast-style caption ("KILL · vs Central · Set 2 · 14–12") and a player bug, and a closing card with verified numbers and the profile link. Pick and order the plays and choose 5, 7 or 10 seconds each. Works from a match video file on the device or a direct video link (YouTube and Vimeo can't be cut in a browser). Saves as MP4 where the browser can, otherwise WebM.

**Film Room** (`#/film`, wide screens). Stat a whole game from its video: pick the file, and every play entered (keyboard, taps or voice) carries its exact moment in the video (`vt` on the event), so every stat is a clip. **Find rallies from the whistle** decodes the sound and finds the referee's whistle (a pure 2–4 kHz tone of a quarter second or more), pairs serve and end whistles into rallies, shades them on the timeline and skips the dead time between them. While statting, the video pauses at each rally's whistle so the plays can be entered, and Space goes straight to the next serve; the Rallies tab flags any rally with no point statted yet; films over 700 MB are scanned by listening at 4× instead. **Find clips** takes plain words: "all solo blocks", "blocking reps", "kills to area 1", "Maya's digs in set 2", "aces in rotation 3", "kills off perfect passes", "their kills from #7", "serve errors at 20+" (`src/film/query.ts`, with the AI as a fallback for anything it can't read) and plays the matches back to back or makes a player's highlight video from them. Matches tracked live can be opened too: pause at the first serve and tap **First serve is now** to line the video up. Film games count in season stats but never notify families. Fully automatic statting from raw video isn't reliable yet; the tags made here are the training data for it.

**Accounts.** Everyone signs in: coaches in the app (there's no "use without an account" when the cloud is set up; only the sample season can be explored first), athletes on Recruit, families and fans on Live to follow a team, get notifications or watch team film. Sign-up asks for a name, who they are (coach, athlete, parent, fan) and whether they want Floorcall news by email (on by default for adults, off for athletes); it's all kept in the account's metadata. Followed teams and athlete details follow the account to every device. Admin → Accounts shows the counts and downloads the news email list (only people who said yes).

**Virtual film room (film sessions).** In Film Room → Film sessions, a coach builds a session from clips (ask for clips, then "Add to a film session", or "Add this moment"), writes a note for each clip and draws on a frozen frame: arrows, circles, lines, freehand, in four colors. **Send to team** records every clip as a short video (the clip with its caption, holding 4 seconds on the drawing and note, like a TV telestrator), uploads it to Storage (bucket `film`) and shares the session on Floorcall Live at `/live/#/film/CODE`. Players and families sign in to watch on their phones; watched clips are ticked off and the coach sees who watched how many. **Take down** removes it.

**For athletes (Floorcall Recruit, free account).** `#/guide`: what to have ready (a checklist saved to the account), a year-by-year plan and tips. `#/emails`: emails to college coaches (first email, tournament schedule, after a camp, new video, thank you) written from the athlete's details, with what's still missing. `#/studio` **Reel Studio**: drop in clips or a whole game, mark plays with a tap or a key, star the must-haves, and make a batch of highlight videos at once (best of, hitting, blocking, defense and passing, serving, setting). Film never leaves the device.

**College coach search** is built but paused (`src/recruit/flags.ts`): no links lead to it until Floorcall has the reach for it.

**Recruiting profiles** also show where the player ranks on the team ("1st on the team in kills per set", counting regulars only), and the coach sees how often the shared profile was opened.

**Voice entry (Labs).** With type-in codes on, a **Voice** button listens on the bench: "seven kill", "twelve ace, their kill eleven", "four pass three", "scratch that". Clear phrases record right away; anything unclear waits in the box to fix.

**Clips.** On Stats → One match → Film, paste the match video link (YouTube, Vimeo or a video file link) or pick a video file on the device, and set **First serve at**. Every play then becomes a clip: watch any filter (a player's kills, every point, our errors) back to back, and from a video file save one clip or the whole reel as a video file. A player's best plays (kills, aces and blocks first) become the highlight clips on their Recruit profile; clips from a file on the device stay on the device.

**Gameday extras on Live.** The gamecast shows who's on the court in their rotation spots (with photos, the libero and the server marked). The schedule has **Add to calendar** (a calendar file of upcoming matches and tournament games), and the Live home page lists every team the phone follows. The stream overlay captions who scored each point (`plays=0` turns it off). Once a season has three results, the team page shows **Season in review** (record, sets, longest win streak, biggest win, best single-match lines), and Stats → **Season graphic** makes the same as an image. On the coach's Home, **Text recap** copies the result, set scores, three standouts and the box score link for the team group chat.

**Spanish.** Floorcall Live shows in Spanish on phones set to Spanish, with English / Español buttons at the bottom of every page (scores, box scores, play-by-play, tournaments, notifications).

**Family flyer.** After **Share team page**, the Team tab makes a printable "Follow us live" flyer (QR code, team code, how to turn on notifications) and the same as an image for group chats.

**Notifications.** On Floorcall Live a family taps **Turn on notifications** on the team page (on iPhone, after adding the page to the Home Screen) and gets a phone notification when a match starts and the final score when it ends, with a tap through to the game. A family can also pick their player: finals then start with that player's line ("Nia L.: 14 kills, 8 digs"). The coach's app sends them automatically after it syncs, once per match however many coaches are tracking. Setting it up:

1. In Supabase → Edge Functions, create a function named `notify` and paste in `supabase/functions/notify/index.ts` (or `supabase functions deploy notify --no-verify-jwt`). Turn off **Verify JWT** for it: families following a team aren't signed in, and the function checks coaches itself.
2. In the app, Settings → Setup check → **Make notification keys**. In Edge Functions → Secrets add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:` plus your contact email).

**Stream overlay.** Live tab → Stream overlay makes one link for the whole season (`/live/#/t/CODE/overlay`). Add it as a Browser source in OBS, Streamlabs or vMix at 1920 × 1080: a see-through score bug (team names, sets, points, server) that follows whichever match is being tracked and updates within a few seconds. Options in the link: `size=s|m|l`, `pos=bl|br|tl|tr`, `us=` short name, `sets=0`. One match only: `/live/#/g/CODE/overlay`.

**Pictures.** Synced teams upload photos and logos to Supabase Storage (bucket `media`, made by `schema.sql`; only a team's coaches can add files, anyone can view them). Before a team syncs they stay on the device and upload after the next sync.

With a custom domain you can point `live.getfloorcall.com` and `recruit.getfloorcall.com` at the same Worker and redirect them to `/live/` and `/recruit/` (Cloudflare → Rules → Redirect Rules).

## Sign-up and password emails

Supabase's built-in email only sends to members of your Supabase organization, about 2 emails an hour, so real coaches can't get confirmation or password-reset emails until you connect an email provider:

1. Sign up with an email provider that has a free plan (Resend, Brevo, SendGrid and others work) and verify a domain you own.
2. In Supabase, go to **Authentication → Emails → SMTP Settings**, turn on **Custom SMTP** and paste the provider's host, port, user and password. Use a sender like `Floorcall <no-reply@yourdomain.com>`.
3. In **Authentication → Rate Limits**, raise the email limit if you expect many sign-ups at once (it starts at 30 an hour).
4. In **Authentication → Emails → Templates**, paste the branded templates from `supabase/email-templates/` (subjects: "Confirm your Floorcall email", "Reset your Floorcall password", "Your Floorcall sign-in code", "Confirm your new Floorcall email").

Then turn on **Confirm email** (Authentication → Sign In / Providers → Email) so every new account proves its email.

**New-device check.** Signing in with a password on a browser that account hasn't used before also needs a 6-digit code (or the link) from an email, sent with the **Magic Link** template, so that template must include `{{ .Token }}` (the one in `supabase/email-templates/magic-link.html` does). The device is remembered after that; on getfloorcall.com one check covers the app, Live and Recruit on that browser. Email links (confirming an account, resetting a password) count as a check too. Expect one extra email per new phone or computer; the email provider's free plan covers it at this size.

## AI features

Signed-in coaches use AI through the `ai` Supabase Edge Function (`supabase/functions/ai/index.ts`), which holds your Anthropic key and limits each coach to 40 requests a day (`AI_DAILY_LIMIT` to change it). To turn it on:

1. Run the latest `supabase/schema.sql` (version 15).
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
