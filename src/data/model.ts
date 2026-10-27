/** Everything Benchboard saves. Each record belongs to a team, so one coach can run many teams. */
import type { MatchEvent } from "../sports/volleyball/engine";

export interface TeamSettings {
  subLimit: number;        // subs allowed per set (0 = no limit)
  bestOf: number;          // default match format (2 = two sets, pool play)
  scoring?: string;        // default scoring: "25", "25c27", "21", "21c23"
  askLoc: boolean;         // ask where the ball landed
  askLocDigs: boolean;     // also ask after digs
  askOpp: boolean;         // ask for their jersey number
  hideZones: boolean;      // hide zone numbers on drawing boards
}
export const DEFAULT_SETTINGS: TeamSettings = { subLimit: 15, bestOf: 5, askLoc: true, askLocDigs: false, askOpp: true, hideZones: false };

export interface Lineup { lu: string[]; lib: string | null; libSrv: string | null }

export interface Team {
  id: string;
  name: string;
  level: string;           // e.g. "Varsity", "JV", "16U Club"
  color: string;           // primary team color (hex)
  createdAt: number;
  activeSeasonId: string | null;
  currentMatchId: string | null;
  settings: TeamSettings;
  defLineup: Lineup | null;
  /** The coach confirmed they have permission (school, club, families) to record these players. */
  rosterConsent?: { at: number; by: string; version: string } | null;
  scrimSplit?: { aName: string; bName: string; a: string[]; b: string[]; out: string[]; to: number; games: number } | null;
  luAdvice?: { lineup: string[]; libero: string | null; summary: string; reasons: string[]; serveReceive: string[]; at: number } | null;
  sample?: boolean;
  /** Where players stand in each rotation (serve receive, serving, base defense). */
  formations?: import("../sports/volleyball/formations").Formations | null;
  /** Substitutions planned by rotation, e.g. a DS in for the opposite in rotation 4. */
  subPlan?: { id: string; rot: number; out: string; in: string }[];
  /** Getting-started checklist dismissed. */
  setupDone?: boolean;
  /** Season targets the team is chasing, shown on Home. */
  targets?: Partial<Record<"hitting" | "sideOut" | "pointScoring" | "passAvg" | "serveIn" | "firstBallSO", number>>;
  /** Upcoming matches. */
  schedule?: ScheduleItem[];
  formationPresets?: { id: string; name: string; f: import("../sports/volleyball/formations").Formations }[];
}

export interface Season { id: string; teamId: string; name: string; createdAt: number }

export type GoalMetric = "hitting" | "passAvg" | "serveIn" | "killsPerSet" | "digsPerSet" | "acesPerSet" | "blocksPerSet" | "assistsPerSet" | "perfectPass" | "serveEff";
export interface Goal { id: string; metric: GoalMetric; target: number; note?: string }

export interface Player {
  id: string; teamId: string;
  num: string; first: string; last: string; pos: string;
  grad: number | null;     // graduation year (recruiting)
  height: string;          // e.g. 5'10"
  active: boolean;
  goals: Goal[];
  notes: string;
  /** The family asked to keep this player off public pages: gamecasts and the season page show only the jersey number, and share graphics leave them out. */
  hidePublic?: boolean;
  /** Recruiting profile (shared only when the coach downloads the sheet). */
  profile?: RecruitProfile;
}
export interface RecruitProfile { consentAt?: number; consentBy?: string; sharedUrl?: string; club?: string; gpa?: string; email?: string; phone?: string; reach?: string; approach?: string; block?: string; hand?: string; video?: string; about?: string; coachContact?: string }

export type MatchKind = "match" | "scrimmage" | "drills";
export interface ScrimSetup { a: { name: string; ids: string[] }; b: { name: string; ids: string[] }; to: number }

export interface Match {
  id: string; teamId: string; seasonId: string | null;
  kind: MatchKind;
  opp: string;             // opponent name, or session name for practice
  date: string;            // YYYY-MM-DD
  bestOf: number;
  /** Scoring: points per set (default 25), optional cap. */
  setTo?: number; cap?: number | null;
  status: "live" | "done";
  site: "home" | "away" | "neutral" | "";
  event: string;           // tournament / league name
  notes: string;
  oppPlayers: string[];
  scrim: ScrimSetup | null;
  filmStart: number | null;
  /** Match video link and how many seconds into it the tracking clock starts. */
  video?: string; videoOffset?: number;
  nextLu: Lineup | null;
  report: string; reportAt: number | null;
  planId: string | null;
  createdAt: number;
  sample?: boolean;
}

/** Events recorded on one device for one match. Several devices can record the same match. */
export interface EventLog { id: string; matchId: string; device: string; events: MatchEvent[];
  /** Who is tracking on this device and their job, so other coaches on the match can see it. */
  by?: string; job?: "all" | "score" | "stats"; groups?: string[]; seen?: number }

export interface PlanItem { id: string; text: string; done?: boolean }
export interface Opponent { id: string; teamId: string; name: string; notes: string; scout: string; scoutAt: number | null; plan?: PlanItem[]; roster?: Record<string, { name?: string; pos?: string }> }
export interface ScheduleItem { id: string; date: string; time: string; opp: string; site: "home" | "away" | "neutral" | ""; event: string }

export const DRILL_CATEGORIES = ["Warm-up", "Serving", "Serve receive", "Setting", "Attacking", "Blocking", "Defense", "Transition", "Game play", "Conditioning", "Team talk"] as const;
export interface Drill { id: string; teamId: string; name: string; category: string; minutes: number; description: string; focus: string[] }
export interface PlanBlock { id: string; title: string; category: string; minutes: number; notes: string; drillId: string | null; done?: boolean }
export interface PracticePlan {
  id: string; teamId: string; seasonId: string | null;
  date: string; title: string; start: string;  // start time, e.g. 15:30
  blocks: PlanBlock[]; notes: string; status: "planned" | "done"; createdAt: number;
  /** Who was at practice: present, late or absent (missing = not taken). */
  attendance?: Record<string, "in" | "late" | "out">;
}

export interface Board { id: string; teamId: string; name: "hit" | "serve" | "def"; strokes: Stroke[] }
export interface Stroke { tool: "pen" | "arrow" | "dot" | "hl"; color: string; pts: [number, number][] }

export interface Prefs { theme: "system" | "light" | "dark"; size: "normal" | "large"; teamId: string | null; focus?: boolean; quick?: boolean; labsFocus?: boolean; offline?: boolean;
  /** This device's job when several coaches track one match: everything, only the score, or chosen stats that don't change the score. */
  job?: "all" | "score" | "stats"; jobGroups?: string[] }

export const STORES = ["teams", "seasons", "players", "matches", "logs", "opponents", "drills", "plans", "boards", "kv"] as const;
export type StoreName = (typeof STORES)[number];
export interface StoreTypes {
  teams: Team; seasons: Season; players: Player; matches: Match; logs: EventLog; opponents: Opponent;
  drills: Drill; plans: PracticePlan; boards: Board; kv: { id: string; value: any };
}
