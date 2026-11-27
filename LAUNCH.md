# Launching FloorCall

Do these in order. Each step says how to know it worked. About an hour the first time.

**Still to do (as of November 2026):**

- [ ] Run `supabase/schema.sql` again (version 40), step 1.
- [ ] Deploy the `alerts` function and schedule it (Error alerts, below).
- [ ] Upgrade Supabase to Pro for backups and no pausing, then test one restore.
- [ ] Set up an uptime monitor.
- [ ] Run the two-phone smoke test (step 4) on the live sites.
- [ ] Business: file the LLC between December 17 and 31 (California's 15-day rule means no 2026 franchise tax; the first $800 is due April 15, 2027), get the EIN, open the business bank account, then put the LLC's name in `legal.owner` and rebuild.
- [ ] Have a lawyer read the Terms' arbitration, minors and training-injury sections before taking payments in 2027.
- [ ] Print flyers for clinics and tournaments: open getfloorcall.com/flyer.html → **Print** (US Letter, one page, with a QR code to the site).

## 0. Fill in the blanks (5 minutes)

In `package.json`:

- `legal.email`: the address families and schools write to about their data (for example hello@getfloorcall.com). **Required.**
- `legal.owner`: your name or business name, as it should appear in the Privacy Policy and Terms.
- `legal.state`: the state whose law governs the Terms.
- `site.url`: set to https://getfloorcall.com. Link previews in texts and social posts use it.

Then run `npm run launch-check`. Everything should say `ok` (the `site.url` line can stay a warning until the domain is set up).

## 1. Supabase (the database and accounts)

1. **SQL Editor → New query**: paste all of `supabase/schema.sql` → **Run**. Safe to run again any time. This is version 40 (Settings → Setup check shows the version your project has). Among other things it makes the `media` storage for photos and logos, the `film` storage for team film sessions, crash reports, the admin console, and the account and film-session functions.
   Since version 18 it also turns on: team announcements (18), availability, "Going / Maybe / Can't go" (19), college messages to coaches, still switched off in the app (20), beach live links (21), the shared team playbook (22), volunteer jobs (23), availability for a named player (24) upcoming practices on the team page (25) tryouts shared with evaluators (26) practice plans shown to the team (27) and a security tightening (28): people without an account can only open the public pages, storage buckets can no longer be listed by outsiders, a network that tries 20 wrong share codes in 10 minutes has to wait, and deleting an account also clears its answers, sign-ups, tryouts and subscriptions. Version 29 keeps player fees in their own table that only a team's owner and coaches can read (view-only members can't). Version 30 adds coach verification: a coach must be verified by a FloorCall admin (Admin console → Coach verification) before their team can sync, coaches who join with a coach code wait for the team owner's approval, and view-only members (players, families) no longer receive scouting, drills, practice plans or boards. Coaches who already own a synced team are verified automatically. Version 31 adds FloorCall Lessons: trainers' athletes, sessions, reps and paid status, athlete and parent access by code, and clinic sign-ups. Version 32 adds the contact form's inbox (Admin console → Messages) and one code box that takes a team code or a Lessons code. Version 33 adds verified badges on a team's staff list and the Academy drills coaches pick for their players. Version 34 adds notes from coaches: one-way notes to the team, a position group or one player, read by the player and the parents a coach links to her. Version 35 adds per-account AI limits (Admin → AI access) and the error digest the alerts function reads. Version 36 adds support tools: Admin → Find an account, and handing a team to another coach. Version 37 adds coaches' own Academy drills. Version 38 adds stats helper links: a parent tracks one match from a link, with no account. Version 39 lets one helper link cover every match the coach starts that day. Version 40 shows a team's 24- or 48-hour rule to families on Live. Make yourself an admin once: `insert into public.admins select id from auth.users where email = 'YOUR EMAIL';` Until it is run, those features stay hidden or say they can't connect.
2. **Authentication → URL Configuration**: Site URL = `https://app.getfloorcall.com`. Redirect URLs: add `https://app.getfloorcall.com/**`, `https://live.getfloorcall.com/**`, `https://recruit.getfloorcall.com/**`, `https://beach.getfloorcall.com/**`, `https://academy.getfloorcall.com/**`, `https://lessons.getfloorcall.com/**` and `https://getfloorcall.com/**` (every site has its own sign-in, and password-reset and change-email links come back to the site they were sent from).
3. **Emails (required before launch).** Sign-up confirmation, password resets and the new-device sign-in code all go by email, and Supabase's built-in email only reaches your own team, a couple an hour.
   - Make a free **Resend** account (resend.com) → **Domains → Add domain** `getfloorcall.com` → add the DNS records it shows in Cloudflare (DNS → Records) → wait for **Verified**. Then **API Keys → Create** (sending access).
   - Supabase **Authentication → Emails → SMTP Settings** → Enable custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = that API key, sender `no-reply@getfloorcall.com`, name `FloorCall`.
   - **Authentication → Emails → Templates**: paste each file from `supabase/email-templates/` (Confirm signup, Magic Link, Reset password, Change email). The Magic Link one carries the 6-digit code for new devices.
   - **Authentication → Sign In / Providers → Email**: turn **Confirm email** on.
   - **Authentication → Rate Limits**: raise "emails sent per hour" to about 100.
   - **Authentication → Sign In / Providers → Email**: turn **Secure email change** on (a change of sign-in email is confirmed from both the old and the new address).
   - In Cloudflare DNS also add a **DMARC** record if Resend didn't: type `TXT`, name `_dmarc`, content `v=DMARC1; p=none; rua=mailto:YOUR EMAIL`. With SPF and DKIM from Resend, school email systems are far less likely to junk FloorCall's emails.
   - Test: sign up with a Gmail address and a school address. Both should get the confirmation within a minute, from `no-reply@getfloorcall.com`, not in spam.
