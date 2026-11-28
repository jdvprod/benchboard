/** Work team school: what players do when their team works a match at a tournament (line judge, scorekeeper,
 *  libero tracker, down ref), with situations to test themselves on. Where rules differ between events (sub limits,
 *  whether a libero may serve, when to signal a wrong server), it says so and sends them to the head referee. */
import type { Level } from "./content";
import type { MentalTopic, Question } from "./mentalData";

const B: Level = "Beginner", I: Level = "Intermediate", A: Level = "Advanced";
const q = (level: Level, question: string, options: string[], answer: number, why: string): Question => ({ q: question, options, answer, why, level });
const d = (id: string, name: string, who: "player" | "coach", level: Level, minutes: number, needs: string, how: string[], points: string[]) =>
  ({ id: "wrk-" + id, name, who, level, minutes, needs, how, points });

export const WORK_TOPICS: MentalTopic[] = [
  { id: "work-basics", kind: "Work team", name: "Working a match", tagline: "Be ready, stay neutral, finish the job.",
    intro: "At most club tournaments, teams referee each other. When your team works, you're part of the officiating crew for a match that matters to two other teams, and they deserve the same care you'd want.",
    ideas: [
      { title: "Be there before it starts", text: "Get to the court while the match before is finishing, so the crew is set and the next match starts on time. Late work teams push the whole court behind." },
      { title: "Phones away, eyes up", text: "Your only job is the match in front of you. A missed call because you were looking down is the fastest way to get yelled at." },
      { title: "Stay neutral", text: "No cheering, no reactions, no talking to players, even if it's a rival or your friends. Officials don't pick sides." },
      { title: "The head referee is your boss", text: "Questions, problems and disagreements go to the head ref, not the coaches or the crowd. If a coach argues with you, stay calm and point them to the head ref." },
      { title: "Finish strong", text: "Stay sharp until the last point. Help the head ref check the score sheet, then thank them before you leave." },
    ],
    drills: [
      d("crew-scrim", "Crew reps in scrimmage", "coach", B, 15, "Two flags, a score sheet or a phone", ["During a practice scrimmage, players who are out of the rotation work as line judges, scorekeeper and scoreboard.", "Rotate jobs every set so everyone does each one.", "After the set, ask each worker for one call they weren't sure about."], ["Confident, clear signals", "Silent and neutral", "Score sheet matches the scoreboard"]),
    ],
    questions: [
      q(B, "Your team just lost a close match and you have to work the next one on the same court. What do you do?", ["Get to your spots right away, phones away", "Take ten minutes to get food first", "Wait until the coach finds you", "Leave it to the players who didn't play much"], 0, "The next match can't start without a crew. Being ready on time is the job, win or lose."),
      q(B, "Your best friend is playing in the match you're line judging. She hits a great kill. What do you do?", ["Stay quiet and make the call", "Cheer for her", "Give her a thumbs up", "Smile and wave"], 0, "Officials stay neutral. Any reaction makes the other team wonder if your calls are fair."),
      q(I, "A coach starts arguing with you about an out call. What's the best response?", ["Stay calm and point them to the head referee", "Argue back to explain what you saw", "Change your call to keep the peace", "Ignore them and look away"], 0, "The head referee handles disagreements. You made the call you saw; let the head ref deal with the coach."),
      q(I, "You realize you weren't watching when the ball landed near your line. What should you do?", ["Signal that you couldn't see it", "Guess, so you don't look bad", "Call it in to be safe", "Look at the players for a hint"], 0, "Officials have a signal for 'I couldn't see it'. An honest no-call is better than a guess, and the head ref decides."),
      q(A, "Late in the deciding set, a parent yells at you after every call. What's the best mindset?", ["Make each call the same way you made the first one", "Make the next close call go their team's way", "Stop signaling close calls", "Yell back so they stop"], 0, "Pressure tests consistency. Calling it the same at 13–13 as at 2–2 is what makes you a good official."),
    ] },

  { id: "line-judge", kind: "Work team", name: "Line judge", tagline: "In, out, touched: clear and confident.",
    intro: "Two line judges usually stand at opposite corners of the court, each watching the end line and the sideline that meet at their corner. Some events use four, one per line. Your flag tells the head referee what you saw.",
    ideas: [
      { title: "Ball in", text: "Point the flag down at the floor, firmly." },
      { title: "Ball out", text: "Raise the flag straight up." },
      { title: "Touched, then out", text: "Raise the flag and touch the top of it with the palm of your other hand. This means a player touched it before it went out, so it's not the attackers' error." },
      { title: "Antenna or foot fault", text: "Wave the flag over your head, then point to the antenna (the ball hit it or went outside it) or to the end line (the server stepped on or over it)." },
      { title: "Couldn't see", text: "Cross both forearms in front of your chest. It's honest, and it lets the head referee decide." },
      { title: "Hold it", text: "Keep your signal up until the head referee sees it. A quick flick gets missed." },
    ],
    drills: [
      d("lines-video", "Call it from video", "player", B, 10, "Any match video", ["Watch rallies that end near a line, and pause right before the ball lands.", "Say your call out loud, then play it and check.", "Do ten, and count how many you got right."], ["Watch the ball, not the players", "Decide before you see the replay"]),
    ],
    questions: [
      q(B, "The ball lands clearly inside your line. What's your signal?", ["Point the flag down at the floor", "Raise the flag straight up", "Wave the flag over your head", "Do nothing"], 0, "Ball in: point the flag firmly down at the floor, and hold it until the head referee sees it."),
      q(B, "The ball lands clearly outside your line, with no one touching it. What's your signal?", ["Raise the flag straight up", "Point the flag down", "Cross your arms", "Touch the top of the flag"], 0, "Ball out: raise the flag straight up, and hold it until the head referee sees it."),
      q(I, "A hit goes off the blocker's fingertips and lands out. What do you signal?", ["Raise the flag and touch its top with your palm", "Raise the flag straight up", "Point the flag down", "Wave the flag over your head"], 0, "'Touched' means the defense touched it, so it's the attacking team's point, not an attack error."),
      q(I, "A player blocks your view and you can't see where the ball landed. What do you do?", ["Cross both forearms in front of your chest", "Call it out", "Call it in", "Shrug at the referee"], 0, "That's the signal for 'couldn't see'. The head referee decides."),
      q(I, "The server's foot lands on the end line as they hit the serve. What do you signal?", ["Wave the flag over your head and point to the end line", "Raise the flag straight up", "Point the flag down", "Nothing; only the head ref calls that"], 0, "A foot fault on the serve: wave the flag, then point to the line."),
      q(A, "An attack goes outside the antenna and lands in the court. What's the call?", ["Wave the flag and point to the antenna: it's out", "Ball in, because it landed inside", "Touched", "Couldn't see"], 0, "A ball that crosses the net outside the antenna is out, even if it lands in. Wave the flag and point to the antenna."),
      q(A, "Where do you watch on a hard-driven ball near your line?", ["Where the ball touches the floor, staying still", "The hitter's arm", "The ball in the air until it's past you", "The head referee"], 0, "Watch the spot, stay still, and judge where the ball first touches the floor. Moving your head makes close calls harder."),
    ] },

  { id: "scorekeeper", kind: "Work team", name: "Scorekeeper", tagline: "The score sheet is the official match.",
    intro: "The scorekeeper keeps the official record: the lineups, every point, who served, every sub and timeout. If the scoreboard and the score sheet disagree, the score sheet wins, so the scoreboard follows you.",
    ideas: [
      { title: "Lineups first", text: "Before each set, each coach hands in a lineup. Write the serving order exactly as given: it decides who serves next all set." },
      { title: "Every point, every time", text: "Mark the running score for the team that won the rally, right away. Check the scoreboard against your sheet often." },
      { title: "Follow the serve", text: "When the receiving team wins a rally, it gets the serve and rotates, and the next player in its order serves. Always know who should be serving next." },
      { title: "Subs and timeouts", text: "Write down each sub (who came in for whom) and each timeout. Teams have limits per set that depend on the event's rules; tell the down ref when a team uses its last one." },
      { title: "Wrong server", text: "If the wrong player goes back to serve, tell the down ref right away. Rules differ on exactly when to signal, so ask the head referee before the match." },
      { title: "Sign off", text: "At the end, the head referee checks the sheet. Fix anything they find before you go." },
    ],
    drills: [
      d("sheet-scrim", "Keep the book", "coach", I, 20, "A blank score sheet", ["Have two players keep score sheets on a practice scrimmage while the coach tracks it in FloorCall.", "After the set, compare the sheets with the app's play-by-play.", "Walk through any difference: who served, and when."], ["Serving order right all set", "Subs and timeouts written", "Final score matches"]),
    ],
    questions: [
      q(B, "The scoreboard says 14–12 but your score sheet says 13–12. Which is official?", ["The score sheet", "The scoreboard", "Whatever the coaches agree on", "The bigger number"], 0, "The score sheet is the official record. Tell the down ref and get the scoreboard fixed."),
      q(B, "Before the first serve of a set, what do you need from each coach?", ["Their lineup, in serving order", "Their team's record", "Their phone number", "Nothing, just start"], 0, "The lineup sets the serving order for the whole set."),
      q(I, "Team A is serving. Team B wins the rally. What happens next?", ["Team B gets a point, rotates, and its next server serves", "Team A serves again", "Team B gets a point and the same player serves", "Nothing changes"], 0, "Winning the rally while receiving earns the point and the serve, and the team rotates first."),
      q(I, "A coach calls a timeout. What do you write down?", ["That team's timeout, and the score when it was called", "Nothing; timeouts aren't recorded", "The time of day", "The other team's timeout"], 0, "Each timeout is recorded with the score, so everyone knows how many each team has left."),
      q(A, "You notice the wrong player is about to serve for Team B. What do you do?", ["Tell the down ref right away, the way the head ref asked", "Tell Team B's coach", "Say nothing; it's not your job", "Wait until the end of the set"], 0, "Catching a wrong server is one of the scorekeeper's most important jobs. Go through the down ref."),
      q(A, "A team asks for another sub, but you count that they've used their limit for the set. What do you do?", ["Tell the down ref before the sub happens", "Let it happen and fix it later", "Tell the player to go back", "Ignore it"], 0, "Sub limits depend on the event's rules. Your count is the record, so say so before the sub, through the down ref."),
    ] },

  { id: "libero-tracker", kind: "Work team", name: "Libero tracker", tagline: "Every swap in and out, written down.",
    intro: "The libero wears a different color and plays in the back row. Libero swaps don't count as subs, which is why someone has to track every one: who left, who came in, and when.",
    ideas: [
      { title: "Write every swap", text: "Each time the libero comes in or goes out, write the libero's number, the player they swapped with, and the score." },
      { title: "The same player comes back", text: "The libero can only be replaced by the player they replaced. If a different player comes in for the libero, tell the down ref." },
      { title: "A rally in between", text: "There must be a completed rally between the libero going out and coming back in. A swap with no rally in between is illegal." },
      { title: "Back row only", text: "When the libero's spot rotates to the front row, the libero has to leave. Watch for it every rotation." },
      { title: "Serving rules differ", text: "Some events let the libero serve in one spot of the order and some don't. Ask the head referee before the match." },
    ],
    drills: [
      d("libero-film", "Track the libero on film", "player", I, 15, "Match video and paper", ["Watch one set and write down every libero swap: libero number, player, score.", "Check that the same player always comes back in for the libero.", "Count the rallies between swaps."], ["Every swap written", "Catch a missing rally"]),
    ],
    questions: [
      q(B, "Why does someone track the libero separately?", ["Libero swaps don't count as subs, so they need their own record", "The libero is the captain", "The libero scores the most points", "So the libero can serve"], 0, "Libero replacements are unlimited and don't count as subs, so they're tracked on their own."),
      q(I, "The libero came in for #7. Now #12 is walking on to replace the libero. What do you do?", ["Tell the down ref: the libero can only be replaced by #7", "Write it down and move on", "Tell #12 to go back yourself", "Nothing; any player can replace the libero"], 0, "The libero can only be replaced by the player they replaced."),
      q(I, "The libero goes out and wants to come right back in without a rally being played. Is that legal?", ["No: a rally has to be completed in between", "Yes, any time", "Only during a timeout", "Only if the coach asks"], 0, "There must be a completed rally between the libero leaving and returning."),
      q(A, "The libero's spot rotates to the front row and the libero stays on. What happened?", ["A fault: the libero has to leave before playing in the front row", "Nothing; liberos can play anywhere", "It's fine if they don't jump", "The team loses a timeout"], 0, "The libero is a back-row player. Tell the down ref right away."),
      q(A, "The libero goes back to serve. What should you already know?", ["Whether this event lets the libero serve, from the head ref", "That liberos can never serve anywhere", "That liberos can always serve", "Nothing; it's not your job"], 0, "Rules differ between events. Ask the head referee before the match so you know what to watch for."),
    ] },

  { id: "down-ref", kind: "Work team", name: "Down ref", tagline: "The net, the center line, and the bench.",
    intro: "The down ref (second referee) stands on the floor at the net post, across from the head referee. In many junior events an older player or a coach works this job. It's the busiest spot on the crew.",
    ideas: [
      { title: "Your zone", text: "Watch the net and the center line, especially on your side: players touching the net, or stepping fully across the center line." },
      { title: "Check the receivers", text: "Before each serve, check that the receiving team is lined up in its rotation order (no overlap)." },
      { title: "Subs and timeouts", text: "When a coach asks for a sub or timeout, make it happen and make sure the scorekeeper records it." },
      { title: "Back up the head ref", text: "Help with calls the head referee can't see well, and mirror their signals so both benches see them." },
      { title: "Work with the scorekeeper", text: "Before every set, check the lineups with the scorekeeper. If they flag a problem, deal with it before play goes on." },
    ],
    drills: [
      d("r2-net", "Net-watch reps", "coach", A, 10, "A net and a hitting line", ["During hitting lines, one player stands at the post as down ref and calls net touches out loud.", "The coach confirms or corrects each call.", "Switch every five attacks."], ["Watch the net, not the ball", "A clear call every time"]),
    ],
    questions: [
      q(B, "Where does the down ref stand?", ["On the floor at the net post, across from the head referee", "On the stand next to the head referee", "Behind the end line", "At the score table"], 0, "The down ref works on the floor at the post, opposite the head referee."),
      q(I, "A coach asks for a sub. What's the down ref's job?", ["Allow the sub and make sure the scorekeeper records it", "Tell the coach to ask the head ref", "Ignore it until the set ends", "Write it down yourself only"], 0, "The down ref manages subs and timeouts with the scorekeeper."),
      q(I, "A blocker brushes the net while playing the ball. Whose call is it most likely to be?", ["The down ref's, if it's on their side", "The line judge's", "The scorekeeper's", "Nobody's"], 0, "Net touches are a big part of the down ref's job, especially on their side of the net."),
      q(A, "Before a serve, the receiving team's middle and outside have swapped spots in a way that breaks their rotation order. What do you do?", ["Whistle the overlap fault when the serve is hit", "Ignore it; only serving teams can overlap", "Tell the coach after the rally", "Ask the players to fix it after the serve"], 0, "Checking the receiving team's positions is the down ref's job. An overlap is a fault at the moment of the serve."),
      q(A, "The scorekeeper tells you a team has already used its last timeout, and the coach asks for another. What do you do?", ["Deny it and explain, with the head referee's backing", "Give it anyway", "Ask the other coach", "Let the scorekeeper decide"], 0, "The score sheet is the record. Deny it politely; the head referee backs you."),
    ] },
];
