/** FloorCall Academy → The mental game: reading the game, making faster decisions, handling pressure and bad days,
 * and being a good teammate and leader. Each topic has the ideas, drills that train them (on your own or with a team),
 * and situation questions to test yourself, each with the best answer and why. Plain data, easy to review. */
import { WORK_TOPICS } from "./workData";
import type { Drill, Level } from "./content";

export type MentalId = "read-game" | "read-block" | "blocking-reads" | "speed" | "pressure" | "bounce-back" | "focus" | "leader" | "teammates" | "talk" | "prepare" | "role" | "coachable" | "better-ball" | "setter-iq" | "growth" | "work-basics" | "line-judge" | "scorekeeper" | "libero-tracker" | "down-ref";
export interface Question { q: string; options: string[]; answer: number; why: string; level: Level }
export interface MentalTopic { id: MentalId; name: string; kind: "Game IQ" | "Mindset" | "Team" | "Work team"; tagline: string; intro: string; ideas: { title: string; text: string }[]; drills: Drill[]; questions: Question[] }

const B: Level = "Beginner", I: Level = "Intermediate", A: Level = "Advanced";
const d = (id: string, name: string, who: "player" | "coach", level: Level, minutes: number, needs: string, how: string[], points: string[]): Drill =>
  ({ id: "mnd-" + id, name, who, level, minutes, needs, how, points });
const q = (level: Level, question: string, options: string[], answer: number, why: string): Question => ({ q: question, options, answer, why, level });

