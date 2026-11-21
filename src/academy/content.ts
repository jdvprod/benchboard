/** FloorCall Academy: what to teach and learn for each skill. One source for both views: players read the cues, the
 * self-check and drills they can do on their own; coaches read what to watch for, team concepts and team drills.
 * Plain data, so it's easy to review and extend. Categories match the practice planner's (DRILL_CATEGORIES). */

export type Level = "Beginner" | "Intermediate" | "Advanced";
export type Who = "player" | "coach";
export interface Drill {
  id: string; name: string; who: Who; level: Level; minutes: number;
  /** who and what it takes, e.g. "Alone, a wall" or "Full team, 2 courts" */
  needs: string;
  how: string[];
  /** what to focus on (players) or to coach (coaches) */
  points: string[];
  /** only for girls' or boys' programs (no value: everyone) */
  for?: "girls" | "boys";
}
export interface Skill {
  id: string; name: string; short: string; tagline: string;
  intro: string;
  /** the practice planner category its drills go into */
  category: "Serving" | "Serve receive" | "Setting" | "Attacking" | "Defense";
  /** how FloorCall measures it, and roughly what good looks like in high school */
  stat: { name: string; good: string };
  cues: { title: string; text: string }[];
  steps: { title: string; text: string }[];
  mistakes: { what: string; why: string; fix: string }[];
  watch: { what: string; text: string }[];
  concepts: { title: string; text: string; points?: string[] }[];
  levels: Record<Level, string[]>;
  drills: Drill[];
}

