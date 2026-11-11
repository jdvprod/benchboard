# Launching Floorcall

Do these in order. Each step says how to know it worked. About an hour the first time.

## 0. Fill in the blanks (5 minutes)

In `package.json`:

- `legal.email`: the address families and schools write to about their data (for example hello@getfloorcall.com). **Required.**
- `legal.owner`: your name or business name, as it should appear in the Privacy Policy and Terms.
- `legal.state`: the state whose law governs the Terms.
- `site.url`: set to https://getfloorcall.com. Link previews in texts and social posts use it.

Then run `npm run launch-check`. Everything should say `ok` (the `site.url` line can stay a warning until the domain is set up).

## 1. Supabase (the database and accounts)

1. **SQL Editor → New query**: paste all of `supabase/schema.sql` → **Run**. Safe to run again any time. This is version 16: it also makes the `media` storage for photos and logos, the `film` storage for team film sessions, crash reports, the admin console, and the account and film-session functions.
2. **Authentication → URL Configuration**: Site URL = `https://app.getfloorcall.com`. Redirect URLs: add `https://app.getfloorcall.com/**`, `https://live.getfloorcall.com/**` and `https://recruit.getfloorcall.com/**`.
3. **Emails (required before launch).** Sign-up confirmation, password resets and the new-device sign-in code all go by email, and Supabase's built-in email only reaches your own team, a couple an hour.
   - Make a free **Resend** account (resend.com) → **Domains → Add domain** `getfloorcall.com` → add the DNS records it shows in Cloudflare (DNS → Records) → wait for **Verified**. Then **API Keys → Create** (sending access).
   - Supabase **Authentication → Emails → SMTP Settings** → Enable custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = that API key, sender `no-reply@getfloorcall.com`, name `Floorcall`.
   - **Authentication → Emails → Templates**: paste each file from `supabase/email-templates/` (Confirm signup, Magic Link, Reset password, Change email). The Magic Link one carries the 6-digit code for new devices.
   - **Authentication → Sign In / Providers → Email**: turn **Confirm email** on.
   - **Authentication → Rate Limits**: raise "emails sent per hour" to about 100.
4. **Edge Functions → Deploy a new function → Via Editor**:
   - `ai`: paste `supabase/functions/ai/index.ts` and turn **off** "Verify JWT" (the function checks the sign-in itself). Secret: `ANTHROPIC_API_KEY`.
   - `notify`: paste `supabase/functions/notify/index.ts`, and turn **off** "Verify JWT" for it. Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (make them in the app: Settings → Setup check → Make notification keys) and `VAPID_SUBJECT` (`mailto:` + your contact email).

5. **Make yourself an admin** (SQL Editor, after you've created your account in the app):
   `insert into public.admins select id from auth.users where email = 'you@example.com';`
   Settings in the app then shows **Admin**: sign-ups, active teams, live matches, crash reports, and every uploaded photo and logo with a **Take down** button.

## 2. Cloudflare (the website)

1. **Workers & Pages → Create → Import a repository** → `jdvprod/benchboard`, project name `floorcall`.
2. Build command `npm run build`, deploy command `npx wrangler deploy`, production branch `live`.
3. Under the Worker's **Settings → Domains & Routes → Add → Custom domain**, add all five: `getfloorcall.com`, `www.getfloorcall.com`, `app.getfloorcall.com`, `live.getfloorcall.com`, `recruit.getfloorcall.com`. `worker/index.js` sends each address to its site: the product page, the coaching app, Floorcall Live and Floorcall Recruit.
4. Releases: `git push origin main:live` (the app, Floorcall Live and Floorcall Recruit all go out together).

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

## 5. After launch

- Delete the old Netlify site once the Cloudflare one works.
- Have a lawyer read the Privacy Policy and Terms before charging money (they cover minors' data).
- Supabase free projects pause after a week without use; upgrade before the season so it never sleeps on a game night.
