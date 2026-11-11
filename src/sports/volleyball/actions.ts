/** Volleyball stat actions: every button on the tracking pad maps to one of these codes. */

export type Side = "us" | "them";

export interface ActionDef {
  /** Short label on the button. */
  label: string;
  /** Full name used in logs and play-by-play. */
  long: string;
  /** Which side wins the rally when this happens (for the team that recorded it). */
  point?: Side;
  /** Team-level action: no player needed. */
  team?: boolean;
  /** Player optional (misc errors, transition plays). */
  optionalPlayer?: boolean;
  /** Serve action: goes to the current server automatically. */
  serve?: boolean;
  /** Shorter label for narrow phone buttons. */
  short?: string;
}

export const ACTIONS = {
  K: { label: "Kill", long: "Kill", point: "us" },
  KT: { label: "Tool", long: "Kill off the block (tool)", point: "us" },
  TA: { label: "Attempt", long: "Attack attempt", short: "Att." },
  AE: { label: "Error", long: "Attack error", point: "them" },
  AB: { label: "Blocked", long: "Attack blocked", point: "them" },
  SATT: { label: "Attempt", long: "Set attempt" },
  AST: { label: "Assist", long: "Set assist" },
  BHE: { label: "Error", long: "Setting error", point: "them" },
  P3: { label: "3", long: "Pass 3" },
  P2: { label: "2", long: "Pass 2" },
  P1: { label: "1", long: "Pass 1" },
  P0: { label: "0", long: "Pass 0 (reception error)", point: "them" },
  D: { label: "Dig", long: "Dig" },
  DE: { label: "Dig error", long: "Dig error", point: "them" },
  FBR: { label: "Free ball to us", long: "Free ball received", team: true, short: "Free ball" },
  OVP: { label: "Overpass", long: "Overpass", optionalPlayer: true },
  FBS: { label: "Free ball given", long: "Free ball given", optionalPlayer: true, short: "Gave free" },
  SA: { label: "Ace", long: "Ace", point: "us", serve: true },
  SI: { label: "In", long: "Serve in", serve: true },
  SEN: { label: "Error · net", long: "Serve error (net)", point: "them", serve: true, short: "Net" },
  SEO: { label: "Error · out", long: "Serve error (out)", point: "them", serve: true, short: "Out" },
  SE: { label: "Error", long: "Serve error", point: "them", serve: true },
  BS: { label: "Solo block", long: "Solo block", point: "us", short: "Solo" },
  BA: { label: "Block assist", long: "Block assist", point: "us", short: "Assist" },
  BT: { label: "Touch", long: "Block touch", short: "Touch" }, // got a hand on it, ball stays in play
  BE: { label: "Net / error", long: "Block / net error", point: "them" },
  CE: { label: "Communication", long: "Communication error", point: "them", optionalPlayer: true, short: "Comms" },
  EE: { label: "Effort", long: "Effort error", point: "them", optionalPlayer: true },
  PE: { label: "Positioning", long: "Positioning error", point: "them", optionalPlayer: true, short: "Position" },
  REF: { label: "Bad ref call", long: "Bad ref call", point: "them", team: true, short: "Bad call" },
  OE: { label: "Their error", long: "Opponent error", point: "us", team: true },
  OK: { label: "Their kill", long: "Opponent kill", point: "them", team: true },
  OA: { label: "Their ace", long: "Opponent ace", point: "them", team: true },
  TP: { label: "Their point", long: "Opponent point", point: "them", team: true },
  UP: { label: "Our point", long: "Point", point: "us", team: true },
} as const satisfies Record<string, ActionDef>;

export type ActionCode = keyof typeof ACTIONS;

export const isAction = (t: string): t is ActionCode => Object.prototype.hasOwnProperty.call(ACTIONS, t);
export const action = (t: ActionCode): ActionDef => ACTIONS[t];

/** Button groups on the tracking pad, in the order coaches asked for. */
export const GROUPS: [string, ActionCode[]][] = [
  ["Hitting", ["K", "KT", "TA", "AE", "AB"]],
  ["Setting", ["SATT", "AST", "BHE"]],
  ["Serve receive", ["P3", "P2", "P1", "P0"]],
  ["Defense", ["D", "DE"]],
  ["Transition", ["FBR", "OVP", "FBS"]],
  ["Serve", ["SA", "SI", "SEN", "SEO"]],
  ["Block", ["BS", "BA", "BT", "BE"]],
  ["Misc", ["CE", "EE", "PE", "REF"]],
  ["Opponent", ["OE", "OK", "OA", "TP"]],
];

/** Which half of the court to show when asking where the ball landed. "them" = their side. */
export const LOCATION_HALF: Partial<Record<ActionCode, Side>> = {
  K: "them", KT: "them", TA: "them", SA: "them", SI: "them", OK: "us", OA: "us", P3: "us", P2: "us", P1: "us", P0: "us", D: "us",
};

/** Opponent actions that can carry their jersey number. */
export const OPP_NUMBER: Partial<Record<ActionCode, true>> = { OK: true, OA: true, OE: true, TP: true };

export const POSITIONS = ["OH", "MB", "OPP", "S", "L", "DS"] as const;
export type Position = (typeof POSITIONS)[number];
export const POSITION_ORDER: Record<string, number> = { S: 0, OPP: 1, OH: 2, MB: 3, L: 4, DS: 5 };

export type AttackContext = "P3" | "P2" | "P1" | "DIG" | "FREE" | "OTH";
export const CONTEXT_LABEL: Record<AttackContext, string> = {
  P3: "Off a 3 pass", P2: "Off a 2 pass", P1: "Off a 1 pass", DIG: "Off a dig", FREE: "Off a free ball", OTH: "Other / not recorded",
};