export const SKILLS: Skill[] = [
  {
    id: "serving", name: "Serving", short: "Serve", category: "Serving",
    tagline: "Start every rally on your terms.",
    intro: "The serve is the only skill nobody else touches first. A good server makes the other team pass a hard ball to a bad spot; a great one does it nine times out of ten. Start with a serve you can make every time, then add pace and placement.",
    stat: { name: "Serve in % and aces", good: "Around 90% in for high school; more aces than errors is a strong server" },
    cues: [
      { title: "Set your feet", text: "Feet about shoulder width, the foot opposite your hitting arm in front, pointing at your target. Weight starts on the back foot." },
      { title: "Low toss, in front", text: "Toss with your non-hitting hand, just above where you'll contact it and in front of your hitting shoulder. No spin. A toss that would land on your front toes is right." },
      { title: "Elbow high", text: "Draw your hitting arm back like a bow and arrow: elbow at or above your ear, hand back by your head." },
      { title: "Firm hand, center of the ball", text: "Hit the middle of the ball with the heel of a firm, open hand. For a float serve, keep the wrist stiff and don't snap it." },
      { title: "Finish to your target", text: "Step forward as you swing and finish with your hand pointing at the target. A float serve has a short, punching follow-through." },
    ],
    steps: [
      { title: "Pick a target", text: "Decide where it's going before you toss: a zone, a seam or a player." },
      { title: "Same routine every time", text: "A bounce or two, a breath, the same stance. A routine is what holds up when the score is close." },
      { title: "Toss and step together", text: "Step with your front foot as the ball leaves your hand, so your weight moves forward into the swing." },
      { title: "Swing and contact", text: "Elbow leads, hand comes through the middle of the ball at the top of your reach in front of you." },
      { title: "Follow through and get in", text: "Finish to the target, then move into the court to your defensive spot." },
    ],
    mistakes: [
      { what: "Serves into the net", why: "The toss is drifting behind your head or too low, so you contact the bottom of the ball on the way down.", fix: "Toss slightly higher and in front. Do toss-only reps and let the ball fall: it should land on your front toes." },
      { what: "Serves sail long", why: "Your elbow drops and you hit under the ball, or you lean back.", fix: "Keep the elbow by your ear and stay over the ball. Contact through the middle, not the bottom." },
      { what: "No float, the ball spins", why: "The wrist snaps or the fingers wrap the ball.", fix: "Lock the wrist and contact with the heel of the hand. Stop the hand right after contact." },
      { what: "Misses when it matters", why: "Swinging harder under pressure, or rushing.", fix: "Keep the routine and the same speed of swing. In a tight set, the job is to get it in." },
    ],
    watch: [
      { what: "The toss", text: "Most serving errors start here. If the toss moves, the contact moves. Watch where it would land if the server didn't swing." },
      { what: "Where misses go", text: "Net usually means a low or behind toss or contact under the ball. Long usually means a dropped elbow or leaning back. Wide is the shoulders and the step not pointing at the target." },
      { what: "The routine under pressure", text: "Does the server take the same time and the same steps at 23-24 as at 5-5? Rushed servers miss." },
      { what: "Contact height", text: "Contact should be at the top of the reach in front of the hitting shoulder. Watch for a bent arm at contact." },
    ],
    concepts: [
      { title: "Serve types, in the order to teach them", text: "Each step up adds difficulty for the passer and for the server.", points: ["Underhand: beginners; gets the ball in play.", "Overhand float: the standard serve in high school. No spin, so it moves in the air.", "Topspin: drops fast; harder to keep in.", "Jump float and jump topspin: for advanced servers who already serve in consistently."] },
      { title: "Where to serve", text: "Make the other team's best attackers pass, or serve where passing is hardest.", points: ["Zones 1 and 5, deep: long passes to the setter.", "Seams between passers: who takes it?", "Short to zone 2 or 4: makes the hitter pass and then approach.", "At the weakest passer, every time it's working."] },
      { title: "Serve in first", text: "A missed serve is a free point. Set a team goal for serve-in percentage (around 90% is a good high school target) before chasing aces." },
    ],
    levels: {
      Beginner: ["I can make 8 of 10 underhand serves from the end line", "I can toss the same height and spot 8 times out of 10", "I can make an overhand serve from inside the court"],
      Intermediate: ["I can make 8 of 10 overhand float serves from the end line", "I can serve deep to zone 1 or zone 5 when asked", "I use the same routine for every serve"],
      Advanced: ["I can serve to any zone and the seams on call", "I can make 8 of 10 jump floats or topspin serves", "I serve tough and still serve in at 20 and above"],
    },
    drills: [
      { id: "serve-toss", name: "Toss and catch", who: "player", level: "Beginner", minutes: 5, needs: "Alone, a ball", how: ["Take your serving stance.", "Toss as you would to serve, but don't swing: let the ball fall.", "Note where it lands. 20 tosses."], points: ["It should land on or just in front of your front toes.", "Same height every time.", "No spin on the ball."] },
      { id: "serve-wall", name: "Wall serves to a target", who: "player", level: "Beginner", minutes: 10, needs: "Alone, a wall, tape", how: ["Tape a square on a wall about net height.", "Stand about 20 feet back and serve at the square.", "Count how many of 20 hit it, and move back as you improve."], points: ["Elbow high, firm hand.", "Short follow-through to the square.", "Keep score so you can see progress."] },
      { id: "serve-towels", name: "Towel targets", who: "player", level: "Intermediate", minutes: 15, needs: "Alone or a friend, a court, two towels", how: ["Put a towel in zone 1 and one in zone 5.", "Serve 10 at each from the end line.", "Count serves that land within a step of the towel."], points: ["Pick the target before the toss.", "Point your front foot and shoulders at it.", "Write down your score each time you practice."] },
      { id: "serve-zones", name: "Serve to zones", who: "coach", level: "Intermediate", minutes: 12, needs: "Whole team, both sides of the net", how: ["Split servers between both end lines.", "Before each serve the coach (or a partner) calls a zone: 1, 5, 6 or a seam.", "Partners on the far side track hits and misses."], points: ["Same routine every time; no rushing.", "Front foot and shoulders to the target.", "In first: a miss costs more than a soft serve."] },
      { id: "serve-pressure", name: "Serve under pressure", who: "coach", level: "Intermediate", minutes: 10, needs: "Whole team", how: ["Each player must make 5 serves in a row.", "A miss resets the count to zero.", "Raise the stakes: the team does a sprint for every miss, or the drill ends only when everyone is through."], points: ["Watch the routine when the count is at 4.", "Coach the toss, not the result.", "Talk about breathing and the routine, not about not missing."] },
      { id: "serve-pass-game", name: "Servers vs passers", who: "coach", level: "Advanced", minutes: 15, needs: "Whole team, one court", how: ["Three passers receive on one side; everyone else serves.", "Servers score on an ace or a pass graded 0 or 1. Passers score on a 3 or a 2.", "First side to 15. Rotate passers."], points: ["Servers: tough but in.", "Passers: read the server and move feet first.", "Grade every pass out loud so everyone learns the scale."] },
    ],
  },
  {
    id: "passing", name: "Serve receive", short: "Pass", category: "Serve receive",
    tagline: "The first contact decides the offense.",
    intro: "Passing a serve well gives your setter every option: a quick middle, a back set, a hitter in rhythm. A shanked pass gives the other team a free point. Good passers move their feet first and keep their arms quiet.",
    stat: { name: "Pass average (0 to 3)", good: "2.0 is solid in high school; 2.3 and above is excellent" },
    cues: [
      { title: "Ready before the toss", text: "Feet wider than your shoulders, knees bent, weight forward on the balls of your feet, arms relaxed out in front. Be ready before the server tosses." },
      { title: "Read the server", text: "Watch the toss, the shoulder and the arm. Where they face and how they swing tell you where the ball is going and how fast." },
      { title: "Feet first, then arms", text: "Move to get your body behind the ball and stop before it arrives. Don't reach with your arms." },
      { title: "Platform early and flat", text: "Hands together, thumbs side by side pointing down, elbows straight, forearms flat. Make the platform early and hold it." },
      { title: "Angle to the target", text: "Point the platform at your setter by turning your shoulders and dropping the shoulder away from the target. Don't swing your arms." },
    ],
    steps: [
      { title: "Read", text: "Server's toss, shoulder and swing." },
      { title: "Move", text: "Shuffle or crossover to get behind the ball. Call it early: \"Mine.\"" },
      { title: "Stop and set", text: "Feet set, body still and low when the ball arrives." },
      { title: "Contact", text: "Ball on the forearms, above the wrists, out in front between the knees." },
      { title: "Freeze to the target", text: "Hold the platform pointed at the setter. If you finish to the target, the ball went there." },
    ],
    mistakes: [
      { what: "Passes fly too high or over the net", why: "Swinging the arms adds power the serve already has.", fix: "Quiet arms. Let the ball bounce off an angled platform and use your legs only on slow serves." },
      { what: "Shanks off to the side", why: "Reaching sideways instead of moving, so the platform faces the wrong way.", fix: "Move your feet to get behind the ball. If you're late, drop the inside shoulder so the platform still faces the target." },
      { what: "Ball hits wrists or hands", why: "Standing too tall or contacting too late.", fix: "Stay low and contact out in front. Your platform should meet the ball, not wait for it." },
      { what: "Aces in the seams", why: "Nobody calls it, or both go for it.", fix: "Call early and loud. Agree on a seam rule as a team so there's never a question." },
    ],
    watch: [
      { what: "Feet at contact", text: "Is the passer stopped and balanced when the ball arrives? Passers still moving at contact are inconsistent." },
      { what: "Platform angle, not swing", text: "Good passers aim with the shoulders. Watch for arms swinging up through contact." },
      { what: "Read and first step", text: "The best passers move before the ball crosses the net. Late first steps mean reaching." },
      { what: "Communication", text: "Listen for an early call on every serve, and for seam balls especially." },
    ],
    concepts: [
      { title: "Grading passes 0 to 3", text: "The scale FloorCall uses, and most programs do. Grade out loud in practice so players learn it.", points: ["3: perfect. The setter can run every option, including the quick middle.", "2: good. The setter has to move; the quick may be gone.", "1: poor. One option, usually a high ball to the outside.", "0: an ace, an overpass, or a ball the setter can't play."] },
      { title: "Receive formations", text: "Fewer passers means your best passers take more balls.", points: ["5-person W: for beginners; everyone covers a small area.", "4-person: common in middle school and JV.", "3-person: the standard at higher levels; the three best passers cover the court and hitters are free to approach."] },
      { title: "The passing target", text: "Aim a little right of the middle of the court and a step or two off the net, where the setter stands. A pass slightly off the net is better than one that's tight to it." },
    ],
    levels: {
      Beginner: ["I can pass a tossed ball to a target 7 of 10 times", "My platform is flat with thumbs together and elbows straight", "I'm in ready position before the server tosses"],
      Intermediate: ["I can pass easy serves to the target and average 2.0", "I move my feet before I reach", "I call the ball early every time"],
      Advanced: ["I average 2.3 or better against tough serves", "I can pass a ball outside my body by dropping my shoulder", "I take seam balls without hesitation"],
    },
    drills: [
      { id: "pass-wall", name: "Wall passing", who: "player", level: "Beginner", minutes: 10, needs: "Alone, a wall", how: ["Stand about 8 feet from a wall.", "Pass the ball against the wall above head height, again and again.", "Count your longest streak. Then try alternating high and low."], points: ["Platform flat and early.", "Use your legs, not an arm swing.", "Stay low between contacts."] },
      { id: "pass-toss", name: "Partner toss and pass", who: "player", level: "Beginner", minutes: 10, needs: "A partner", how: ["Partner tosses from about 20 feet, a little to your left or right.", "Move, stop, and pass back to the partner's hands.", "20 reps, then switch."], points: ["Move your feet before you form the platform.", "Freeze your platform pointed at the target.", "Your partner grades each pass 0 to 3."] },
      { id: "pass-shuffle", name: "Shuffle and pass footwork", who: "player", level: "Intermediate", minutes: 8, needs: "Alone, no ball", how: ["From ready position, shuffle two steps right and stop in a passing position.", "Back to center, then two steps left.", "Add a crossover step for balls that are farther away. 3 sets of 30 seconds."], points: ["Stay low the whole time; don't bob up and down.", "Stop completely before you 'pass'.", "Hips face the target at the stop."] },
      { id: "pass-butterfly", name: "Butterfly passing", who: "coach", level: "Beginner", minutes: 12, needs: "Whole team, one court", how: ["Servers at one end line, passers in the back row across the net, a target at the setter spot.", "Serve, pass to the target, then everyone follows the ball: server to passer, passer to target, target to the serving line.", "Keep a team count of good passes."], points: ["Passers stopped and set at contact.", "Grade passes out loud.", "Keep the line moving; lots of reps."] },
      { id: "pass-three", name: "Three-person receive with grades", who: "coach", level: "Intermediate", minutes: 15, needs: "Whole team", how: ["Three passers in your match formation; the rest serve tough.", "Every pass is graded 0 to 3 and added up.", "Passers rotate out after 10 serves. Track each passer's average."], points: ["Calls on every ball.", "Seam rule enforced.", "Feet first, quiet arms."] },
      { id: "pass-pressure", name: "Pass to win", who: "coach", level: "Advanced", minutes: 12, needs: "Whole team", how: ["Passing team needs a set number of 3s (say 7) before servers get 7 aces or 0-passes.", "Servers serve tough.", "Add consequences for the losing side."], points: ["Composure: the same platform whatever the score.", "Read the server's toss.", "Celebrate the 3s."] },
    ],
  },
  {
    id: "setting", name: "Setting", short: "Set", category: "Setting",
    tagline: "Put the ball where hitters can score.",
    intro: "A good set lets your hitters take a full swing. Setters get there early, face the target and use their whole body, not just their hands. Consistency comes first: the same set, in the same place, every time.",
    stat: { name: "Assists and ball-handling errors", good: "Assists per set climb with your hitters; ball-handling errors should be rare" },
    cues: [
      { title: "Get there early", text: "Beat the ball to where it's going and stop. A setter who's still running at contact can't be accurate." },
      { title: "Square to the target", text: "Face where you're setting. For a front set to the outside, your shoulders point at left front and your right foot is slightly forward." },
      { title: "Hands up early", text: "Raise your hands above your forehead before the ball arrives, fingers spread and relaxed, thumbs and pointer fingers making a window." },
      { title: "Contact above the forehead", text: "Take the ball on the pads of your fingers just above and in front of your forehead." },
      { title: "Extend through the target", text: "Push with your legs and arms together and finish with your arms extended toward where the ball is going." },
    ],
    steps: [
      { title: "Read the pass", text: "Move as soon as you see where the pass is going." },
      { title: "Get to the spot and stop", text: "Right foot slightly forward, right hip toward the net, facing left front." },
      { title: "Hands up", text: "Hands to the window above your forehead before the ball arrives." },
      { title: "Absorb and push", text: "Let the ball sink into your fingers for an instant, then push out with legs and arms." },
      { title: "Finish to the target", text: "Arms extended, hands following the ball. Then cover your hitter." },
    ],
    mistakes: [
      { what: "Called for a double or a lift", why: "Hands arrive late, or the ball is caught low in the palms.", fix: "Hands up early, contact on the finger pads, and release both hands together." },
      { what: "Sets come out flat or short", why: "Contact in front of the chest, or only the arms push.", fix: "Contact above the forehead and drive with your legs." },
      { what: "Sets drift toward the net or off it", why: "Not square to the target, or the hips face the net.", fix: "Get there early and square up before the ball arrives." },
      { what: "Back sets fall short", why: "Pushing straight up instead of back.", fix: "Contact a little more over your head, arch your back and push up and behind you." },
    ],
    watch: [
      { what: "Footwork to the target", text: "Is the setter beating the ball and stopping, right foot forward? Late feet show up as inaccurate sets." },
      { what: "Hand position at contact", text: "Hands should be set before the ball arrives, with contact above the forehead." },
      { what: "Location", text: "A high outside set should come down about an arm's length off the net near the antenna. Track where sets land, not just whether they're hittable." },
      { what: "Decisions", text: "Is the setter feeding the hot hitter, and using the middle when passes are good?" },
    ],
    concepts: [
      { title: "Offense systems", text: "How many setters you run shapes everything else.", points: ["5-1: one setter in all six rotations. Most consistent, needs a strong setter.", "6-2: two setters who set from the back row, so you always have three front-row hitters.", "4-2: two setters who set from the front row; simpler, common for beginners."] },
      { title: "Set names", text: "Most programs number sets by where along the net and how high. Agree on your team's names and use them every time.", points: ["A high set to the outside (often called a 4 or a 5).", "A quick set to the middle (often a 1).", "A back set to the right side (often a 5 or a 2, depending on the system)."] },
      { title: "Setter dumps", text: "A front-row setter can attack the second ball with a tip over the net. Used sparingly, it keeps the blockers honest." },
    ],
    levels: {
      Beginner: ["I can self-set 20 in a row", "I can set a tossed ball to a target 7 of 10 times", "My hands are up before the ball arrives"],
      Intermediate: ["I can front set and back set off a pass", "I square up to my target before contact", "I rarely get called for doubles or lifts"],
      Advanced: ["I can jump set", "I can set quick middles off good passes", "I can set a hittable ball from an off-the-net pass"],
    },
    drills: [
      { id: "set-self", name: "Self-sets", who: "player", level: "Beginner", minutes: 5, needs: "Alone, a ball", how: ["Set the ball straight up to yourself, about 3 feet above your hands.", "Count your longest streak.", "Then alternate a low set and a high set."], points: ["Contact above your forehead every time.", "Fingers relaxed, both hands release together.", "Use your legs, not just your arms."] },
      { id: "set-wall", name: "Wall sets", who: "player", level: "Beginner", minutes: 10, needs: "Alone, a wall", how: ["Stand 3 feet from a wall and set against it above head height.", "Count the longest streak.", "Move back to 6 feet and repeat."], points: ["Quick, clean hands.", "Stay under the ball.", "Keep it on one spot on the wall."] },
      { id: "set-target", name: "Set to a target", who: "player", level: "Intermediate", minutes: 15, needs: "A partner or a wall, a target such as a hoop or basket", how: ["Partner tosses to you at the setter spot.", "Set high to the target near the outside antenna.", "Count how many of 20 drop into or by the target, then add back sets."], points: ["Feet to the spot first, then square up.", "Same height and spot every time.", "Finish your arms to the target."] },
      { id: "set-triangle", name: "Setter target from passes", who: "coach", level: "Intermediate", minutes: 15, needs: "Setters plus passers and a feeder", how: ["Coach serves or tosses to passers; setters set to targets (a catcher, a hoop) at left front and right side.", "Score by location: in the target, close, or off.", "Rotate setters every 10 reps."], points: ["Footwork to the target before the hands.", "Read the pass early.", "Same set, same spot."] },
      { id: "set-off", name: "Off-the-net setting", who: "coach", level: "Advanced", minutes: 10, needs: "Setters, a feeder", how: ["Feed bad passes: deep, tight to the net, off to the side.", "The setter must set a hittable high ball outside.", "Then add a non-setter setting the second ball."], points: ["Turn and face the target, even off a bad pass.", "Height buys the hitter time.", "Bump set when it's too low to hand set."] },
    ],
  },
  {
    id: "hitting", name: "Hitting", short: "Hit", category: "Attacking",
    tagline: "Approach, jump, swing, score.",
    intro: "Hitting is a full-body skill: an approach that turns speed into height, an arm swing that turns height into power, and a contact you control. Most hitting problems are timing and footwork, not the arm.",
    stat: { name: "Hitting % (kills minus errors, over attempts)", good: ".200 is good for a high school hitter; .300 and above is excellent" },
    cues: [
      { title: "Wait for the set", text: "Start your approach when you can see where the set is going. For a high outside set, that's about when it reaches its peak." },
      { title: "Slow to fast", text: "The approach gets faster each step. The last two steps are the biggest and quickest: for a right-hander, right then left." },
      { title: "Arms back, then up", text: "Swing both arms back on the big next-to-last step, then drive them up as you jump." },
      { title: "Bow and arrow", text: "Hitting elbow high and back, the other arm reaching up toward the ball. Then rotate and swing." },
      { title: "Contact high and in front", text: "Hit the ball at the top of your reach, in front of your hitting shoulder, with an open hand, and snap your wrist over the top." },
    ],
    steps: [
      { title: "Read the set", text: "Stay back off the net, outside the court for outside sets." },
      { title: "Approach", text: "Right-handers: right, left, right-left (4 steps), or left, right-left (3). Left-handers do the opposite." },
      { title: "Plant", text: "Heel to toe on the last two steps, turning your forward speed into up." },
      { title: "Jump and swing", text: "Arms up, bow and arrow, swing through the ball." },
      { title: "Land and cover", text: "Land on both feet, balanced, and get ready for the next ball." },
    ],
    mistakes: [
      { what: "Always under the ball", why: "Starting the approach too early.", fix: "Wait longer. Start when the set is at its peak; the approach is faster than it feels." },
      { what: "Drifting into the net", why: "A flat, fast approach that turns into a broad jump.", fix: "Make the last step long and plant heel to toe so you go up, not forward." },
      { what: "Hitting long", why: "The ball gets behind your head.", fix: "Approach so the ball stays in front of your hitting shoulder; contact it in front." },
      { what: "No power, or hitting the net", why: "A dropped elbow and arm swing that comes from the side.", fix: "High elbow and contact at full reach. Practice arm swings against a wall." },
    ],
    watch: [
      { what: "Approach timing", text: "Most hitting problems are here. Are hitters waiting for the set, then accelerating?" },
      { what: "The last two steps", text: "Long, fast and heel to toe. Short last steps kill height." },
      { what: "Arm swing path", text: "Elbow high, bow and arrow, contact in front. Watch for a low, sideways arm." },
      { what: "Landing", text: "Both feet, balanced, not drifting under the net. It's the biggest injury risk in the sport." },
    ],
    concepts: [
      { title: "Shots to teach", text: "A hitter with more than one shot is harder to defend.", points: ["Line: down the sideline past the block.", "Cross-court: sharp angle away from the block.", "Tip: soft over or around the block into an open spot.", "Roll shot: a slower topspin ball to the deep corner.", "Off the block (tool): hit the outside of the blocker's hands so it goes out."] },
      { title: "Tempo", text: "Faster sets beat the block but need better passes and timing. Most teams run a high outside, a quick middle and a back set, and speed them up as players develop." },
      { title: "Footwork by position", text: "Outside hitters approach from outside the court at an angle; middles approach straight in; right-side hitters adjust to where the setter is." },
    ],
    levels: {
      Beginner: ["I can do a 3-step approach and jump with both arms", "I can hit a tossed ball over the net", "I land on both feet"],
      Intermediate: ["I can do a 4-step approach with good timing", "I can hit line and cross-court when asked", "I have a tip and a roll shot"],
      Advanced: ["I can hit around or off the block", "I can hit faster sets", "I hit .250 or better in matches"],
    },
    drills: [
      { id: "hit-footwork", name: "Approach footwork", who: "player", level: "Beginner", minutes: 10, needs: "Alone, no ball", how: ["Mark a spot as the net.", "Do slow approaches: right, left, right-left, then jump with arms.", "10 slow, 10 at full speed. Lefties reverse the feet."], points: ["Slow to fast.", "Last two steps biggest.", "Arms back on the next-to-last step."] },
      { id: "hit-wall", name: "Wall spikes", who: "player", level: "Beginner", minutes: 8, needs: "Alone, a wall", how: ["Stand about 10 feet from a wall.", "Hit the ball down so it bounces off the floor, then the wall, and comes back to you.", "Keep it going as long as you can."], points: ["Elbow high.", "Contact in front, snap the wrist over the top.", "Use your whole arm, not just the wrist."] },
      { id: "hit-toss", name: "Toss and hit", who: "player", level: "Intermediate", minutes: 15, needs: "A partner, a net", how: ["Partner tosses a high ball near the net from the setter spot.", "Approach and hit.", "Call your shot before the toss: line, cross or tip."], points: ["Wait for the toss to peak before you go.", "Ball in front of your hitting shoulder.", "Land on both feet."] },
      { id: "hit-lines", name: "Hitting lines", who: "coach", level: "Beginner", minutes: 15, needs: "Hitters in lines at left front and right side, a setter or tosser", how: ["Toss or set to each line in turn.", "Hitters approach, hit and shag their own ball, then switch lines.", "Progress from a toss to a setter to a pass-set-hit."], points: ["Approach timing.", "High elbow, contact in front.", "Full approach every rep."] },
      { id: "hit-block", name: "Hitting against a block", who: "coach", level: "Advanced", minutes: 15, needs: "Hitters, a setter, one or two blockers", how: ["Set to the outside against one or two blockers.", "Hitters must score with line, cross, tip or off the block.", "Score kills and errors; track hitting % for the drill."], points: ["See the block before you swing.", "Swinging hard into the block is an error, not a kill.", "Reward smart shots, not just hard ones."] },
    ],
  },
  {
    id: "defense", name: "Defense", short: "Dig", category: "Defense",
    tagline: "Keep the ball off the floor.",
    intro: "Defense is reading and being in the right place at the right moment: low, balanced and still when the hitter contacts. Most digs are made by players who were already there.",
    stat: { name: "Digs per set and dig success", good: "Dig success climbs as reading improves; the team leader often has 3 or more digs a set" },
    cues: [
      { title: "Low and wide", text: "Feet wider than shoulders, knees bent, weight forward, arms out in front and apart. Lower than you think." },
      { title: "Read the hitter", text: "Watch the hitter's approach angle, shoulders and arm, not the ball. They tell you where it's going." },
      { title: "Still at contact", text: "Be stopped and balanced when the hitter swings. You can't react while you're still moving." },
      { title: "Dig up and to the middle", text: "Aim high and to the middle of the court so your setter, or anyone, can play it." },
      { title: "Absorb hard hits", text: "Don't swing at hard balls. Let them rebound off a platform angled up, and give a little with your arms." },
    ],
    steps: [
      { title: "Start in base", text: "Your spot before the set." },
      { title: "Read the set and hitter", text: "Where is the set going, and what is the hitter's approach telling you?" },
      { title: "Move to your read spot", text: "Get there and stop before the hitter contacts." },
      { title: "Dig", text: "Low platform, angled up, ball to the middle." },
      { title: "Transition", text: "Get off the floor and get ready to attack or cover." },
    ],
    mistakes: [
      { what: "Frozen, then late", why: "Standing tall and watching the ball instead of the hitter.", fix: "Stay low and read the hitter's shoulders. Move on the set, stop for the swing." },
      { what: "Digs fly out of the court", why: "Swinging at a hard-hit ball.", fix: "Absorb: quiet arms, platform angled up. The ball already has the speed." },
      { what: "Tips drop in front of you", why: "Weight back on the heels.", fix: "Weight forward and expect the tip; call it and go." },
      { what: "Diving without moving", why: "Leaving your feet too early.", fix: "Run first, then dive or sprawl only when you can't get there on your feet." },
    ],
    watch: [
      { what: "Posture at contact", text: "Defenders should be low and still when the hitter swings. Moving at contact means late digs." },
      { what: "Read positions", text: "Are defenders adjusting from base to the right spot for each set and hitter, around the block?" },
      { what: "Dig height and location", text: "A good dig goes up and to the middle. Track where digs go, not only whether they're up." },
      { what: "Pursuit", text: "Do players chase balls off the court, and do teammates go with them?" },
    ],
    concepts: [
      { title: "Defensive systems", text: "Pick one and teach it until it's automatic.", points: ["Perimeter: back-row defenders deep and around the edges; the off-blocker covers tips. Good against hard-hitting teams.", "Rotational: defenders rotate toward the hitter's side, with the line digger moving up for tips.", "Man-up: a back-row player plays up behind the block for tips; useful against tipping teams."] },
      { title: "Block and defense together", text: "The block takes one part of the court away; the diggers cover the rest. Decide whether your block is taking line or cross, and position defense around it." },
      { title: "Base vs read", text: "Base is where defenders start before the set; read is where they move once they see the set and the hitter. Teach both positions for every rotation." },
    ],
    levels: {
      Beginner: ["I can dig a down ball to a target 6 of 10 times", "I'm low and still when the hitter contacts", "I call 'mine' on balls coming to me"],
      Intermediate: ["I can dig a coach's hits up to the middle", "I move from base to read on every set", "I go for tips and call them"],
      Advanced: ["I read hitters and get there before the swing", "I can sprawl or dive to save a ball", "I dig hard driven balls up and playable"],
    },
    drills: [
      { id: "dig-wall", name: "Wall digs", who: "player", level: "Beginner", minutes: 10, needs: "Alone, a wall", how: ["Throw or hit the ball hard against a wall.", "Dig the rebound up in front of you.", "Catch, reset, repeat. 20 reps, then harder."], points: ["Low and wide before the ball comes off the wall.", "Platform angled up.", "Absorb; no arm swing."] },
      { id: "dig-reaction", name: "Reaction catches", who: "player", level: "Beginner", minutes: 5, needs: "A partner", how: ["In ready position, a partner drops a ball from shoulder height to your left or right.", "Step and catch it before it bounces twice.", "Partner moves farther away as you improve."], points: ["Stay low; push off, don't stand up.", "First step is quick and short.", "Eyes on the hand, not the floor."] },
      { id: "dig-pepper", name: "Pepper", who: "player", level: "Intermediate", minutes: 10, needs: "A partner", how: ["Pass, set, hit with a partner, back and forth.", "Hits are controlled down balls.", "Count your longest rally."], points: ["Dig to your partner, up and in front.", "Be still when they swing.", "Every contact has a purpose."] },
      { id: "dig-box", name: "Coach on a box", who: "coach", level: "Intermediate", minutes: 15, needs: "Defenders, a coach hitting from a box at the net", how: ["Coach stands on a box at left or right front and hits at defenders in their spots.", "Defenders dig to the target; a setter can set the dig.", "Mix hard hits, roll shots and tips."], points: ["Low and still at contact.", "Dig to the middle, high.", "Read the coach's arm and shoulder."] },
      { id: "dig-transition", name: "Dig to attack", who: "coach", level: "Advanced", minutes: 15, needs: "Full team, one court", how: ["Coach attacks from a box on one side; the defense digs, sets and attacks back.", "Score a point for each successful dig-set-kill.", "Add blockers and rotate positions."], points: ["Defense into offense without stopping.", "Hitters off the net after the dig, ready to approach.", "Talk: who takes the second ball when the setter digs?"] },
    ],
  },
];