const BASE: MentalTopic[] = [
  {
    id: "read-game", name: "Reading the game", kind: "Game IQ", tagline: "See the play before it happens.",
    intro: "Good readers aren't faster; they start sooner. Every touch gives away where the next one is going: the pass tells you what the setter can do, the setter's body tells you where the set is going, and the hitter's approach tells you where the swing is going. Learn the order to watch, and you'll be moving while others are still reacting.",
    ideas: [
      { title: "Watch in order", text: "Ball → passer → setter → hitter. Look at the ball only when it's coming to you or about to be hit; in between, watch the player who will touch it next." },
      { title: "The pass sets the menu", text: "A perfect pass means anything can happen (quicks, back sets, slides). A pass off the net or to the 10-foot line usually means a high set to the outside or the right side." },
      { title: "The setter's tells", text: "Ball contact in front of the forehead often goes forward; over the head or behind can mean a back set. Shoulders, hips and how square the setter is give it away. Setters who jump on a bad pass often dump or set quick." },
      { title: "The hitter's tells", text: "Approach angle, shoulder line and where the ball is compared to the hitter's body tell you line or angle. A ball inside the hitter's shoulder is hard to hit line; a ball outside it is hard to hit sharp angle." },
      { title: "Know the tendencies", text: "Most hitters have a favorite shot, especially when tired or under pressure. Scouting (FloorCall's scouting and opponent pages) tells you what they did last time." },
    ],
    drills: [
      d("freeze-read", "Freeze and predict", "coach", B, 10, "Team, a coach with a ball",
        ["Coach tosses to a setter who sets one of three places. Just before the setter touches the ball, coach yells 'Freeze!'", "Everyone points where the set is going.", "Then the setter sets it. Keep score of right guesses."],
        ["Point with your body, not just a finger: turn to where you think it's going.", "Ask players what they saw: hands, shoulders, feet.", "Speed up the 'Freeze' call as players get better."]),
      d("film-pause", "Film pause game", "player", B, 15, "Alone or a friend, any match video (FloorCall Film Room works)",
        ["Play a rally and pause right as the setter touches the ball.", "Say where the set is going and why. Play to check.", "Do 20 sets. Then pause at the hitter's contact and predict the shot."],
        ["Write down what gave it away (setter contact point, hips, a hitter's approach).", "Watch your own team's setter, then a college match.", "Getting better at this on video carries straight to the court."]),
      d("call-it", "Call it out loud", "coach", I, 15, "Team, 6 v 6 or 3 v 3",
        ["During a drill or scrimmage, every defender must call out the set location ('Four! Pipe! Quick!') the moment they read it.", "The coach listens for who calls first and who's right.", "Add a point for the team that calls the most sets right."],
        ["Saying it forces you to commit to a read early.", "Loud and early beats quiet and right.", "Use FloorCall's Track to see if defense improves as reads get earlier."]),
    ],
    questions: [
      q(A, "Rotation 1, their setter is in right back and just penetrated after a perfect pass. Their opposite is front row on the left side. Before the set, which attackers should your blockers be counting?", ["Only the outside hitter: the setter is back row", "Three: the left-side opposite, the middle and the right-side outside or a back-row pipe", "Two: middle and outside", "One: the opposite"], 1, "With the setter in the back row, there are three front-row attackers, plus a possible back-row attack. Counting them before the set tells blockers how spread they must be."),
      q(A, "The opposing setter has dumped twice when they jumped on a tight pass in rotation 4. In the same rotation the pass is tight again and the setter jumps. What's the best adjustment for your right-front blocker?", ["Leave the net early to dig", "Stay home and be ready to block or play the dump, with the off-blocker shading the short middle", "Commit on the middle hitter", "Back off three steps"], 1, "Tendencies repeat. Staying home on the setter in that situation takes away the dump without giving up a block."),
      q(A, "A hitter's approach starts late and slow, and their last step is short. What's the most likely attack?", ["A full swing down the line", "An off-speed shot or a tip", "A back-row attack", "A quick set"], 1, "Late, short, slow approaches limit the swing, so off-speed and tips become likely. Defenders shade forward."),
      q(I, "You're in left back. Their outside hitter is hitting from a set that's tight to the net and inside the antenna. Where should you expect the ball most often?", ["Deep line", "Sharp angle or a tip, because a tight set is hard to swing high and deep", "Deep middle", "Off the back wall"], 1, "Tight sets often produce sharp angles, wipes off the block or tips rather than deep shots."),
      q(I, "Their setter is in the back row and the pass is perfect. How many front-row attackers should blockers expect?", ["One", "Three", "None", "Two"], 1, "With the setter in the back row, all three front-row players can attack. Call 'Three up!'."),
      q(A, "Their outside hitter approaches from wide outside the court, very square to the net. Which shot is most likely?", ["Sharp angle", "Line", "A tip to the middle", "A back-row attack"], 1, "A wide, square approach sets up the line. An approach from inside the court usually goes cross-court."),
      q(B, "The pass goes to the 10-foot line, far from the net. What set is most likely?", ["A quick set to the middle", "A high set to the outside or right side", "A setter dump", "A back-row pipe off a fast tempo"], 1, "From a pass off the net, quicks and dumps are hard. Most setters go high to a pin. Defenders and blockers can lean that way."),
      q(B, "In what order should you watch a rally from the defense?", ["Ball the whole time", "Ball → passer → setter → hitter", "Hitter the whole time", "Setter the whole time"], 1, "Watch the player about to touch the ball. Staring only at the ball means you start moving late."),
      q(I, "The setter contacts the ball well behind their head with their back arched. What should blockers expect?", ["A set forward to the outside", "A back set to the right side", "A setter dump", "A free ball"], 1, "Contact behind the head usually goes backward. Your right-side blocker and middle should be ready to go that way."),
      q(I, "An outside hitter's set is inside their hitting shoulder (closer to the middle of the court than their body). Which shot is hardest for them?", ["Sharp angle", "Line", "Tip over the block", "Roll shot to the middle"], 1, "When the ball is inside the shoulder, the hitter has to turn the body back to hit line, which is hard. Defenders can cheat toward angle."),
      q(A, "Late in the set, the other team's best hitter has hit the same seam shot three times. You're the off-blocker. What's the best adjustment?", ["Stay in your normal spot so you don't guess", "Shift to take that seam away and make them beat you somewhere else", "Join the block every time", "Ask for a timeout and do nothing different"], 1, "Players go to their favorite shot under pressure. Taking it away makes them choose a lower-percentage shot."),
      q(A, "The setter jumps to set a tight pass that's right above the net. What should the middle blocker think first?", ["A high outside set", "A quick, a dump or an overpass to play", "A back-row attack", "A free ball"], 1, "A jumping setter on a tight pass can attack it, dump it or push a fast quick. Stay home and ready for the ball at the net."),
    ],
  },
  {
    id: "read-block", name: "Reading the block (hitters)", kind: "Game IQ", tagline: "Hit where the block isn't.",
    intro: "The best hitters don't just hit hard; they see the block forming and hit around it, through it or off it. In the last steps of your approach, the block tells you what's open. Learn to check it with your eyes and you'll get more kills with less power.",
    ideas: [
      { title: "Check the block on your last two steps", text: "Glance at the blockers as you plant. Where they set their hands tells you which shot they're taking away." },
      { title: "Seams", text: "If the two blockers aren't closed (there's space between their hands), the seam is open. Swing high and through the gap." },
      { title: "Line or angle", text: "If the outside blocker sets on the line, the angle is open, and the other way around. If they're late, hit line before they get there." },
      { title: "Short or late blockers", text: "Hit high over a short blocker, or high off their hands. A late-closing middle leaves the seam." },
      { title: "Use the block", text: "When the block is big and set, aim at the outside hand and hit high and out (tooling it), or play a smart shot: a roll, a tip, or swing high off the hands so the ball flies out of play." },
      { title: "Swing high to avoid being stuffed", text: "When in doubt, contact higher and hit deep corners. Stuff blocks come from hitting down into hands." },
    ],
    drills: [
      d("show-hands", "Coach shows the block", "coach", I, 15, "Team, a coach on a box at the net",
        ["A coach (or two players) stands on a box across the net. As the hitter approaches, the coach shows hands line, angle, or apart (open seam).", "The hitter must hit the open spot. Score: 2 for the right shot in, 1 for in, 0 for out or blocked."],
        ["Show the hands late so hitters have to look on their last steps.", "Celebrate the smart shot, not just the hard one.", "Track hitting % with FloorCall to see if smarter shots raise it."]),
      d("eyes-up", "Eyes-up approach", "player", B, 10, "Alone or a friend, a net",
        ["A friend stands on a box across the net and holds up 1, 2 or 3 fingers during your approach.", "Call the number out loud before you hit.", "20 approaches. You can't call it if your eyes are only on the ball."],
        ["See the ball, then look over the net, then back to the ball.", "Short glances; you don't need a long look.", "The same glance shows you the block in a game."]),
      d("tool-target", "Tool the block", "player", A, 12, "A friend on a box with a pad or hands at the net",
        ["Your friend holds hands up on the line. Hit at the outside hand so the ball deflects out of bounds.", "Then hit high off the top of the hands. 3 × 8."],
        ["Aim at the outside edge of the hand, not the middle.", "Swing high: a high contact sends the ball off and out, not down onto your side.", "This turns a big block into your point."]),
    ],
    questions: [
      q(A, "You're an outside hitter. The outside blocker is lined up on your hitting arm, and the middle blocker is late but closing fast. What's the highest-percentage shot?", ["Line, because the outside blocker is on your arm", "Hit high and hard at the seam before the middle closes, or high off the middle blocker's outside hand", "Tip to the middle", "Hit sharp cross into the outside blocker"], 1, "When the outside blocker is set and the middle is late, the seam and the middle's hands are the weak points."),
      q(A, "The block has taken your line all match, and their libero is camped in the deep angle. Which shot attacks both?", ["Line, as hard as you can", "A sharp cut shot inside the block, in front of the libero", "Deep angle at the libero", "A free ball"], 1, "A cut shot sharp across the court avoids the line block and lands in front of a deep angle defender."),
      q(A, "You're a right-side hitter facing a big left-side blocker who keeps reaching across into your line. What exploits it?", ["Swing harder at the line", "Tool off the outside hand toward the antenna, or hit high off the top of the reaching hands", "Hit into the middle of the block", "Always tip"], 1, "A blocker reaching across leaves the outside hand exposed for a high, controlled tool."),
      q(I, "The other team's middle blocker is short but quick. What's usually the smartest swing against them on a quick set?", ["Hit straight into their hands", "Hit high and hard over or past them before the outside blocker can help", "Tip every time", "Slow down your approach"], 1, "Speed and height beat a short blocker. Go before the help arrives."),
      q(B, "The set is tight to the net and you can't swing. What's the best choice?", ["Swing anyway into the block", "Tool the block with a controlled push or tip it high off the hands", "Let it drop", "Hit it out on purpose"], 1, "A tight set is a joust or a tool opportunity; a full swing into the net or block loses the point."),
      q(I, "Only one blocker gets up against you. What's open?", ["Nothing", "More court: hit around the single block, high and deep", "Only the tip", "Only the line"], 1, "A single block leaves big parts of the court. Swing hard around it."),
      q(B, "As you plant to hit, you see a gap between the two blockers' hands. What's the best shot?", ["Hit into the outside blocker", "Swing through the seam between them", "Tip it short", "Hit as hard as you can down the line"], 1, "An open seam is the easiest kill. Swing high through the gap."),
      q(B, "The outside blocker has their hands set on the line. Where is the open court?", ["The line", "The angle (cross-court)", "Behind the blocker", "Nowhere: tip it"], 1, "A blocker taking line leaves the angle. Hit cross-court."),
      q(I, "You're hitting against a big, well-formed double block. What's usually smartest?", ["Hit straight down into the middle of the block", "Tool the outside hand or play a high, smart shot", "Hit out of bounds on purpose", "Set the ball over"], 1, "Hitting into a set block gets stuffed. Using the outside hand or a placed shot keeps you in system and often scores."),
      q(I, "The block is short (blockers' hands barely above the net). What should you do?", ["Hit down hard into their hands", "Hit high over or off the top of their hands", "Always tip", "Hit line at full speed"], 1, "Short blockers can't take the high ball. Contact higher and hit deep."),
      q(A, "The middle blocker is late getting to your outside set every time. What's open most often?", ["The line", "The seam inside the outside blocker", "Behind you", "A tip to the middle"], 1, "A late middle leaves the gap between the blockers. Swing through it before the middle closes."),
      q(A, "You've been blocked twice in a row. What's the best adjustment on the next set?", ["Swing even harder at the same spot", "Change speed or location: hit high off the hands, roll the deep corner, or swing at the seam", "Ask the setter not to set you", "Hit the ball out on purpose"], 1, "Blockers adjust to your pattern. Changing your shot breaks it, and swinging higher avoids another stuff."),
    ],
  },
  {
    id: "blocking-reads", name: "Blocking reads and matchups", kind: "Game IQ", tagline: "Be at the right place, early, against the right hitter.",
    intro: "Blocking is guessing as late as possible and moving as fast as possible. Good blockers read the setter, know which hitter is dangerous, and know what their defense behind them is covering. Read blocking means watching the setter's set before moving; commit blocking means jumping with a hitter (usually the middle) before the set.",
    ideas: [
      { title: "Read: ball, setter, ball, hitter", text: "Watch the pass, then the setter's hands at contact, then the set's direction, then the hitter's approach and arm." },
      { title: "Know the matchup", text: "Who is their best hitter, and who is our best blocker? Put your best blocker where their best hitter attacks, and serve to keep that hitter out of rhythm." },
      { title: "Take something away", text: "A block doesn't have to stop everything. Decide together: take line, take angle, or take the hitter's favorite shot. The defense covers the rest." },
      { title: "Commit only with a reason", text: "Commit on the middle when their middle is dangerous and the pass is good. Otherwise read and stay balanced." },
      { title: "Penetrate and seal", text: "Hands over the net, thumbs up, sealing the gap with your teammate so there's no seam." },
    ],
    drills: [
      d("setter-read", "Read the setter", "coach", I, 15, "Team, a setter and three hitters",
        ["Blockers start at the net in base. The setter sets outside, middle or right on each toss.", "Blockers may only move after the setter's hands touch the ball.", "Score: blockers get a point for every set they close a two-person block on in time."],
        ["Eyes on the setter's hands, not the ball in the air.", "First step is a quick, low shuffle toward the set.", "Coach: watch who moves before contact (guessing) and who moves late."]),
      d("matchup-plan", "Matchup planning talk", "coach", B, 10, "Team, a whiteboard or FloorCall Matchup page",
        ["Before a match, pull up the opponent's scouting.", "Ask players: who is their best hitter, where do they hit, which rotation are they strongest in?", "Decide who blocks them, what the block takes away, and where servers aim."],
        ["Keep it to two or three key points.", "Players remember plans they helped make.", "Check after the match: did the plan work?"]),
      d("blocker-cues", "Shadow blocking", "player", B, 8, "Alone or a friend, a net or wall",
        ["Stand in blocking base. A friend points left, middle or right.", "Shuffle or crossover-step to that spot and jump with hands pressed over the net.", "15 reps, focusing on fast first steps and balanced jumps."],
        ["Hands up at shoulder height before you move.", "Square to the net when you jump.", "Land on two feet and turn to see the play."]),
    ],
    questions: [
      q(A, "Their best outside hitter is front row, and their setter is front row too (only two attackers). You're the middle blocker. What's the best starting position?", ["Spread evenly across the net", "Shade toward the outside hitter and be ready for a setter attack or dump", "Commit on the middle every time", "Start off the net"], 1, "With only two front-row attackers and a dangerous outside, shading toward the hitter while watching the setter is the classic adjustment."),
      q(A, "You've stuffed the same hitter twice on line. Their coach calls a timeout. What should your block expect next?", ["Exactly the same shot", "An adjustment: more angle, a tool, or a tip. Keep your hands taking line but be ready to adapt", "No sets to that hitter", "A free ball"], 1, "Coaches adjust after timeouts. Blockers should keep the plan but anticipate the counter."),
      q(A, "The pass goes off the net, and the set will go high to their outside. You're the right-front blocker and there's time. What's the priority?", ["Jump early to look big", "Set a solid block on the hitter's attacking arm, with the middle closing, and time the jump to the hitter", "Back off to dig", "Block the setter"], 1, "High sets give time to set a well-formed, well-timed double block. That's where blocks score."),
      q(I, "A hitter has been hitting high off your hands and out of bounds. What's the adjustment?", ["Jump earlier", "Penetrate more, turn the outside hand in toward the court, and keep the hands strong", "Stop blocking", "Block with bent wrists"], 1, "Turning the outside hand in and pressing over the net keeps tools in the court."),
      q(B, "After a block attempt, what's your first job?", ["Celebrate", "Land, turn and find the ball, ready to play it or transition", "Walk back to the end line", "Argue the call"], 1, "Many rallies continue after a block touch. Landing ready keeps you in the play."),
      q(B, "When should a read blocker start moving toward the set?", ["When the server tosses", "When the setter contacts the ball", "When the hitter jumps", "When the pass is in the air"], 1, "Read blockers wait for the setter's contact so they aren't fooled, then move fast."),
      q(I, "Their outside hitter gets most of their kills cross-court. What should your block take away?", ["The line", "The angle", "Nothing: just jump", "The tip"], 1, "Take away their best shot and make them win with their weaker one. Your defense covers the line."),
      q(I, "The pass is perfect and their middle is their best attacker. What blocking choice makes sense for your middle?", ["Read and drift outside", "Commit-block the quick hitter", "Don't block at all", "Back off the net"], 1, "On a perfect pass with a dangerous middle, committing on the quick takes away their best option."),
      q(A, "Their best hitter rotates into the front row next rotation. What's the smartest team move?", ["Nothing changes", "Serve tough at that hitter's passing area or to the player who sets them, and set your best blocker against them", "Sub out your blockers", "Take a timeout every rally"], 1, "Disrupting the pass keeps their best hitter out of rhythm, and the matchup puts your best blocker on them."),
      q(A, "Your two blockers keep leaving a seam that their outside hits through. What's the fix?", ["Jump higher", "The middle must close to the outside blocker and seal the gap, hands touching", "Block line only", "Stop blocking that hitter"], 1, "The outside blocker sets the block; the middle's job is to close to them so there's no gap."),
    ],
  },
  {
    id: "speed", name: "Faster decisions", kind: "Game IQ", tagline: "Decide before the ball gets there.",
    intro: "Being 'fast' in volleyball is mostly about deciding early. Players who plan the next touch before it happens ('if the pass is good, I go quick; if it's off, I call for a high ball') move first. Build simple if-then plans, scan the court between touches, and talk.",
    ideas: [
      { title: "If-then plans", text: "Before each rally: 'If they serve me short, I pass to target and transition. If the set is tight, I tip deep corner.' Plans make reactions automatic." },
      { title: "Scan between touches", text: "When the ball is far from you, look at the other side: where are the blockers, who's front row, where are the holes?" },
      { title: "Talk early", text: "Calls like 'Mine', 'Free', 'Two', 'Tip' decide plays before anyone hesitates." },
      { title: "Know the rotation", text: "Knowing who's front row and where each player starts saves you a second on every play." },
    ],
    drills: [
      d("if-then", "If-then before every serve", "coach", B, 10, "Team, during any scrimmage",
        ["Before each serve, every player says one 'if-then' plan out loud to the player next to them.", "Coach asks one player after the rally: did your plan happen?"],
        ["Keep plans short and specific.", "It feels slow at first; after a week it's instant.", "Plans change with the rotation and the score."]),
      d("scan-call", "Scan and call", "coach", I, 12, "Team, 6 v 6",
        ["When the ball crosses to the other side, players have to call out how many front-row hitters are there ('Three up!' or 'Two up!').", "Add the setter location ('Setter front!').", "Points lost for any rally with no call."],
        ["Scanning becomes a habit only with reps.", "Calls must happen before the other team's first touch.", "Check: does the defense start moving sooner?"]),
      d("quick-quiz", "Two-second rotation quiz", "player", B, 5, "Alone, a whiteboard or FloorCall's rotation wheel",
        ["Look at a rotation for two seconds, then cover it.", "Say who's front row, where the setter is, and where you start in serve receive.", "Do all six rotations."],
        ["Knowing the rotation lets you think about the ball, not where to stand.", "Use your team's real lineup.", "Coaches: quiz players during water breaks."]),
    ],
    questions: [
      q(A, "You're the off-hitter in transition after a dig. The setter is chasing the ball near the 10-foot line. What's the right if-then plan?", ["Run your normal quick approach", "Open wide and call for a high ball, ready for an out-of-system set", "Stop and watch", "Go to the net to block"], 1, "An out-of-position setter means a high set. Get wide and give the setter a big target."),
      q(A, "It's 24–25, you're serving to stay in the set, and their best passer is in left back. What's the smartest serve?", ["Your hardest serve at their best passer", "A tough but reliable serve at the weaker passer or the seam, avoiding the error", "An underhand serve", "Serve at the libero"], 1, "At set point down, avoid errors but still pressure the weakest receive area."),
      q(I, "Their middle has been hitting a slide behind the setter. Where should your right-side blocker be when the setter turns around?", ["Out by the antenna", "Ready to release and follow the middle on the slide", "Off the net", "Blocking the setter"], 1, "Reading the slide early and following the hitter is how you block it."),
      q(I, "You're a passer and see the server look at the seam on your right. What should you do?", ["Nothing", "Shift slightly and tell your teammate 'Seam!' so you're both ready", "Move far away from the seam", "Call timeout"], 1, "Servers often look where they serve. Small, early adjustments and a call win seam battles."),
      q(B, "The ball is on the other side and not coming to you yet. What should you be doing?", ["Watching only the ball", "Scanning: who's front row, where the setter is, where the holes are", "Fixing your knee pads", "Talking to the bench"], 1, "Between touches is when good players gather information so they can decide early."),
      q(B, "A ball drops between two passers who both stopped. What would most likely have prevented it?", ["Passing harder", "An early, loud 'Mine!' call", "Standing closer together", "A timeout"], 1, "Calling early decides who takes it. Silence causes hesitation."),
      q(I, "You're a hitter and the pass goes off the net. What's your best if-then plan?", ["Approach for a quick anyway", "Open up and call for a high ball to your pin", "Stop and watch", "Run to the setter's spot"], 1, "An off-net pass means a high set. Get outside and give the setter an easy target."),
      q(A, "It's 23–23 and you'll serve next. What's the best use of the time before the whistle?", ["Think about the last point you lost", "Run your serving routine and pick a target based on the other team's weakest passer", "Serve as hard as possible no matter what", "Watch the crowd"], 1, "A routine and a clear target turn pressure into a plan."),
    ],
  },
  {
    id: "pressure", name: "Handling pressure", kind: "Mindset", tagline: "Play the next point, not the scoreboard.",
    intro: "Pressure is your body getting ready to compete: a faster heart, tighter muscles, racing thoughts. It isn't a sign you'll fail. Players who perform under pressure have routines that bring their attention back to the next point and the thing they control.",
    ideas: [
      { title: "Have a routine", text: "Same steps before every serve or pass: a breath, a bounce or spin of the ball, a target, a cue word. Routines are where your mind goes when you're nervous." },
      { title: "Breathe it down", text: "Box breathing: in for 4 seconds, hold for 4, out for 4, hold for 4. Two rounds slows your heart rate between points." },
      { title: "Cue words", text: "One or two words that point at what to do: 'Toss high', 'Low and early', 'See it'. Not 'Don't miss'." },
      { title: "Control the controllables", text: "Effort, attitude, communication and your routine. Not the ref, the score or the other team." },
      { title: "Butterflies are energy", text: "Say 'I'm excited' instead of 'I'm nervous'. The feeling is the same; how you name it changes how you play." },
    ],
    drills: [
      d("pressure-serve", "Pressure serving", "coach", I, 12, "Team, a court",
        ["Each player serves with the whole team watching. If they miss, the team does a small consequence (a sprint) together.", "Each server must say their cue word out loud before serving.", "Track serve-in % in FloorCall for practice vs matches."],
        ["Practice pressure makes match pressure familiar.", "Teach the routine first, then add pressure.", "Celebrate the routine, not just the serve."]),
      d("box-breath", "Box breathing", "player", B, 3, "Alone, anywhere",
        ["Breathe in through your nose for 4 seconds. Hold 4. Out through your mouth for 4. Hold 4.", "Repeat 4 times. Practice once a day so it works when you need it."],
        ["Slow breathing calms your body fast.", "Use it before serving, between sets and before games.", "Pair it with your cue word."]),
      d("routine-build", "Build your serve routine", "player", B, 10, "Alone, a court and a ball",
        ["Pick 3–4 steps: for example one breath, bounce the ball twice, look at your target, say your cue word.", "Do the exact routine before 30 serves.", "Write it on a card and keep it in your bag."],
        ["Short enough to fit in 8 seconds.", "The same every time, good serve or bad.", "Use it in practice so it's automatic in a match."]),
    ],
    questions: [
      q(A, "You've shanked two serves in a row in the fifth set. The coach leaves you in. What's the most effective thing to do?", ["Try to pass perfect to prove yourself", "Reset with a breath and cue ('early feet'), focus on a hittable pass (any 2 is good), and talk to your seam partner", "Ask to come out", "Stand farther back"], 1, "Lowering the target to a good, playable pass and using a cue word reduces pressure and errors."),
      q(A, "Your team is up 24–20 and has lost three straight points. What's the best team mindset?", ["Play safe and hope they miss", "Stick to the plan: aggressive-but-in serves, swing smart, win the next rally", "Change the rotation", "Stop talking to avoid stress"], 1, "Teams that tighten up play passive. Staying aggressive within the plan closes sets."),
      q(I, "Which routine is best for a pressure serve?", ["A new one for big moments", "The same short routine you use on every serve", "No routine: just serve fast", "Wait as long as possible"], 1, "The value of a routine comes from doing it the same way every time."),
      q(B, "Which cue word is most helpful before passing a tough server?", ["'Don't shank it'", "'Early platform'", "'Please'", "'Oh no'"], 1, "Short, positive cue words point at what to do."),
      q(B, "It's match point and you're serving. Which thought helps most?", ["'Don't miss, don't miss'", "Your cue word, like 'Toss and hit through'", "'What if we lose?'", "'Everyone is watching me'"], 1, "Telling yourself what to do works better than what not to do. A cue word points your focus at the skill."),
      q(B, "Your heart is pounding before a big game. What is that?", ["A sign you'll play badly", "Your body getting ready to compete", "A reason to sit out", "Something to hide from the coach"], 1, "Nerves are energy. Naming them 'excitement' and using a routine helps you use them."),
      q(I, "You've missed two serves in a row. What's the best thing to do before the next one?", ["Serve harder to make up for it", "Take a breath, do your full routine, pick a safe target", "Serve underhand", "Ask to sub out"], 1, "Your routine resets you. A safe, aimed serve breaks the streak."),
      q(I, "The ref makes a call you think is wrong. What's best?", ["Argue so they change it", "Let it go, reset, and focus on the next point", "Complain to your teammates for the next few points", "Stare at the ref"], 1, "You can't control the ref. Every second spent on it takes focus from the next point. Captains can ask calmly if a rule question matters."),
      q(A, "Your team is down 20–24 in the deciding set. What should the team's focus be?", ["The score: we need four points", "One point at a time: good serve receive, then the next point", "Trying low-percentage hero swings", "Getting the game over with"], 1, "Big comebacks happen one rally at a time. Focusing on the next point keeps players doing what works."),
    ],
  },
  {
    id: "bounce-back", name: "Bouncing back", kind: "Mindset", tagline: "Bad plays happen. Flush them.",
    intro: "Every player makes errors: even great hitters get stopped and great passers shank balls. The difference is how fast they let go. Have a reset you use after a mistake, learn from bad games without beating yourself up, and keep your body language and effort the same no matter the score.",
    ideas: [
      { title: "Flush routine", text: "After an error: a quick physical reset (wipe your hand on your shorts, tap your shoe), one breath, and a cue for the next play. Then it's gone." },
      { title: "Next play", text: "The only play you can change is the next one. Say it to yourself and to teammates." },
      { title: "Body language", text: "Head up, shoulders back, eyes forward. Teammates and opponents can see when someone is down, and it spreads." },
      { title: "After a bad game", text: "Write three things you did well and one thing to work on. Then do something you enjoy. Look at your stats the next day, not right away." },
      { title: "Talk to yourself like a teammate", text: "Would you call a teammate 'terrible'? Use the same words for yourself that you'd use to pick up a friend." },
    ],
    drills: [
      d("flush", "Practice the flush", "coach", B, 10, "Team, during any drill",
        ["Every time a player makes an error in a drill, they do their flush routine before the next ball (a hand wipe, a breath, a clap).", "Coaches and teammates say 'next ball' instead of 'come on'."],
        ["Practice the reset as much as the skill.", "Make it visible so coaches can see players using it.", "It should take under 3 seconds."]),
      d("three-and-one", "Three and one journal", "player", B, 5, "Alone, a notebook or phone",
        ["After every match and practice, write three things you did well and one thing to work on.", "Read last week's entries before your next match."],
        ["Be specific: 'passed seam serves to target' beats 'played okay'.", "You'll start seeing progress you'd otherwise miss.", "FloorCall's player trends can back it up with numbers."]),
      d("error-game", "Earn it back", "coach", I, 12, "Team, scrimmage",
        ["Play a scrimmage where any player who makes an error must make the next good play (a dig, a good pass or an encouraging call) to 'earn it back'.", "Teammates help them by talking and covering."],
        ["Teaches players to respond to errors with action.", "Keeps the gym positive.", "Debrief: how did it feel to have teammates help?"]),
    ],
    questions: [
      q(A, "You're a setter who's set two balls into the net. What's the best fix in the moment?", ["Set every ball high and safe for the rest of the match", "Reset, then focus on one technical cue (feet to target, ball above the forehead) and keep running the offense", "Ask the libero to set everything", "Stop calling plays"], 1, "One cue fixes technique without making you passive."),
      q(A, "You played great in the first set and poorly in the second. What should you look at in the break?", ["Only the errors", "What changed (their adjustment, your technique, your focus) and one adjustment for the next set", "Nothing: just forget it", "Your stats from last week"], 1, "Finding the change, not just the result, gives you a useful adjustment."),
      q(I, "After a bad game, when is the best time to watch film?", ["Right away, while upset", "The next day, with a few specific things to look for", "Never", "Only the good plays"], 1, "With emotions settled, film is information instead of punishment."),
      q(I, "You lost the first set badly. What should the team do in the break?", ["Blame each other", "Name one thing that worked, one adjustment, and start fresh", "Stay silent", "Change everything"], 1, "A short, specific reset gives the team a plan and leaves the last set behind."),
      q(B, "You just got blocked. What's the best next move?", ["Look at the ground and walk slowly back", "Do your quick reset, cover your next job, and call for the next ball", "Complain about the set", "Stop swinging hard"], 1, "A fast reset and a clear next job stop one error from becoming three."),
      q(B, "A teammate shanks a pass and looks upset. What helps most?", ["Say nothing", "'Next ball, I've got your back'", "'You have to pass that'", "Roll your eyes"], 1, "Short, positive talk helps teammates reset. Correcting technique can wait for practice."),
      q(I, "You played your worst game of the season. What's the best plan for tonight?", ["Watch the film over and over", "Write three things you did well and one thing to work on, then rest", "Decide you're not good enough", "Skip the next practice"], 1, "Reflection with balance helps you learn without spiraling. Look at stats and film the next day with fresh eyes."),
      q(A, "You keep thinking about an error from two rallies ago. What should you do?", ["Keep thinking about it so you don't repeat it", "Use a physical reset (wipe, breath) and your cue word to bring your focus to now", "Play safe for the rest of the set", "Ask to sub out"], 1, "A physical action plus a cue word interrupts replaying the mistake and points your attention at the next play."),
    ],
  },
  {
    id: "focus", name: "Focus and confidence", kind: "Mindset", tagline: "Prepare your mind like you prepare your body.",
    intro: "Confidence comes from preparation and from noticing your progress. Focus is a skill you practice: knowing where your attention should be and bringing it back when it drifts. Imagery (seeing yourself play well) is used by top athletes in every sport.",
    ideas: [
      { title: "Process goals", text: "Goals about what you do ('call every ball', 'use my routine on every serve') rather than results ('get 15 kills'). You control process goals." },
      { title: "Imagery", text: "Close your eyes and picture a perfect pass, a great swing, a calm serve, in detail and in real time. A few minutes the night before a match helps." },
      { title: "Narrow and wide", text: "Wide focus to read the court before the play; narrow focus on the ball when it's yours." },
      { title: "Evidence of progress", text: "Confidence grows when you see proof. Track your numbers over time; FloorCall's player trends show where you're getting better." },
    ],
    drills: [
      d("imagery", "Five-minute imagery", "player", B, 5, "Alone, a quiet spot",
        ["Sit or lie down, close your eyes and take three slow breaths.", "Picture yourself warming up, then making five great plays in your position, in real time, with the sounds and feelings of the gym.", "Finish by picturing how you'll reset after a mistake."],
        ["Detail matters: the ball's spin, the gym's noise, your feet.", "See it from your own eyes, not like watching TV.", "Do it the night before matches."]),
      d("process-goals", "Process goals for the match", "player", B, 5, "Alone, before a match",
        ["Pick two process goals for the match (for example: 'serve to my target every time' and 'call every ball in my area').", "After the match, rate yourself 1–5 on each."],
        ["Goals you control build confidence even in a loss.", "Change them as you improve.", "Share them with your coach."]),
      d("focus-switch", "Wide and narrow", "coach", I, 10, "Team, a coach with balls",
        ["During a defensive drill, players call 'wide' when the ball is on the other side and say what they see, then 'narrow' as the hitter swings and they dig.", "Coach varies the tempo."],
        ["Teaches when to look around and when to lock in.", "Players learn to stop staring at the ball too early.", "Short reps, lots of energy."]),
    ],
    questions: [
      q(A, "You're blocking. When should your eyes go from the setter to the hitter?", ["When the pass is made", "As soon as the setter releases the ball toward a hitter", "When the hitter lands", "Never: watch the ball"], 1, "Ball, setter, ball, hitter: the switch happens as the set leaves the setter's hands."),
      q(I, "Which is the best focus during an opponent's serve toss?", ["The scoreboard", "The server's body and toss, to read the serve's direction and type", "Your teammates", "The ref"], 1, "Reading the server's body and toss tells you the serve's direction and speed sooner."),
      q(B, "Which is a process goal?", ["Win the match", "Get 10 kills", "Use my serve routine on every serve", "Be the MVP"], 2, "Process goals are about actions you control. Results follow from them."),
      q(I, "When is imagery most useful?", ["Only during the match", "Regularly, including the night before a match, in real time and detail", "Only after losing", "Never: it's not real practice"], 1, "Imagery practiced regularly in detail helps prepare skills and calm nerves."),
      q(I, "When should your focus be 'wide' (taking in the whole court)?", ["When the ball is coming to you", "When the ball is on the other side, before their attack", "When serving", "Never"], 1, "Go wide to gather information, then narrow onto the ball when it's yours."),
    ],
  },
  {
    id: "leader", name: "Being a leader", kind: "Team", tagline: "Make the people around you better.",
    intro: "Leaders aren't always the best players or the loudest. They show up the same way every day, talk on the court, pick teammates up, hold the standard and speak to coaches respectfully. Anyone can lead, from the bench too.",
    ideas: [
      { title: "Lead by example first", text: "Effort in warm-ups, hustle for every ball, on time, good body language. People follow what you do more than what you say." },
      { title: "Talk on the court", text: "Calls, encouragement and information: 'Their 7 hits line', 'Free ball!', 'Great dig, next one'." },
      { title: "Lift people up", text: "Notice teammates who are struggling and say something specific and positive. Celebrate role players." },
      { title: "Hold the standard", text: "Remind teammates of team rules and effort in a respectful, private way. Praise in public, correct in private." },
      { title: "Be the bridge", text: "Captains help coaches and players understand each other: ask questions on behalf of the team and pass on information clearly." },
    ],
    drills: [
      d("captain-huddle", "Player-led huddles", "coach", I, 10, "Team, during scrimmage",
        ["After each game of a scrimmage, a different player leads a 30-second huddle: one thing going well, one thing to fix, one plan for the next game.", "Rotate leaders so everyone practices."],
        ["Builds leadership in everyone, not just captains.", "Coach stays quiet unless needed.", "Short and specific beats long speeches."]),
      d("shout-outs", "Shout-outs", "coach", B, 5, "Team, end of practice",
        ["Each player gives one specific shout-out to a teammate who did something well today.", "Make sure every player gets at least one over the week."],
        ["Specific: 'Mia called every ball in serve receive'.", "Builds a team culture where effort is noticed.", "Coaches can join in."]),
      d("talk-drill", "Talk or lose it", "coach", B, 12, "Team, any game-like drill",
        ["A point only counts if the team made at least three calls during the rally ('Mine', 'Free', 'Tip', 'Hitter', 'Out').", "Quiet teams lose points even if they win the rally."],
        ["Talking is a skill and a leadership habit.", "Coaches listen for helpful information, not just noise.", "Make it the norm in every drill."]),
    ],
    questions: [
      q(A, "Two starters are arguing during a timeout. You're the captain. What's best?", ["Let the coach handle it", "Step in calmly, refocus everyone on the one thing the coach is saying, and talk to both players after the match", "Take a side", "Ignore it"], 1, "Captains refocus the team in the moment and handle the conflict privately later."),
      q(A, "Your coach makes a lineup change that upsets the team. What's the best captain move?", ["Tell the team you disagree", "Support the decision in front of the team, ask the coach privately to explain it so you can help teammates understand", "Refuse to play", "Post about it"], 1, "Public support and private questions keep the team together and the coach informed."),
      q(I, "What's the best way to give a teammate feedback during a match?", ["Tell them everything they're doing wrong", "One short, specific, positive cue: 'Get your feet there early, you've got this'", "Say nothing ever", "Complain to the bench"], 1, "Short, specific and encouraging feedback helps in the moment."),
      q(B, "A new player joined the team and doesn't know anyone. What can a leader do?", ["Wait for them to fit in", "Introduce yourself, partner with them in drills, include them", "Let the coach handle it", "Test them first"], 1, "Leaders make everyone feel part of the team, quickly."),
      q(B, "You're not a starter. How can you lead?", ["You can't lead from the bench", "Bring energy, cheer specific plays, work hard in practice and be ready when called", "Stay quiet so you don't bother anyone", "Tell the starters what they're doing wrong"], 1, "Leadership is about behavior. Energy, preparation and support from the bench matter to the whole team."),
      q(I, "A teammate keeps showing up late to practice. As a captain, what's the best first step?", ["Call them out in front of the team", "Talk to them privately, ask what's going on, and remind them why it matters", "Tell the coach right away without talking to them", "Ignore it"], 1, "Praise in public, correct in private. Understanding the reason first often solves it; involve the coach if it continues."),
      q(I, "The team is down and quiet. What should a leader do?", ["Wait for the coach to say something", "Start talking: specific encouragement and a simple plan for the next point", "Yell at teammates to try harder", "Stay quiet and focus on yourself"], 1, "Leaders set the tone. Specific, positive talk and a clear plan bring a team back."),
      q(A, "Teammates are confused about a new rotation the coach introduced. What's a captain's best move?", ["Complain to teammates about the change", "Ask the coach calmly for a quick walk-through and help explain it to the team", "Tell everyone to do what they want", "Ignore it until the match"], 1, "Captains are the bridge between coach and team: ask, then help everyone understand."),
    ],
  },
  {
    id: "teammates", name: "Teammates and tough situations", kind: "Team", tagline: "Handle conflict without hurting the team.",
    intro: "Every team has friction: playing time, a negative teammate, someone who blames others, cliques. How you handle it decides whether it grows. Talk directly and respectfully, assume good intent, keep it off social media, and bring in a coach when it's bigger than you.",
    ideas: [
      { title: "Talk to people, not about them", text: "Go to the teammate privately. Gossip and group chats make small problems big." },
      { title: "Use 'I' statements", text: "'I feel frustrated when the calls aren't made, can we both call louder?' beats 'You never call the ball'." },
      { title: "Playing time", text: "Ask the coach (not parents, not teammates) what you can do to earn more time. Then work on exactly that." },
      { title: "Negative teammates", text: "Don't match their energy. Stay positive, give them a job ('Call the tips with me'), and talk to them or a captain if it keeps happening." },
      { title: "Know when to get an adult", text: "Bullying, hazing, threats, or anything that makes you feel unsafe: tell a coach, parent or school staff right away. That's not snitching; it's protecting the team." },
    ],
    drills: [
      d("scenario-talk", "Team scenario talk", "coach", B, 15, "Team, sitting in a circle",
        ["Read one of the situations from Test yourself (for example a teammate blaming others).", "Small groups decide what they'd do, then share.", "Coach shares the team's expectations."],
        ["Talking it through before it happens makes it easier when it does.", "Keep it real but don't name actual teammates.", "End with a team agreement."]),
      d("team-agreement", "Write a team agreement", "coach", B, 20, "Team, paper or a whiteboard",
        ["As a team, write 5–6 agreements: how we talk to each other, how we handle errors, how we handle disagreements, phones and social media.", "Everyone signs it. Revisit it mid-season."],
        ["Players follow rules they helped make.", "Keep it short and specific.", "Coaches can post it in FloorCall as a note to the team."]),
    ],
    questions: [
      q(A, "A teammate posts something negative about another teammate in a group chat. What's best?", ["Like it", "Don't join in, tell them privately it hurts the team, and tell a captain or coach if it continues", "Screenshot it and post it", "Leave the team chat"], 1, "Refusing to join, addressing it privately and getting help if needed protects the team."),
      q(I, "A teammate is upset they're not playing and is bringing the team down. What can you do?", ["Tell them to quit", "Acknowledge it's hard, encourage them to talk to the coach, and keep them involved", "Ignore them", "Complain about them"], 1, "Empathy and pointing them to the coach is the most helpful approach."),
      q(B, "A teammate keeps blaming others for errors. What's the best first step?", ["Blame them back", "Talk to them privately and calmly about how it affects the team", "Post about it in the group chat", "Stop passing to them"], 1, "Private, respectful conversations solve most problems. Group chats and blame make it worse."),
      q(B, "You aren't getting much playing time. What should you do?", ["Complain to teammates", "Ask the coach what you can work on to earn more time, then work on it", "Have your parents argue with the coach", "Stop trying in practice"], 1, "The coach decides playing time; asking directly shows maturity and tells you exactly what to improve."),
      q(I, "Two friends on the team are being left out by a group. What helps the team most?", ["Stay out of it", "Include them, and tell a captain or coach if it continues", "Join the group leaving them out", "Talk about it on social media"], 1, "Cliques hurt team chemistry. Including people and getting help if it keeps happening protects the team."),
      q(I, "A teammate says something mean about your play during a match. What's best in the moment?", ["Say something mean back", "Stay focused on the next point, and talk to them calmly after the match", "Stop calling the ball", "Walk off the court"], 1, "In the moment, the next point matters most. Address it calmly later, with a coach if needed."),
      q(A, "Someone on the team is being bullied or hazed. What should you do?", ["Nothing: it's not your business", "Tell a coach, parent or school staff member right away", "Handle it by yourself with threats", "Record it and post it online"], 1, "Bullying and hazing need an adult to step in. Reporting protects a teammate and the team."),
    ],
  },
  {
    id: "talk", name: "Talking on the court", kind: "Team", tagline: "Loud, early and useful.",
    intro: "Most dropped balls between two players are communication errors, not skill errors. Great teams talk constantly: before the serve (who's front row, where the setter is), during the rally (calls for every ball), and between points (encouragement and adjustments). Short, loud, early calls win.",
    ideas: [
      { title: "Before the serve", text: "Call the opponent's front-row hitters ('Three up!' or 'Setter front, two hitters!'), your own rotation job, and who takes the seams." },
      { title: "On every ball", text: "'Mine!' or 'Me!' for the passer, 'Free!' for an easy ball over, 'Down!' for a standing hit, 'Tip!' for a tip, 'Out!' and 'Line!' to help passers and diggers." },
      { title: "Help the hitter", text: "Tell the hitter what the block is doing: 'One!' (one blocker), 'Line open!', 'Short!'." },
      { title: "Between points", text: "One positive thing and one adjustment: 'Good swing. Their middle's late, hit the seam.'" },
      { title: "Use names", text: "'Mia, yours!' is clearer than 'yours!' when the gym is loud." },
    ],
    drills: [
      d("silent-then-loud", "Silent rally, loud rally", "coach", B, 10, "Team, 6 v 6",
        ["Play three rallies with no talking at all. Then three where every touch needs a call.", "Ask: which felt easier? Which won more points?"],
        ["Players feel the difference talking makes.", "Keep calls short.", "Do it early in the season."]),
      d("info-calls", "Information calls", "coach", I, 12, "Team, scrimmage",
        ["Before every serve, one assigned player calls the opponent's front-row hitters and the setter's spot.", "After each attack, a teammate tells the hitter what the block did.", "Coach rewards a point for great information."],
        ["Information is a skill, like passing.", "Rotate who makes the calls.", "Make it automatic before matches."]),
      d("names-only", "Names only", "coach", B, 8, "Team, any drill",
        ["In passing or defensive drills, players must call the name of who takes the ball ('Ava!') instead of 'mine'.", "Lost point for any ball nobody named."],
        ["Builds clear calls in loud gyms.", "Makes players think about who's best placed.", "Fun with new teams to learn names."]),
    ],
    questions: [
      q(A, "In serve receive, the ball's heading between you (left back) and the libero (middle back). Neither of you called it. Who should take it by most team rules?", ["Always the left back", "The libero (or best passer), who usually has seam priority", "Whoever is closer to the net", "Nobody: let it drop"], 1, "Most teams give seam priority to the libero or best passer. Know your team's rule and call early."),
      q(I, "What's the most useful call to a hitter before their approach?", ["'Hit it hard!'", "Information about the block: 'One!', 'Line open!' or 'Seam!'", "'Don't miss!'", "Nothing"], 1, "Information helps the hitter choose a shot."),
      q(B, "A serve is coming right between you and a teammate. When should the call happen?", ["After the ball crosses the net and lands", "As early as possible, before the ball gets to you", "Only if you're the libero", "Never: just go for it"], 1, "Early calls give the other player time to get out of the way and let the passer focus."),
      q(B, "What does 'Free!' tell your team?", ["A substitution is coming", "The other team is sending an easy ball over, so transition to free-ball positions", "Take a break", "Their setter is front row"], 1, "A free-ball call moves blockers off the net and passers into position to run a play."),
      q(I, "You see their outside blocker set up on the line before your teammate's swing. What should you call?", ["Nothing", "'Angle open!' or 'Line closed!'", "'Mine!'", "'Out!'"], 1, "Telling the hitter what the block is doing helps them pick the right shot."),
      q(I, "Your team keeps letting tips drop. What call helps most?", ["'Out!'", "'Tip!' as soon as the hitter slows their arm", "'Free!'", "'Down!'"], 1, "An early 'Tip!' gets the assigned player moving forward before the ball drops."),
      q(A, "Before the serve, what's the most useful information to say?", ["The score", "How many front-row hitters they have and where the setter is", "Who you're playing next week", "What you had for lunch"], 1, "Knowing the number of attackers and the setter's spot tells blockers and defenders what to expect."),
    ],
  },
  {
    id: "prepare", name: "Preparing to compete", kind: "Mindset", tagline: "Show up ready, every match.",
    intro: "Confident players have a plan before the first whistle: sleep, food and water the day before, a pre-match routine, a few things to focus on, and knowledge of the opponent. Preparation turns nerves into readiness.",
    ideas: [
      { title: "The day before", text: "Sleep 8–10 hours (teens need more), eat normal meals with carbohydrates, and drink water through the day." },
      { title: "A pre-match routine", text: "Same warm-up, same music, same cues. A routine tells your body it's time to play." },
      { title: "Know the opponent", text: "Two or three things from the scouting report: their best hitter, their weakest passer, their best rotation." },
      { title: "Two process goals", text: "Things you control, like 'call every ball' and 'serve my target'." },
      { title: "Between matches at tournaments", text: "Eat small snacks, drink, stay off your feet, and reset your focus before the next match." },
    ],
    drills: [
      d("pre-match-card", "Pre-match card", "player", B, 10, "Alone, an index card",
        ["On a card, write: your warm-up steps, two process goals, your cue words, and your reset after mistakes.", "Read it before every match."],
        ["Simple enough to read in a minute.", "Update it as you learn what works.", "Keep it in your bag."]),
      d("scouting-quiz", "Scouting quiz", "coach", I, 10, "Team, the opponent's scouting page",
        ["Before a match, quiz players: their best hitter's number and favorite shot, their weakest passer, the rotation where they score most.", "Prizes for right answers."],
        ["Players remember a few facts better than a long report.", "Pull it from FloorCall's Matchup page.", "Check after the match whether it held up."]),
      d("tournament-plan", "Tournament day plan", "player", B, 10, "Alone, the schedule",
        ["Write your day: arrival, warm-ups, matches, work assignments (reffing), and when you'll eat and drink.", "Pack snacks and water before you leave."],
        ["Long days are won by players who stay fueled.", "Plan small snacks between matches.", "Rest your legs between matches."]),
    ],
    questions: [
      q(A, "You have two matches today and you're starting the second one at the end of a long day. What's the smartest plan?", ["Eat a big meal right before the second match", "Snack small and often, drink water, stay off your feet, and do a short re-warm-up before the second match", "Skip warm-up to save energy", "Drink only sports drinks"], 1, "Small, steady fuel, rest and a re-warm-up keep legs and focus ready."),
      q(B, "You have a tournament tomorrow at 8 a.m. What's the best plan tonight?", ["Stay up late watching film", "Normal dinner, water, pack snacks and gear, and get a full night's sleep", "Skip dinner to feel light", "Do a hard workout"], 1, "Sleep, fuel and being packed are the simplest performance boosters there are."),
      q(I, "There are two hours between your matches. What should you do?", ["Eat a big fast-food meal", "Small snack, water, rest your legs, quick mental reset before warm-up", "Play pick-up on another court", "Sit in the sun"], 1, "Light fuel, hydration and rest keep energy up for the next match."),
      q(I, "What should you take from a scouting report?", ["Every number in it", "Two or three key facts you can use", "Nothing: just play", "Only your own stats"], 1, "A few clear facts are easy to remember and act on during play."),
      q(A, "Warm-ups felt bad and you're nervous. What helps most before the first serve?", ["Decide it's going to be a bad day", "Box breathing, your cue words, and focusing on your first job (pass to target)", "Change your whole routine", "Skip the rest of warm-up"], 1, "Warm-up doesn't predict the match. Breathing and a simple first job bring your focus to the present."),
    ],
  },
  {
    id: "role", name: "Playing your role", kind: "Team", tagline: "Every role wins matches.",
    intro: "Not everyone can be the go-to hitter, and that's how great teams work. Defensive specialists, servers, the bench, the practice player who pushes the starters: every role matters. Knowing and owning your role, and preparing for the moment you're called, makes the team better and gets you more chances.",
    ideas: [
      { title: "Know your job", text: "Ask the coach what your role is and what success looks like in it." },
      { title: "Be ready", text: "On the bench, follow the rotation, watch the opponent, stay warm. When you go in, your first contact should be your best." },
      { title: "Practice like a starter", text: "Great practice players make starters better and earn trust." },
      { title: "Celebrate others", text: "Energy from the bench is real. Teams with engaged benches play better." },
      { title: "Earn more", text: "Ask what you can improve to earn a bigger role, then show it every day." },
    ],
    drills: [
      d("sub-ready", "Sub-ready reps", "coach", B, 10, "Team, scrimmage",
        ["During scrimmage, the coach subs players in without warning for one serve or one rotation.", "Subs must be warm and know the rotation."],
        ["Prepares players to make an impact right away.", "Bench players stay engaged.", "Talk about what 'ready' looks like."]),
      d("role-cards", "Role cards", "coach", B, 15, "Team, index cards",
        ["Each player writes their role on the team and one way they help win.", "Coaches add one thing for each player. Share them in a team meeting."],
        ["Clarity about roles reduces frustration.", "Every role is named and valued.", "Revisit mid-season."]),
    ],
    questions: [
      q(A, "You're a defensive specialist subbing in for serve and back-row defense. What's your top priority?", ["Getting kills", "Making your serve in and tough, and passing or digging to target", "Setting", "Blocking"], 1, "A DS role is to serve well and play defense. Do those jobs at a high level."),
      q(B, "You're on the bench in a close match. What's your job?", ["Relax until you're called", "Follow the rotation, cheer specific plays and stay warm so you're ready", "Text your friends", "Tell the coach who to sub out"], 1, "Being ready and engaged makes your first contact count when you go in."),
      q(I, "The coach brings you in just to serve at 23–23. What's the best approach?", ["Try a new serve you saw online", "Your usual routine and a tough but in serve to your target", "Serve as soft as possible", "Ask to sit back down"], 1, "Your routine and a safe, aimed serve are what the coach trusts you to do."),
      q(I, "You want more playing time. What should you do?", ["Complain to teammates", "Ask the coach what to improve, then show it in practice every day", "Play harder only in matches", "Have a parent ask for you"], 1, "Direct questions and visible improvement are how roles change."),
      q(A, "You're the second setter and practice against the starters every day. How can you help the team most?", ["Go easy so the starters look good", "Compete hard and run the plays well so the starters face match-level pressure", "Skip some reps", "Only focus on your own stats"], 1, "Strong practice players make the starting lineup better and show the coach you're ready."),
    ],
  },
  {
    id: "coachable", name: "Being coachable", kind: "Mindset", tagline: "Turn feedback into improvement.",
    intro: "Coachable players improve fastest. They listen without getting defensive, ask questions to understand, try the change even when it feels strange, and look for feedback instead of avoiding it. Being coached hard usually means a coach believes you can do more.",
    ideas: [
      { title: "Listen to understand", text: "Eye contact, nod, and repeat the main point back. Don't argue in the moment." },
      { title: "Ask good questions", text: "'Do you mean earlier on my approach, or faster?' clears things up." },
      { title: "Try it, even when it feels worse", text: "New technique often gets worse before it gets better. Give it enough reps." },
      { title: "Use video and stats", text: "Film and numbers (like FloorCall's player trends) show what you can't feel." },
      { title: "Feedback isn't personal", text: "Coaching is about the skill, not about who you are." },
    ],
    drills: [
      d("one-thing", "One thing", "coach", B, 5, "Team, end of practice",
        ["Each player says the one piece of coaching they worked on today and how it went.", "Coaches write it down and check the next day."],
        ["Players learn to turn feedback into focus.", "Keeps practice purposeful.", "Short and quick."]),
      d("film-self-review", "Self-review on film", "player", I, 15, "Alone, match film (FloorCall Film Room)",
        ["Pick one skill. Watch 10 of your own reps on film.", "Write what you see, compared to what your coach has told you.", "Bring one question to your next practice."],
        ["Seeing yourself makes coaching click.", "Be honest, not harsh.", "Compare a month later to see the change."]),
    ],
    questions: [
      q(A, "Your club coach and school coach teach your approach differently. What's best?", ["Pick one and ignore the other", "Ask both coaches to explain the why, then talk with them about which fits your game", "Do whatever feels easier", "Change every week"], 1, "Understanding the why and communicating openly helps you make a good decision."),
      q(B, "Your coach corrects your passing in front of the team. What's the best response?", ["Argue that you were right", "Listen, nod, and try the correction on the next rep", "Roll your eyes", "Stop trying"], 1, "Listening and trying the change shows coachability and helps you improve."),
      q(I, "You don't understand a correction. What should you do?", ["Pretend you understand", "Ask a short question to clarify, at a good moment", "Ignore it", "Ask a teammate to tell the coach they're wrong"], 1, "A clarifying question helps you make the change correctly."),
      q(I, "A new arm swing feels worse after one practice. What now?", ["Go back to the old one", "Keep giving it reps; new technique usually feels worse before it gets better", "Quit hitting", "Change something else too"], 1, "Skill changes take repetition. Check with your coach and give it time."),
      q(A, "The coach hasn't given you feedback in a while. What's a coachable move?", ["Assume you're perfect", "Ask what one thing would help you most right now", "Ask why others get more attention", "Stop working hard"], 1, "Asking for feedback shows ownership and tells you what to work on."),
    ],
  },
  {
    id: "better-ball", name: "Out of system: better the ball", kind: "Game IQ", tagline: "Make every bad ball a little better.",
    intro: "Most rallies aren't perfect. Passes go off the net, digs fly to the wrong spot, the setter gets the first ball. Teams that win close matches 'better the ball': every touch after a bad one makes the next one easier. That means high, hittable balls to the pins, smart choices about when to swing and when to play it safe, and everyone knowing who takes the second ball.",
    ideas: [
      { title: "High and to the pins", text: "When out of system, a high set to the outside or right side gives the hitter time and the team a chance." },
      { title: "Who takes the second ball", text: "If the setter digs or passes, the libero or right side usually sets. Decide this as a team before matches, and call it." },
      { title: "Swing or play it safe", text: "A great set: swing. A tough set: hit high off the block, a deep roll shot, or a controlled ball to a hard spot. Giving the other team a free ball is better than a hitting error." },
      { title: "Three touches", text: "Use all three contacts to get a better attack instead of sending a weak ball over on the second." },
      { title: "Hustle", text: "Chasing a shank off the court and getting it back in play wins points and lifts a team." },
    ],
    drills: [
      d("bb-second-ball", "Who takes the second ball", "coach", I, 12, "Team, a coach",
        ["Coach hits or tosses the first ball to the setter, so the setter has to dig.", "The assigned second-ball player (libero or right side) calls 'Got it!' and bump sets or hand sets high to a pin.", "Rotate through every rotation."],
        ["Decide the rule as a team and practice it.", "A high, hittable set beats a fast one.", "The call happens before the ball arrives."]),
      d("bb-chaos-to-kill", "Chaos to kill", "coach", A, 15, "Team, 6 v 6, a coach adding balls",
        ["The coach sends a bad pass or shanked dig to one team to start each rally.", "That team must turn it into an attack; score double for a kill out of system."],
        ["Teaches calm decisions in chaos.", "Hitters stay patient for a high set.", "Celebrate the 'better the ball' plays."]),
    ],
    questions: [
      q(A, "You're the libero. The setter digs the first ball near the 10-foot line in zone 2. You're in zone 5. What's the right second contact?", ["An overhand set from in front of the 10-foot line to the outside for a hard attack", "A bump set (or an overhand set from behind the 10-foot line) high to a pin", "Send it over", "Let the setter play it twice"], 1, "A libero's overhand set from in front of the 10-foot line can't be attacked above the net. A bump set from anywhere, or an overhand set from behind the line, is legal to attack."),
      q(A, "It's out of system. The setter calls for a high ball to the left. The block is big and set. What's the smartest attack?", ["Hit straight down into the block", "Swing high off the outside hand, or hit a deep roll to the corner", "Tip to the middle", "Catch and throw"], 1, "Against a set block on a high ball, tools and deep shots keep the rally and often score."),
      q(B, "The pass goes way off the net and the setter can't get there. What's the best play?", ["Send a free ball over on the second touch", "Another player sets a high ball to a pin so the team can still attack", "Let it drop", "Hit it over as hard as you can"], 1, "Using the second touch to set a high ball keeps your team in the rally with an attack."),
      q(B, "The setter dug the first ball. Who usually takes the second?", ["The setter again", "The libero or right side, as the team agreed", "Nobody", "Whoever is closest to the bench"], 1, "Teams plan who sets when the setter digs. Calling it early avoids confusion."),
      q(I, "You're hitting a low, tight set that you can't swing at well. What's smart?", ["Swing as hard as you can into the block", "Play a controlled shot: high off the block, a deep roll, or a tip to an open spot", "Catch it", "Let it go"], 1, "A smart shot keeps the ball in play or scores; a forced swing often becomes an error or a block."),
      q(I, "Your teammate shanks a pass toward the bleachers. What should you do?", ["Watch it go", "Chase it and play a high ball back into the court", "Wait for the rally to end", "Yell at your teammate"], 1, "Pursuing every ball is a habit of great teams; even a high bump back gives your team a chance."),
      q(A, "Late in a set, you get an out-of-system set in your weakest rotation. What's the best mindset?", ["Force a kill no matter what", "Make the best play available: keep it in, make them work, and win the next ball", "Give up the point", "Ask for a sub"], 1, "Out of system, keeping the ball in play and making the opponent work is usually the higher-percentage choice."),
    ],
  },
  {
    id: "setter-iq", name: "Setter decisions", kind: "Game IQ", tagline: "Run the offense like a quarterback.",
    intro: "Setters touch the second ball on almost every rally, so their decisions shape the whole offense. Great setters know their hitters' strengths, read the other team's block, use the quick attack to hold the middle blocker, and choose the high-percentage set when the pass is bad.",
    ideas: [
      { title: "Know your hitters", text: "Who's hot, who's tired, who hits well against a big block? FloorCall's stats show who's efficient tonight." },
      { title: "Read the middle blocker", text: "If the middle blocker commits on the quick, set the pins. If they drift outside early, set the quick." },
      { title: "Use the quick to hold the block", text: "A middle attack, even if it's not set, keeps the middle blocker home." },
      { title: "Match the set to the pass", text: "Perfect pass: run the fast plays. Off pass: high ball to the best out-of-system hitter." },
      { title: "Spread it, then go to your best", text: "Early in sets, use everyone. At 22–22, go to your most reliable option." },
    ],
    drills: [
      d("set-read-middle-blocker", "Read the middle blocker", "coach", A, 15, "Setter, three hitters, a middle blocker",
        ["The middle blocker chooses whether to commit on the quick or read.", "The setter watches the blocker during the pass and sets away from them.", "Score kills and how often the setter beat the block."],
        ["Setters see the middle blocker in their eye line before contact.", "Hitters keep running their approach every time.", "Talk after each rep: what did you see?"]),
      d("set-hot-hand", "Hot hand", "coach", I, 12, "Setter, hitters, a coach keeping a quick stat",
        ["During a scrimmage, the coach calls out hitters' efficiency every few rallies.", "The setter must use that information when choosing sets."],
        ["Setters learn to use real-time information.", "Share stats in a timeout too.", "Balance using the hot hand with keeping the defense honest."]),
    ],
    questions: [
      q(A, "Their middle blocker reads well and always gets to the outside. Your middle hitter is efficient tonight. What's the best plan?", ["Set the outside every time", "Feed the middle on good passes to hold their middle, so the outside faces one blocker later", "Dump every ball", "Set only back-row attacks"], 1, "Using the quick early keeps their middle home and opens the pins."),
      q(A, "You're the setter at 23–23. Your outside is 6-for-10, your right side is 2-for-8. The pass is perfect and their middle is shading outside. Best set?", ["Outside, because they're the hot hand", "A quick to your middle or a back set to the right side away from the shaded middle, depending on who's best on a single block", "Dump", "A back-row set"], 1, "The middle shading outside opens the quick or the right side. Great setters set the hitter facing the weakest block, not only the hot hand."),
      q(B, "The pass is perfect and the middle blocker has drifted toward your outside hitter. Where should you set?", ["The outside hitter", "The quick to the middle", "A free ball over", "A back set out of bounds"], 1, "If the middle blocker leaves early, the quick attack is open."),
      q(I, "Your outside hitter has 3 errors and no kills; your right side has 4 kills. It's 22–22. Who gets the set?", ["The outside, to get them going", "The right side, the most reliable option right now", "The libero", "Nobody: dump every time"], 1, "Late in a close set, go to the hitter who's producing. Help the struggling hitter early in the next set."),
      q(I, "The pass is off the net to the 10-foot line. What's the best set?", ["A fast quick to the middle", "A high set to a pin", "A slide", "A back set to the right side at speed"], 1, "From a pass off the net, high sets to the pins are safest and give the hitter time."),
      q(A, "Their middle blocker jumps with your quick hitter every time. What does that open?", ["Nothing", "The pins, especially the side away from the middle", "Only setter dumps", "Free balls"], 1, "If the middle commits to the quick, your outside or right side faces a single block."),
    ],
  },
  {
    id: "growth", name: "Growth mindset and practice habits", kind: "Mindset", tagline: "Better, not perfect.",
    intro: "Players improve fastest when they see errors as part of learning, practice with purpose, and focus on what they control: attitude, effort, communication, conditioning and how they learn. Talent helps, but daily habits decide how good you get.",
    ideas: [
      { title: "Better, not perfect", text: "Errors are information. The goal is to be a little better than yesterday." },
      { title: "Practice with purpose", text: "Pick one thing to improve each practice and focus on it in every drill." },
      { title: "Game-like reps", text: "Practice that looks like the game (reading, deciding, competing) transfers to matches best." },
      { title: "Hustle is a skill", text: "Effort, chasing balls and talking are choices you can make every day." },
      { title: "Track your progress", text: "Write it down and check your numbers (FloorCall's trends) every few weeks." },
    ],
    drills: [
      d("growth-one-percent", "One percent better", "player", B, 5, "Alone, a notebook",
        ["Before practice, write one small thing to get better at (for example, 'pass every serve to target with my feet set').", "After practice, write how it went and one thing for tomorrow."],
        ["Small, specific goals add up fast.", "Celebrate progress.", "Look back each month."]),
      d("growth-hustle-points", "Hustle points", "coach", B, 10, "Team, scrimmage",
        ["Award a bonus point for every hustle play: a pursuit, a dive, a big call, covering a hitter.", "Teammates can nominate plays."],
        ["Makes effort visible and valued.", "Builds a team culture of hustle.", "Keep it fun."]),
    ],
    questions: [
      q(A, "You keep making the same passing error. Your coach gives you a correction that feels awkward. What's the best plan?", ["Use it only in matches", "Use it in every practice rep for two weeks and track your pass average", "Use it only when you feel like it", "Ignore it until it feels natural"], 1, "Consistent reps with the change, and measuring the result, is how new technique becomes automatic."),
      q(B, "You keep missing a new jump serve in practice. What's the best attitude?", ["'I'm just bad at it'", "'Misses are part of learning; I'll focus on my toss and keep practicing'", "'I'll never use it'", "'The ball is bad'"], 1, "A growth mindset treats errors as part of getting better and focuses on the next small step."),
      q(B, "Which of these can you control every day?", ["The referee's calls", "Your effort, attitude and communication", "The other team's serving", "Who starts"], 1, "Effort, attitude, communication, conditioning and learning are always in your control."),
      q(I, "What makes practice transfer best to matches?", ["Only long, repetitive drills", "Game-like drills with reading, decisions and competition", "Only conditioning", "Only scrimmages with no feedback"], 1, "Game-like practice trains the reading and decisions that matches demand."),
      q(A, "You've been stuck at the same pass average for a month. What's the best next step?", ["Practice the same way, more", "Watch film, ask the coach for one change, and track the result", "Quit passing", "Blame the servers"], 1, "Feedback, a specific change and measuring it break plateaus."),
    ],
  },
];

