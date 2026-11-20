/** Optional physical and strength numbers for a recruiting profile: what college staff actually ask about. Every one is
 * optional and typed the way the athlete writes it ("9'8\"", "4.9 s", "185 lb"). Shared by the coach's recruiting
 * profile, the published profile page, and the athlete's own details in FloorCall Recruit. */
export type PhysKey = "wingspan" | "reach" | "approach" | "block" | "vert" | "approachVert" | "broad" | "shuttle" | "sprint" | "bench" | "squat" | "deadlift" | "clean" | "pullups" | "tested";
export type PhysGroup = "Reach and jump" | "Speed" | "Strength";
export const PHYS_GROUPS: PhysGroup[] = ["Reach and jump", "Speed", "Strength"];
export const PHYSICAL: [PhysKey, string, string, PhysGroup][] = [
  ["wingspan", "Wingspan", `6'2"`, "Reach and jump"], ["reach", "Standing reach", `7'6"`, "Reach and jump"],
  ["approach", "Approach jump (touch)", `9'8"`, "Reach and jump"], ["block", "Block jump (touch)", `9'2"`, "Reach and jump"],
  ["vert", "Standing vertical", `22"`, "Reach and jump"], ["approachVert", "Approach vertical", `28"`, "Reach and jump"], ["broad", "Broad jump", `8'2"`, "Reach and jump"],
  ["shuttle", "5-10-5 shuttle", "4.9 s", "Speed"], ["sprint", "10-yard sprint", "1.8 s", "Speed"],
  ["bench", "Bench press", "115 lb", "Strength"], ["squat", "Back squat", "205 lb", "Strength"], ["deadlift", "Deadlift", "245 lb", "Strength"],
  ["clean", "Power clean", "135 lb", "Strength"], ["pullups", "Pull-ups", "8", "Strength"],
];
export const PHYS_KEYS = PHYSICAL.map((x) => x[0]).concat("tested") as PhysKey[];
/** The filled-in ones, as [label, value], in order. */
export const physOf = (o: Partial<Record<PhysKey, string | undefined>> | undefined, group?: PhysGroup): [string, string][] =>
  PHYSICAL.filter(([k, , , g]) => (!group || g === group) && o?.[k]?.trim()).map(([k, l]) => [l, o![k]!.trim()]);