export const skill = (id: string) => SKILLS.find((s) => s.id === id);
/** Every item a player can check off for a skill. */
export const checks = (s: Skill) => (["Beginner", "Intermediate", "Advanced"] as Level[]).flatMap((l) => s.levels[l].map((t, i) => `${s.id}:${l}:${i}`));

/* ---------- the full drill library ---------- */
import { PASSING, SERVING, SETTING } from "./library-a";
import { BLOCKING, DEFENSE, HITTING, TEAM } from "./library-b";
import { MORE } from "./library-c";
import { STRENGTH } from "./strengthData";
import { MENTAL_DRILLS } from "./mentalData";
const EXTRA: Record<string, Drill[]> = { serving: [...SERVING, ...MORE.serving], passing: [...PASSING, ...MORE.passing], setting: [...SETTING, ...MORE.setting], hitting: [...HITTING, ...MORE.hitting], defense: [...DEFENSE, ...MORE.defense] };
for (const s of SKILLS) for (const x of EXTRA[s.id] || []) if (!s.drills.some((y) => y.id === x.id)) s.drills.push(x);
const LEVEL_ORDER: Record<Level, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };
for (const s of SKILLS) s.drills.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

/** Every area of the library: the five skills, plus blocking and team drills (which have no skill page of their own). */
export interface Area { id: string; name: string; category: string; drills: Drill[]; skill?: Skill }
export const AREAS: Area[] = [
  ...SKILLS.map((s) => ({ id: s.id, name: s.name, category: s.category, drills: s.drills, skill: s })),
  { id: "blocking", name: "Blocking", category: "Blocking", drills: [...BLOCKING, ...MORE.blocking].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) },
  { id: "team", name: "Team and game play", category: "Game play", drills: [...TEAM, ...MORE.team].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) },
  { id: "mental", name: "The mental game", category: "Team talk", drills: [...MENTAL_DRILLS].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) },
  { id: "strength", name: "Strength and jumping", category: "Conditioning", drills: [...STRENGTH].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) },
];
export type LibDrill = Drill & { area: string; areaName: string; category: string };
export const LIBRARY: LibDrill[] = AREAS.flatMap((a) => a.drills.map((x) => ({ ...x, area: a.id, areaName: a.name, category: a.category })));
export const LEVELS: Level[] = ["Beginner", "Intermediate", "Advanced"];

/** Which drills someone sees. Today (billing off) everyone sees everything. Once billing is on: a player with their
 * own Player plan, or a coach, sees every drill; a player covered only by a team sees the drills their coach picked
 * (and the skill guides). Pure. */
export function visibleDrills(all: LibDrill[], o: { billing: boolean; coach: boolean; ownPlan: boolean; picks: string[] }): LibDrill[] {
  if (!o.billing || o.coach || o.ownPlan) return all;
  return all.filter((x) => o.picks.includes(x.id));
}
