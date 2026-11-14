/** The playbook: common defenses, blocking schemes, serve-receive shapes and hitting plays, as spots on our half of the court.
 * x runs 0–9 m left to right seen from behind our end line; y runs 0 (our end line) to 9 (the net).
 * Spots are in rotation order: right back, right front, middle front, left front, left back, middle back. */
export type PlayKind = "defense" | "block" | "receive" | "attack" | "mine";
export interface Spot { r: string; name: string; x: number; y: number; to?: [number, number] | null; lib?: boolean }
export interface Play { id: string; kind: PlayKind; name: string; note: string; spots: Spot[]; ball?: [number, number, number] | null }

export const KIND_LABEL: Record<PlayKind, string> = { defense: "Defenses", block: "Blocking", receive: "Serve receive", attack: "Hitting plays", mine: "My plays" };
type XY = [number, number];
const NAMES: Record<string, string> = { S: "Setter", OH: "Outside", MB: "Middle", RS: "Right side", L: "Libero", DS: "Def. spec." };
const six = (roles: string[], at: XY[], to: (XY | null)[] = []): Spot[] => roles.map((r, i) => ({ r, name: NAMES[r] || r, x: at[i][0], y: at[i][1], to: to[i] || null, lib: r === "L" }));

// base defense: where everyone waits before the other team attacks
const DR = ["S", "RS", "MB", "OH", "L", "OH"];
const BASE_D: XY[] = [[7.5, 4], [7.5, 8.3], [4.5, 8.3], [1.5, 8.3], [1.5, 4], [4.5, 2.2]];
const def = (id: string, name: string, note: string, to: (XY | null)[], ball: [number, number, number] | null): Play => ({ id, kind: "defense", name, note, spots: six(DR, BASE_D, to), ball });
const LEFT: [number, number, number] = [8, 9.5, 2.9], RIGHT: [number, number, number] = [1, 9.5, 2.9], MID: [number, number, number] = [4.5, 9.5, 2.9];

// serve receive: setter front right at the net
const RR = ["OH", "S", "MB", "OH", "L", "RS"];
// hitting plays: setter comes from right back to the target, three front-row hitters
const AR = ["S", "RS", "MB", "OH", "L", "OH"];
const ATT: XY[] = [[6.3, 8.4], [8.3, 5.4], [4.6, 5.8], [0.5, 5.2], [2.2, 3.2], [5.8, 2.6]];
const SET: [number, number, number] = [6.3, 8.6, 2.5];
const hit = (id: string, name: string, note: string, to: (XY | null)[]): Play => ({ id, kind: "attack", name, note, spots: six(AR, ATT, to), ball: SET });
const GO: XY = [0.9, 8.3], ONE: XY = [5.5, 8.3], BACK: XY = [8.3, 8.3];

