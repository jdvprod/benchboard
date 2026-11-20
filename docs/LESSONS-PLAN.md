# Floorcall Lessons: plan (not built yet)

Private lessons, small-group training and clinics. Written 2026-11-19 from Jason's notes; open questions at the end.

## The shape

- **Its own site, lessons.getfloorcall.com**, like Academy and Beach, because the people in it aren't a team: a
  trainer's athletes come from many clubs and schools, and access is per athlete, not per team.
- **Coaches get there from the coaching app** (a Lessons item in the sidebar and the Floorcall sites menu), and can add
  any player from their team rosters in one tap. A trainer with no team never has to make one.
- **Two views, like Academy**: the trainer's view (schedule, athletes, stat a session) and the athlete's view (my
  sessions, what we're working on, my numbers). Parents see their own child's view.

## Access

- A trainer invites each athlete with a personal link or code. The athlete (or a parent) joins with a Floorcall
  account and sees only their own sessions, focus skills, notes the trainer shares, and their own stats.
- In a group session or clinic, athletes see the time, place and focus, not other athletes' names, contacts or stats.
- Trainer notes are private unless marked "share with athlete".
- Coach verification applies: trainers are verified like head coaches before they can invite minors.

## What the trainer can do

1. **Athletes**: add (name, grad year, position, club/school, parent contact), or pull from a team roster.
2. **Schedule**: one-off or weekly repeating sessions; private, small group or clinic; place, length, capacity, focus
   skills. Send to athletes (in-app, plus text/email with a calendar file).
3. **Stat a session**: pick the focus skills, then tap reps per athlete: serves in/out/ace, passes 3/2/1/0, sets
   on target or off, swings kill/in play/error, digs up/not. Quick, phone-first, like Track's basic mode.
4. **Progress**: each athlete's numbers over sessions (pass average, serve %, kill %) with a chart, and the skills
   they've worked on. Academy pages for each focus skill one tap away, so the athlete can practise at home.
5. **Clinics**: a sign-up page with spots left, a waitlist and a roster for the day (later: payment).

## Data (new tables, schema v31)

- `lesson_athletes` (trainer, name, grad, position, contact, linked accounts)
- `lesson_access` (athlete, user, role athlete/parent): how invites work
- `lesson_sessions` (trainer, start, length, place, kind, capacity, focus skills, athlete ids, notes, shared notes, status)
- `lesson_stats` (session, athlete, reps per skill)
- Row-level security: trainers see their own; an athlete or parent sees only rows for their athlete.

## Pricing (to decide)

Fits the plan doc: a Trainer plan (around $15–19 a month), with the trainer's athletes and parents included.
Taking lesson payments through Floorcall (Stripe Connect) is a later step.

## Questions for Jason

- Can athletes book open time slots themselves, or does the trainer schedule everything?
- Should clinics have a public sign-up page anyone can open?
- Should Floorcall collect lesson payments for trainers, or only track who's paid?
- Name: Floorcall Lessons or Floorcall Training?
