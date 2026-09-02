/**
 * The scheduling engine's vocabulary.
 *
 * Everything here is plain data: the engine takes a `ScheduleInput` and returns
 * a `GenerationResult`, with no database, no clock and no randomness beyond a
 * seed it is handed. That is what makes it testable — and what makes a
 * generated schedule reproducible, which matters when an organizer asks why
 * last Tuesday's run produced something different.
 *
 * Times are minutes from midnight in the club's scheduling timezone. Dates are
 * resolved by the caller; the engine reasons about weekdays and minutes, and
 * the persistence layer converts to instants once, at the boundary.
 */

import type { IsoWeekday, MinuteWindow } from "../availability";
import type { Finding } from "./conflicts";

export interface EngineGym {
  id: string;
  name: string;
  /** Availability per weekday, already resolved from recurring + exceptions. */
  availability: Record<number, MinuteWindow[]>;
}

export interface EngineTrainer {
  id: string;
  name: string;
  availability: Record<number, MinuteWindow[]>;
  /** Teams this trainer coaches. A team can only use a trainer assigned to it. */
  teamIds: string[];
}

export interface EngineTeam {
  id: string;
  name: string;
  /** Empty means the team imposes no availability constraint of its own. */
  availability: Record<number, MinuteWindow[]>;

  sessionsPerWeek: number;
  durationMinutes: number;
  allowedWeekdays: number[];
  earliestStart: number;
  latestEnd: number;
  minDaysBetween: number;
  maxDaysBetween: number | null;
  allowedGymIds: string[];

  preferredWeekdays: number[];
  preferredStart: number | null;
  preferredEnd: number | null;
  preferredGymIds: string[];
}

/**
 * Weights for the soft constraints.
 *
 * Kept in one object rather than scattered through the scoring code, so tuning
 * the optimizer is a configuration change an organizer could eventually make,
 * not a code change. Ordered to match the priorities in the spec.
 */
export interface OptimizerWeights {
  preferredWeekday: number;
  preferredTime: number;
  preferredGym: number;
  /** Rewards spreading a team's sessions evenly across the week. */
  sessionSpacing: number;
  /** Rewards keeping a trainer's sessions close together. */
  trainerGaps: number;
  /** Rewards spreading load evenly across gyms. */
  gymBalance: number;
  /** Rewards reusing the same gym for one team, rather than moving it around. */
  gymConsistency: number;
}

export const DEFAULT_WEIGHTS: OptimizerWeights = {
  preferredWeekday: 30,
  preferredTime: 25,
  preferredGym: 20,
  sessionSpacing: 15,
  trainerGaps: 10,
  gymBalance: 8,
  gymConsistency: 5,
};

export interface ScheduleInput {
  teams: EngineTeam[];
  trainers: EngineTrainer[];
  gyms: EngineGym[];
  /** Times already taken — matches, tournaments, holidays, hall closures. */
  blockedSlots: BlockedSlot[];
  weights?: OptimizerWeights;
  /** Only affects tie-breaking, and only when scores are exactly equal. */
  seed?: number;
  /** Granularity of candidate start times. 15 or 30 minutes is sensible. */
  slotGranularityMinutes?: number;
}

export interface BlockedSlot {
  isoWeekday: IsoWeekday;
  window: MinuteWindow;
  gymId: string | null;
  trainerId: string | null;
  teamId: string | null;
  reason: string;
}

/** One placed training session. */
export interface Assignment {
  teamId: string;
  trainerId: string | null;
  gymId: string;
  isoWeekday: IsoWeekday;
  window: MinuteWindow;
  /** 0–100. What the soft constraints made of this placement. */
  score: number;
  /** Why this slot: satisfied constraints and trade-offs, for the UI. */
  explanation: SlotExplanation;
}

export interface SlotExplanation {
  /** Constraint codes this placement satisfies. */
  satisfied: string[];
  /** Preferences it could not honour, with what was chosen instead. */
  tradeOffs: Finding[];
  score: number;
  /** How many candidate slots were feasible for this session. */
  alternatives: number;
}

/** A requirement the engine could not meet, and why. */
export interface UnmetRequirement {
  teamId: string;
  teamName: string;
  requested: number;
  scheduled: number;
  /** Ordered most-explanatory first. */
  reasons: Finding[];
}

export interface GenerationResult {
  assignments: Assignment[];
  unmet: UnmetRequirement[];
  /** 0–100 across everything that *was* placed. */
  score: number;
  stats: {
    teams: number;
    sessionsRequested: number;
    sessionsScheduled: number;
    candidatesConsidered: number;
    gymUtilisation: Record<string, number>;
    elapsedMs: number;
  };
}