export const LIBRARY: Play[] = [
  { id: "base", kind: "defense", name: "Base defense", note: "Where the six wait while the other team passes and sets. Front row at the net ready to block, back row balanced for a setter dump or an overpass.", spots: six(DR, BASE_D), ball: null },
  def("perimeter-out", "Perimeter vs outside", "Also called middle-back. Two blockers close on their outside hitter. The back row stays deep along the lines and the end line, and the off-blocker drops to the attack line for the sharp cross and tips.", [[8.4, 3.4], [8.1, 8.6], [7.3, 8.6], [3.2, 5.8], [1, 2.6], [5.6, 0.7]], LEFT),
  def("perimeter-rs", "Perimeter vs right side", "The same shape mirrored for an attack from their right side: block with your outside and middle, right front drops off the net.", [[8, 2.6], [5.8, 5.8], [1.7, 8.6], [0.9, 8.6], [0.6, 3.4], [3.4, 0.7]], RIGHT),
  def("rotation", "Rotation defense", "The line digger comes up behind the block to take tips. Middle back rotates to the line and left back slides to the deep cross corner. Strong against teams that tip and roll a lot.", [[7.7, 6.3], [8.1, 8.6], [7.3, 8.6], [2.4, 5.2], [2.6, 1.4], [8, 1.8]], LEFT),
  def("middle-up", "Middle-up (6 up)", "Middle back plays short behind the block for tips and balls off the block's hands. The two wing diggers own the deep corners, so they must cover a lot of floor.", [[8.2, 2], [8.1, 8.6], [7.3, 8.6], [2.8, 5.6], [1.2, 2], [5.6, 5.6]], LEFT),
  def("middle-middle", "Middle-middle", "Middle back sits in the heart of the court and reads the hitter. Simple to teach and good against teams that hit a lot of off-speed to the middle.", [[8.3, 3], [8.1, 8.6], [7.3, 8.6], [2.8, 6], [1, 3], [4.8, 4.2]], LEFT),
  def("vs-middle", "Defending the middle", "Against a quick in the middle: your middle blocks, the left front helps, and the back row squeezes the seams either side of the block.", [[7.6, 3.4], [7, 6.2], [4.5, 8.6], [3.6, 8.6], [1.4, 3.4], [4.5, 1]], MID),
  def("free-ball", "Free ball", "The other team can't attack. Everyone calls \"free\": front row drops off the net to pass and get ready to hit, the setter runs to the target.", [[6.3, 8.4], [7.9, 5.6], [4.5, 7.2], [1.3, 5.4], [2.8, 2.8], [5.6, 2.8]], [4.5, 10.5, 4]),

  { id: "bunch", kind: "block", name: "Bunch block", note: "Blockers start close together in the middle. It takes away the quick and the pipe and makes double blocks easier, but the pins have further to travel to the antenna.", spots: six(DR, [[7.5, 4], [6.2, 8.5], [4.5, 8.5], [2.8, 8.5], [1.5, 4], [4.5, 2.2]]), ball: null },
  { id: "spread", kind: "block", name: "Spread block", note: "Pin blockers start wide, near the antennas. It handles fast sets to the outside, but your middle is alone against the quick.", spots: six(DR, [[7.5, 4], [8.2, 8.5], [4.5, 8.5], [0.8, 8.5], [1.5, 4], [4.5, 2.2]]), ball: null },
  { id: "triple", kind: "block", name: "Triple block on the outside", note: "All three front-row players close on their best outside hitter. Use it on a high, slow set. The back row has to cover every tip.", spots: six(DR, BASE_D, [[8.3, 3], [8.2, 8.6], [7.4, 8.6], [6.6, 8.6], [2.4, 4.6], [5.4, 1.2]]), ball: LEFT },

  { id: "w", kind: "receive", name: "Five-player W", note: "Five passers in a W: three up, two back. It covers the whole court and suits younger teams. The setter waits at the net.", spots: six(RR, [[7.5, 5.6], [6.6, 8.5], [4.5, 6], [1.5, 5.6], [3, 2.6], [6, 2.6]]), ball: null },
  { id: "u", kind: "receive", name: "Four-player U", note: "Four passers in a cup. The middle hides at the net so she can run her approach without passing.", spots: six(RR, [[7.6, 5], [6.6, 8.6], [4.4, 8.4], [1.4, 5], [3.2, 2.8], [5.8, 2.8]]), ball: null },
  { id: "three", kind: "receive", name: "Three passers", note: "Your three best passers take every serve. Hitters stay out of the way and start their approach early. The standard at higher levels.", spots: six(RR, [[7.2, 3.4], [6.6, 8.6], [4, 8.4], [0.8, 6.6], [1.8, 3.4], [4.5, 3]]), ball: null },

  hit("go", "Go / hut (4)", "A fast set to the left antenna for your outside. The middle runs a quick to hold their middle blocker.", [null, BACK, ONE, GO, null, null]),
  hit("one", "Quick (1)", "The middle is in the air as the setter touches the ball, right in front of her. Needs a good pass.", [null, null, ONE, null, null, null]),
  hit("31", "31 / shoot", "A fast, low set to the middle in the gap between their middle and outside blockers.", [null, BACK, [3.2, 8.3], GO, null, null]),
  hit("slide", "Slide", "The middle runs behind the setter along the net and hits off one foot near the right antenna. Hard for their middle to follow.", [null, [5.2, 8.3], [8.2, 8.3], GO, null, null]),
  hit("back-one", "Back quick (A)", "A quick set right behind the setter. Pairs well with a go to keep blockers apart.", [null, null, [7.1, 8.3], GO, null, null]),
  hit("x", "X (cross)", "The middle goes up for a quick. The right side crosses behind her and hits a second-tempo ball in the middle. The blocker has to pick one.", [null, [4.6, 8.2], ONE, GO, null, null]),
  hit("tandem", "Tandem", "The outside comes inside and hits right behind the middle's quick. Two hitters, one blocker.", [null, BACK, ONE, [5, 7.9], null, null]),
  hit("double-quick", "Double quick", "Quicks in front of and behind the setter at the same time. The setter chooses after she sees their middle move.", [null, [7.1, 8.3], ONE, GO, null, null]),
  hit("pipe", "Pipe / bic", "A back-row attack through the middle, taking off behind the attack line. The middle's quick pulls the block up first. A bic is the same play, set faster and lower.", [null, BACK, ONE, GO, null, [4.8, 6.3]]),
  hit("red", "Back set (5 / red)", "A set behind the setter to the right antenna for your right side.", [null, BACK, ONE, null, null, null]),
];

export const blankPlay = (): Play => ({ id: "", kind: "mine", name: "New play", note: "", spots: six(DR, BASE_D), ball: null });