/** Every topic: the mental game, then the work team school (refereeing at tournaments). */
export const MENTAL: MentalTopic[] = [...BASE, ...WORK_TOPICS];

export const MENTAL_DRILLS: (Drill & { topic: MentalId })[] = MENTAL.flatMap((t) => t.drills.map((x) => ({ ...x, topic: t.id })));
export const ALL_QUESTIONS: (Question & { topic: MentalId })[] = MENTAL.flatMap((t) => t.questions.map((x) => ({ ...x, topic: t.id })));

/** A quiz: questions from one topic (all of them) or `n` drawn from every topic (the Game IQ test), at one level or
 * all, in a stable order for a seed. A topic with too few at a level falls back to all levels. Pure. */
export function quizFor(topic: MentalId | "all", n = 10, seed = 1, level?: Level | ""): (Question & { topic: MentalId })[] {
  const base = topic === "all" ? ALL_QUESTIONS.filter((x) => !WORK_IDS.has(x.topic)) : ALL_QUESTIONS.filter((x) => x.topic === topic);
  const lv = level ? base.filter((x) => x.level === level) : base, pool = lv.length >= 2 ? lv : base;
  let h = seed >>> 0; const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const order = pool.map((x) => ({ x, k: rnd() })).sort((a, b) => a.k - b.k).map((y) => y.x);
  return topic === "all" ? order.slice(0, n) : order;
}
/** The work team school isn't part of the Game IQ test. */
const WORK_IDS = new Set<string>(WORK_TOPICS.map((t) => t.id));
/** Seconds per situation in timed mode: less time for harder questions. */
export const TIME_FOR: Record<Level, number> = { Beginner: 30, Intermediate: 25, Advanced: 18 };
/** The options in a shuffled order (so the best answer isn't always in the same place), with where the answer went. Pure. */
export function shuffled(x: Question, seed: number): { options: string[]; answer: number } {
  let h = (seed ^ (x.q.length * 2654435761)) >>> 0; const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const order = x.options.map((_, i) => ({ i, k: rnd() })).sort((a, b) => a.k - b.k).map((o) => o.i);
  return { options: order.map((i) => x.options[i]), answer: order.indexOf(x.answer) };
}
/** The score line after a quiz. Pure. */
export const quizVerdict = (right: number, total: number) => { const p = total ? right / total : 0; return p >= 0.9 ? "Game IQ: elite" : p >= 0.7 ? "Strong read of the game" : p >= 0.5 ? "Getting there" : "Keep studying: read the topics and try again"; };