4. **Edge Functions → Deploy a new function → Via Editor**:
   - `ai`: paste `supabase/functions/ai/index.ts` and turn **off** "Verify JWT" (the function checks the sign-in itself). Secret: `ANTHROPIC_API_KEY`.
   - `notify`: paste `supabase/functions/notify/index.ts`, and turn **off** "Verify JWT" for it. Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (make them in the app: Settings → Setup check → Make notification keys) and `VAPID_SUBJECT` (`mailto:` + your contact email).

   - **Updating a function later** (only when `supabase/functions/...` changes): Edge Functions → click the function → **Code** → select all, paste the new `index.ts` from the repo → **Deploy**. Secrets stay as they are. Or from a terminal with the Supabase CLI: `supabase functions deploy ai --no-verify-jwt` (and the same for `notify`).

   - `alerts` (optional but recommended): see **Error alerts** below.

5. **Make yourself an admin** (SQL Editor, after you've created your account in the app):
   `insert into public.admins select id from auth.users where email = 'you@example.com';`
   Settings in the app then shows **Admin**: sign-ups, active teams, live matches, crash reports, and every uploaded photo and logo with a **Take down** button.

## 2. Cloudflare (the website)

1. **Workers & Pages → Create → Import a repository** → `jdvprod/benchboard`, project name `floorcall`.
2. Build command `npm run build`, deploy command `npx wrangler deploy`, production branch `live`.
3. Under the Worker's **Settings → Domains & Routes → Add → Custom domain**, add all eight: `getfloorcall.com`, `www.getfloorcall.com`, `app.getfloorcall.com`, `live.getfloorcall.com`, `recruit.getfloorcall.com`, `beach.getfloorcall.com`, `academy.getfloorcall.com`, `lessons.getfloorcall.com`. `worker/index.js` sends each address to its site: the product page, the coaching app, FloorCall Live, Recruit, Beach, Academy and Lessons.
4. Releases: `git push origin main:live` (the app, FloorCall Live and FloorCall Recruit all go out together).

Worked when: getfloorcall.com shows the product page, app.getfloorcall.com opens the app, live.getfloorcall.com shows "Follow the game, point by point", and a made-up address shows "That page isn't here."

## 3. Setup check

In the live app: create an account, then **Settings → Setup check → Run check**. Fix anything marked with "!". It covers the database version, photos and logos storage, sign-up emails, AI, family notifications, team sync and the privacy contact.

## 4. Smoke test (15 minutes, two phones)

On phone A (coach):

1. Create an account and a team. Paste a short roster. Tap **I have permission**.
2. Team tab → **Find logo** for your school; add a photo for one player (frame it, Save photo).
3. Team tab → **Share team page**. Text the link to phone B.
4. Track → start a match against a real nearby school (its logo should appear on its own if Wikipedia knows it). Score a few points.

On phone B (parent):

5. Open the link. The team page shows the logo, the live score and the photo on the Roster tab.
6. Create a free account in the **Get notified** box, then tap **Turn on notifications** (on iPhone: Share → Add to Home Screen first, open from there).
7. Phone A finishes the match. Phone B gets "Final: …" within a minute.

Also: Settings → **Admin** shows your test team, the uploads and no problems. Live tab → **Stream overlay** → Preview shows the score bug; a player's page → **Stat graphic** saves an image.

## Error alerts, uptime and backups

**Error alerts by email.** The app already sends crash reports (error, screen, version; never team data) to the database, and Admin → Problems lists them. The `alerts` function emails you when they spike, and once a day with a short summary.
1. Edge Functions → New function `alerts` → paste `supabase/functions/alerts/index.ts` → turn **off** "Verify JWT" → Deploy.
2. Secrets: `ALERTS_SECRET` (any long random string), `RESEND_API_KEY` (your Resend key), `ALERT_EMAIL` (where alerts go). Optional: `ALERT_MIN` (errors in an hour that count as a spike, default 10).
3. Database → Extensions: turn on `pg_cron` and `pg_net`. Then SQL Editor → run (with your project's URL and the same secret):
   ```sql
   select cron.schedule('floorcall-alerts', '*/15 * * * *', $$ select net.http_post('https://YOUR-PROJECT.supabase.co/functions/v1/alerts', '{"kind":"check"}'::jsonb, '{}'::jsonb, '{"x-alerts-secret":"YOUR ALERTS_SECRET","content-type":"application/json"}'::jsonb) $$);
   select cron.schedule('floorcall-daily', '0 15 * * *', $$ select net.http_post('https://YOUR-PROJECT.supabase.co/functions/v1/alerts', '{"kind":"daily"}'::jsonb, '{}'::jsonb, '{"x-alerts-secret":"YOUR ALERTS_SECRET","content-type":"application/json"}'::jsonb) $$);
   ```
   (`0 15 * * *` is 7 am Pacific.) A spike sends at most one email every 3 hours.

**Uptime.** Make a free monitor at Better Stack (betterstack.com/uptime) or UptimeRobot: check `https://app.getfloorcall.com`, `https://live.getfloorcall.com` and `https://YOUR-PROJECT.supabase.co/auth/v1/health` every few minutes, alerting your phone. Cloudflare → Notifications can also email you about outages on its side.

**Backups.** Supabase's free plan has no backups you can restore. Before launch, upgrade the project to **Pro** (it also stops the weekly pause): Pro keeps daily backups for 7 days (Database → Backups). Add **Point-in-time recovery** later when there are paying customers; it can restore to any minute. Coaches can always save their own copy too (Team tab → Backup), and the app keeps every team on the device as well.
Test a restore once before the season: Database → Backups → restore the newest backup into a **new** project, sign in there and check a team opens.

## 5. After launch

- Delete the old Netlify site once the Cloudflare one works.
- Have a lawyer read the Privacy Policy and Terms before charging money (they cover minors' data).
- Supabase free projects pause after a week without use; upgrade before the season so it never sleeps on a game night.

## MaxPreps import file

MaxPreps has no API for stat apps; every partner gives the coach a `.txt` file to load at Team Admin → Schedule → pencil on the game → Enter Stats → Import Stats.

1. Register FloorCall as a stat supplier: support.maxpreps.com → "Stat Import Partners" → start the registration. A stat supplier link then shows under your MaxPreps account; fill it in. MaxPreps gives you a **supplier ID** and the **volleyball column list**.
2. Put both in `package.json` under `"maxpreps"`: `supplierId`, and `fields` (the column names joined with `|`, in MaxPreps' order; the default there is the usual volleyball list, check it against what they send).
3. Release. Stats → one match now shows **MaxPreps import file** next to the MaxPreps sheet.

## Beach site

FloorCall Beach is built with everything else and lives at `beach.getfloorcall.com`. One step in Cloudflare:
Workers → floorcall → Settings → Domains & Routes → Add → Custom domain → `beach.getfloorcall.com`.
Do this before sharing the link: `getfloorcall.com/beach/` redirects to the beach address, so it does not work until the domain is added.

Beach matches are saved on the device. A scorer with a free account can tap Go live to share a match by link; anyone with the link follows the score with no account (needs database version 21). The site keeps working with no signal after its first load, and a finished match can be sent as a share link.

## Academy site

FloorCall Academy (hitting, setting, serving, serve receive, defense; a version for players and one for coaches) is built with everything else and lives at `academy.getfloorcall.com`. One step in Cloudflare:
Workers → floorcall → Settings → Domains & Routes → Add → Custom domain → `academy.getfloorcall.com`.
It needs no database and no account. Players' checklists stay on their device. A coach's "Add to my practice" opens the coaching app and puts the drill in that team's drill library. The words and drills are in `src/academy/content.ts`.

## Lessons site

FloorCall Lessons (private lessons, small-group training and clinics) is built with everything else and lives at `lessons.getfloorcall.com`. Two steps:
1. Cloudflare: Workers → floorcall → Settings → Domains & Routes → Add → Custom domain → `lessons.getfloorcall.com`.
2. Supabase: run `supabase/schema.sql` again (database version 31 or later). It adds the lesson tables and functions.

Trainers must be verified coaches (Admin console → Coach verification) before they add athletes or schedule. Each athlete has a six-letter code; an athlete or parent joins with it and sees only that athlete's sessions, the notes the trainer shares, and their numbers, never other athletes in a group or clinic. A clinic can have a public sign-up page (anyone with the link, no account); each sign-up waits for the trainer to accept it. Payments are tracked only (paid or not); FloorCall doesn't collect lesson money. The plan is in `docs/LESSONS-PLAN.md`.

## App stores

- **Google Play** ($25 once): play.google.com/console → create the app with package `com.getfloorcall.app`. Build the Android package at pwabuilder.com from `https://app.getfloorcall.com` (Package for stores → Android). Copy the signing key's SHA-256 fingerprint (PWABuilder shows it; Play Console → App integrity has the Play one) into `package.json` → `store.androidSha256`, release, and check `https://app.getfloorcall.com/.well-known/assetlinks.json` lists it. Upload the `.aab`.
- **Apple App Store** ($99 a year): developer.apple.com/programs. pwabuilder.com → Package for stores → iOS gives an Xcode project; it needs a Mac with Xcode to build and upload. Apple reviews every app and can turn down apps that are only a website in a wrapper, so the listing should lead with what the app does offline and with notifications.
