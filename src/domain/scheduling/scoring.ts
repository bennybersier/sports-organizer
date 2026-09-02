import type { Finding } from "./conflicts";
import type { Candidate } from "./candidates";
import type { Assignment, EngineTeam, OptimizerWeights } from "./types";

/**
 * Soft-constraint scoring.
 *
 * Every candidate starts at the full weight of each preference and loses points
 * for each one it fails to honour. The score is normalised to 0–100 so it means
 * the same thing regardless of how the weights are tuned — an organizer reading
 * "82" should not have to know the current weight table to interpret it.
 *
 * Every deduction also produces a `Finding`, so the score and the explanation
 * can never disagree: they are computed in the same pass.
 */

export interface ScoreContext {
  /** Already-placed sessions, used for spacing and balance. */
  placed: Assignment[];
  /** How many sessions each gym already holds, for balance. */
  gymLoad: Map<string, number>;
  /** Total sessions the whole run intends to place, for normalising balance. */
  totalSessions: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  satisfied: string[];
  tradeOffs: Finding[];
}

export function scoreCandidate(
  candidate: Candidate,
  team: EngineTeam,
  weights: OptimizerWeights,
  context: ScoreContext,
): ScoredCandidate {
  const satisfied: string[] = [];
  const tradeOffs: Finding[] = [];

  let earned = 0;
  let possible = 0;

  const award = (weight: number, met: boolean, code: string) => {
    possible += weight;
    if (met) {
      earned += weight;
      satisfied.push(code);
    } else {
      tradeOffs.push({ code: code as Finding["code"], severity: "WARNING" });
    }
  };

  // --- Stated preferences --------------------------------------------------
  if (team.preferredWeekdays.length > 0) {
    award(
      weights.preferredWeekday,
      team.preferredWeekdays.includes(candidate.isoWeekday),
      "NOT_PREFERRED_WEEKDAY",
    );
  }

  if (team.preferredStart !== null && team.preferredEnd !== null) {
    const inWindow =
      candidate.window.start >= team.preferredStart &&
      candidate.window.end <= team.preferredEnd;
    award(weights.preferredTime, inWindow, "NOT_PREFERRED_TIME");
  }

  if (team.preferredGymIds.length > 0) {
    award(
      weights.preferredGym,
      team.preferredGymIds.includes(candidate.gymId),
      "NOT_PREFERRED_GYM",
    );
  }

  // --- Derived quality -----------------------------------------------------
  const ownSessions = context.placed.filter((a) => a.teamId === team.id);

  if (ownSessions.length > 0) {
    // Spacing: sessions spread across the week beat sessions bunched together.
    possible += weights.sessionSpacing;
    const gaps = ownSessions.map((session) =>
      circularDayGap(session.isoWeekday, candidate.isoWeekday),
    );
    const closest = Math.min(...gaps);

    if (closest >= team.minDaysBetween && (team.maxDaysBetween === null || closest <= team.maxDaysBetween)) {
      // Reward proportionally: 3 days apart beats 1 day apart.
      earned += weights.sessionSpacing * Math.min(1, closest / 3);
      if (closest >= 2) satisfied.push("WELL_SPACED");
    } else {
      tradeOffs.push({
        code: "NOT_PREFERRED_WEEKDAY",
        severity: "WARNING",
        values: { gap: closest },
      });
    }

    // Consistency: the same hall each week is easier for everyone involved.
    possible += weights.gymConsistency;
    if (ownSessions.some((session) => session.gymId === candidate.gymId)) {
      earned += weights.gymConsistency;
      satisfied.push("CONSISTENT_GYM");
    }
  }

  // Trainer gaps: a coach with sessions back to back has a better evening than
  // one with three hours of dead time in the middle.
  if (candidate.trainerId) {
    const sameDay = context.placed.filter(
      (a) => a.trainerId === candidate.trainerId && a.isoWeekday === candidate.isoWeekday,
    );
    if (sameDay.length > 0) {
      possible += weights.trainerGaps;
      const nearest = Math.min(
        ...sameDay.map((session) =>
          session.window.end <= candidate.window.start
            ? candidate.window.start - session.window.end
            : session.window.start - candidate.window.end,
        ),
      );
      // Full marks for adjacent, tapering to nothing at three hours apart.
      earned += weights.trainerGaps * Math.max(0, 1 - Math.max(0, nearest) / 180);
      if (nearest <= 30) satisfied.push("NO_TRAINER_GAP");
    }
  }

  // Balance: keep halls evenly loaded rather than filling one and idling another.
  if (context.gymLoad.size > 1) {
    possible += weights.gymBalance;
    const load = context.gymLoad.get(candidate.gymId) ?? 0;
    const average = context.totalSessions / context.gymLoad.size;
    earned += weights.gymBalance * (load <= average ? 1 : Math.max(0, 1 - (load - average) / average));
    if (load <= average) satisfied.push("BALANCED_GYM_USE");
  }

  // With nothing to weigh, the placement is simply fine.
  const score = possible === 0 ? 100 : Math.round((earned / possible) * 100);

  return { candidate, score, satisfied, tradeOffs };
}

/**
 * Days between two weekdays, the short way round the week.
 * Monday and Sunday are one day apart, not six.
 */
export function circularDayGap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 7 - raw);
}
