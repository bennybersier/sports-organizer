import { overlaps, type IsoWeekday, type MinuteWindow } from "../availability";
import {
  NO_GYM_SHARING,
  assessGymShare,
  type GymSharingPolicy,
  type ShareAssessment,
  type ShareVerdict,
} from "./sharing";
import { generateCandidates, diagnoseNoCandidates, type Candidate } from "./candidates";
import {
  analyseWeekdays,
  suggestFixes,
  weeklyCeiling,
  type WeekdayCapacity,
} from "./capacity";
import { circularDayGap, scoreCandidate, type ScoreContext } from "./scoring";
import type { Finding } from "./conflicts";
import {
  DEFAULT_WEIGHTS,
  type Assignment,
  type EngineTeam,
  type GenerationResult,
  type ScheduleInput,
  type UnmetRequirement,
} from "./types";

/**
 * The schedule optimizer.
 *
 * Deterministic by construction: no clock, no randomness, and candidates are
 * ordered by a total ordering that never depends on object iteration order. The
 * same input produces the same schedule, every time — which is what lets an
 * organizer rerun a generation after a small change and see only the difference
 * that change caused.
 *
 * The strategy is most-constrained-first greedy assignment with a local
 * improvement pass:
 *
 *   1. Generate every feasible candidate for every team.
 *   2. Schedule the *hardest* teams first — the ones with fewest options. A
 *      team with 60 possible slots can nearly always be fitted around others;
 *      a team with 2 cannot, so it must not lose them to a team that had a
 *      choice.
 *   3. Within a team, take the highest-scoring candidate that is still free.
 *   4. Re-run a repair pass for anything left unplaced, since earlier
 *      placements have since fixed the picture.
 *
 * This is not an optimal solver, and does not pretend to be — but it is
 * explainable at every step, which for a club schedule matters more than the
 * last few points of score. The interface is deliberately shaped so a stronger
 * solver can replace `assign` without touching anything else.
 */

/**
 * What a shared placement costs, for display only.
 *
 * Not a weight: selection is already decided by the strict/shared partition, so
 * this cannot move a session. It exists so a schedule that leaned on a hall's
 * changeover tolerance does not score identically to one that did not.
 */
const SHARED_PLACEMENT_DEDUCTION = 10;

interface Occupancy {
  gym: Map<string, { window: { start: number; end: number }; weekday: number }[]>;
  trainer: Map<string, { window: { start: number; end: number }; weekday: number }[]>;
  team: Map<string, { window: { start: number; end: number }; weekday: number }[]>;
}

function emptyOccupancy(): Occupancy {
  return { gym: new Map(), trainer: new Map(), team: new Map() };
}

interface CandidateAssessment {
  verdict: ShareVerdict;
  /** Which resource refused it, for the shortfall explanation. */
  blockedBy: "GYM" | "TRAINER" | "TEAM" | null;
  share: ShareAssessment;
}

const NOT_SHARED: ShareAssessment = { verdict: "FREE", sharedWith: 0, longestOverlap: 0 };

/**
 * Can this candidate be placed, and would it have to share the hall?
 *
 * A coach and a team can only be in one place, so those clashes stay absolute
 * however tolerant a hall is. Only the hall itself has a policy, and only it
 * can come back "yes, but shared".
 */
function assessCandidate(
  occupancy: Occupancy,
  candidate: Candidate,
  sharing: Map<string, GymSharingPolicy>,
): CandidateAssessment {
  const clashes = (
    map: Map<string, { window: { start: number; end: number }; weekday: number }[]>,
    key: string | null,
  ) => {
    if (!key) return false;
    return (map.get(key) ?? []).some(
      (booked) =>
        booked.weekday === candidate.isoWeekday && overlaps(candidate.window, booked.window),
    );
  };

  if (clashes(occupancy.trainer, candidate.trainerId)) {
    return { verdict: "BLOCKED", blockedBy: "TRAINER", share: NOT_SHARED };
  }
  if (clashes(occupancy.team, candidate.teamId)) {
    return { verdict: "BLOCKED", blockedBy: "TEAM", share: NOT_SHARED };
  }

  const booked: MinuteWindow[] = (occupancy.gym.get(candidate.gymId) ?? [])
    .filter((entry) => entry.weekday === candidate.isoWeekday)
    .map((entry) => entry.window);

  const share = assessGymShare(
    booked,
    candidate.window,
    sharing.get(candidate.gymId) ?? NO_GYM_SHARING,
  );

  return {
    verdict: share.verdict,
    blockedBy: share.verdict === "BLOCKED" ? "GYM" : null,
    share,
  };
}

function occupy(occupancy: Occupancy, candidate: Candidate): void {
  const record = { window: candidate.window, weekday: candidate.isoWeekday };
  const push = (
    map: Map<string, { window: { start: number; end: number }; weekday: number }[]>,
    key: string | null,
  ) => {
    if (!key) return;
    map.set(key, [...(map.get(key) ?? []), record]);
  };

  push(occupancy.gym, candidate.gymId);
  push(occupancy.trainer, candidate.trainerId);
  push(occupancy.team, candidate.teamId);
}

/**
 * Does this candidate respect the team's own spacing rules given what it
 * already has? Enforced here rather than in candidate generation because it
 * depends on the other sessions, which aren't known until placement.
 */
function respectsSpacing(team: EngineTeam, candidate: Candidate, placed: Assignment[]): boolean {
  const own = placed.filter((assignment) => assignment.teamId === team.id);

  for (const session of own) {
    const gap = circularDayGap(session.isoWeekday, candidate.isoWeekday);

    // Two sessions on one day are only allowed when the team said so.
    if (gap === 0 && team.minDaysBetween > 0) return false;
    if (gap < team.minDaysBetween) return false;
  }

  return true;
}

export function generateSchedule(input: ScheduleInput): GenerationResult {
  const startedAt = Date.now();
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const granularity = input.slotGranularityMinutes ?? 30;

  const occupancy = emptyOccupancy();
  const assignments: Assignment[] = [];
  const unmet: UnmetRequirement[] = [];

  const gymLoad = new Map(input.gyms.map((gym) => [gym.id, 0]));
  const sharing = new Map(input.gyms.map((gym) => [gym.id, gym.sharing ?? NO_GYM_SHARING]));
  const totalSessions = input.teams.reduce((sum, team) => sum + team.sessionsPerWeek, 0);

  // Candidates are generated once per team; placement only filters them.
  const candidatesByTeam = new Map<string, Candidate[]>();
  let candidatesConsidered = 0;

  for (const team of input.teams) {
    const candidates = generateCandidates(
      team,
      input.gyms,
      input.trainers,
      input.blockedSlots,
      granularity,
    );
    candidatesByTeam.set(team.id, candidates);
    candidatesConsidered += candidates.length;
  }

  /*
    Priority first, then most-constrained-first.

    A club's ranking is a decision, not a heuristic: if the first team must have
    the main hall on Tuesday, no amount of "the under-13s had fewer options"
    should outrank that. So teams are served in priority order, and the
    most-constrained rule — which is a good tie-breaker and a poor policy —
    settles teams of equal priority. Ties then break on more sessions first,
    then on id, so the ordering is total and the run reproducible.
  */
  const order = [...input.teams].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const roomA = (candidatesByTeam.get(a.id)?.length ?? 0) / Math.max(1, a.sessionsPerWeek);
    const roomB = (candidatesByTeam.get(b.id)?.length ?? 0) / Math.max(1, b.sessionsPerWeek);
    if (roomA !== roomB) return roomA - roomB;
    if (a.sessionsPerWeek !== b.sessionsPerWeek) return b.sessionsPerWeek - a.sessionsPerWeek;
    return a.id.localeCompare(b.id);
  });

  const shortfalls: EngineTeam[] = [];

  for (const team of order) {
    const placed = placeSessionsFor(team, candidatesByTeam.get(team.id) ?? [], {
      allowSharing: false,
    });
    if (placed < team.sessionsPerWeek) shortfalls.push(team);
  }

  /*
    Repair pass. A team that ran out of room early may have options now that
    everything else has settled — placements are not re-shuffled, but the
    leftovers get a second look against the finished picture.

    This is also where a hall's changeover tolerance is allowed to count. Only a
    team that could not be placed without it ever reaches here, so sharing stays
    a concession rather than a default, and the highest-priority short team gets
    first refusal on the shared slots.
  */
  for (const team of shortfalls) {
    const total = placeSessionsFor(team, candidatesByTeam.get(team.id) ?? [], {
      allowSharing: true,
    });

    if (total < team.sessionsPerWeek) {
      unmet.push({
        teamId: team.id,
        teamName: team.name,
        requested: team.sessionsPerWeek,
        scheduled: total,
        reasons: explainShortfall(team, candidatesByTeam.get(team.id) ?? []),
      });
    }
  }

  /**
   * Places sessions for a team until it has what it asked for or runs out of
   * room. Returns the team's *total* placed count, not the number added by this
   * call, so the repair pass can be re-entered safely.
   */
  function placeSessionsFor(
    team: EngineTeam,
    candidates: Candidate[],
    options: { allowSharing: boolean },
  ): number {
    let placed = assignments.filter((a) => a.teamId === team.id).length;

    while (placed < team.sessionsPerWeek) {
      const context: ScoreContext = { placed: assignments, gymLoad, totalSessions };

      const usable = candidates
        .map((candidate) => ({
          candidate,
          assessment: assessCandidate(occupancy, candidate, sharing),
        }))
        .filter((entry) => entry.assessment.verdict !== "BLOCKED")
        .filter((entry) => respectsSpacing(team, entry.candidate, assignments));

      /*
        Sharing is the fallback for this *session*, not merely for this team. In
        the repair pass a short team may now have a slot nobody has to share,
        and it should take it even when a shared slot happens to score higher —
        otherwise the concession gets spent on convenience rather than need.
      */
      const exclusive = usable.filter((entry) => entry.assessment.verdict === "FREE");
      const pool = exclusive.length > 0 || !options.allowSharing ? exclusive : usable;

      const viable = pool.map((entry) => ({
        ...scoreCandidate(entry.candidate, team, weights, context),
        assessment: entry.assessment,
      }));

      if (viable.length === 0) break;

      /*
        Highest score wins; ties break on a stable key so two runs of the same
        input never differ. Sorting rather than a single max keeps the count of
        real alternatives available for the explanation.
      */
      viable.sort(
        (a, b) =>
          b.score - a.score ||
          a.candidate.isoWeekday - b.candidate.isoWeekday ||
          a.candidate.window.start - b.candidate.window.start ||
          a.candidate.gymId.localeCompare(b.candidate.gymId),
      );

      const best = viable[0];
      occupy(occupancy, best.candidate);
      gymLoad.set(best.candidate.gymId, (gymLoad.get(best.candidate.gymId) ?? 0) + 1);

      /*
        A shared placement is a real compromise and is recorded as one. The
        deduction is applied after the choice, not inside `scoreCandidate`:
        every candidate in a shared pool takes it equally, so it cannot change
        which slot wins, and keeping it out of `OptimizerWeights` means no club
        can accidentally tune sharing *up*. Its job is to stop a shared session
        reading as though it cost nothing.
      */
      const shared = best.assessment.verdict === "SHARED";
      const score = shared ? Math.max(0, best.score - SHARED_PLACEMENT_DEDUCTION) : best.score;
      const tradeOffs = shared
        ? [
            ...best.tradeOffs,
            {
              code: "GYM_SHARED" as const,
              severity: "WARNING" as const,
              values: {
                minutes: best.assessment.share.longestOverlap,
                teams: best.assessment.share.sharedWith + 1,
              },
            },
          ]
        : best.tradeOffs;

      assignments.push({
        teamId: team.id,
        trainerId: best.candidate.trainerId,
        gymId: best.candidate.gymId,
        isoWeekday: best.candidate.isoWeekday as IsoWeekday,
        window: best.candidate.window,
        score,
        explanation: {
          satisfied: best.satisfied,
          tradeOffs,
          score,
          alternatives: viable.length,
        },
      });

      placed += 1;
    }

    return assignments.filter((a) => a.teamId === team.id).length;
  }

  /** Why a team could not get everything it asked for. */
  function explainShortfall(team: EngineTeam, candidates: Candidate[]): Finding[] {
    // With nothing placeable at all, the setup diagnosis is the sharper
    // answer: "no gym is allowed for this team" beats counting usable days.
    if (candidates.length === 0) {
      return diagnoseNoCandidates(team, input.gyms, input.trainers).map((code) => ({
        code: code as Finding["code"],
        severity: "CONFLICT" as const,
      }));
    }

    /*
      Some placements were possible, so before blaming contention check the
      ceiling: a team wanting four sessions on days where only two can ever
      host one is short for a reason no amount of rescheduling touches, and
      reporting "the hall was already booked" sends an organizer hunting for a
      clash that is not the problem.
    */
    const days = analyseWeekdays(team, input.gyms, input.trainers);
    const ceiling = weeklyCeiling(team, days);

    if (ceiling !== null && ceiling < team.sessionsPerWeek) {
      return [
        {
          code: "WEEKLY_CAPACITY",
          severity: "CONFLICT",
          values: { usableDays: ceiling, requested: team.sessionsPerWeek },
        },
        ...days.filter((day) => day.blocker !== "USABLE").map(blockedDayFinding),
        ...suggestFixes(team, days).map(
          (suggestion): Finding => ({ ...suggestion, severity: "WARNING" }),
        ),
      ];
    }

    // Candidates existed but were taken. Say which resource ran out, since that
    // is the difference between "add a gym" and "ask a coach for another night".
    // The same predicate the placement loop used, sharing included — a team
    // that could not be placed *even with* the concession must not be told the
    // hall was merely booked, or an organizer goes hunting for a clash that is
    // not the story.
    const assessed = candidates.map((candidate) => assessCandidate(occupancy, candidate, sharing));
    const free = assessed.filter((assessment) => assessment.verdict !== "BLOCKED");

    if (free.length === 0) {
      const gymBlocked = assessed.every((assessment) => assessment.blockedBy === "GYM");
      return [
        {
          code: (gymBlocked ? "GYM_DOUBLE_BOOKED" : "TRAINER_DOUBLE_BOOKED") as Finding["code"],
          severity: "CONFLICT",
          values: { considered: candidates.length },
        },
        // Nothing is misconfigured here — the club has simply run out of room,
        // so the fix is capacity rather than a correction.
        { code: "SUGGEST_MORE_CAPACITY", severity: "WARNING", values: { team: team.name } },
      ];
    }

    // Slots were free, so spacing is what stopped them being used.
    return [
      {
        code: "NOT_PREFERRED_WEEKDAY" as Finding["code"],
        severity: "CONFLICT",
        values: { minDays: team.minDaysBetween, considered: candidates.length },
      },
    ];
  }

  const scheduled = assignments.length;
  const score =
    scheduled === 0
      ? 0
      : Math.round(assignments.reduce((sum, a) => sum + a.score, 0) / scheduled);

  return {
    assignments,
    unmet,
    // A schedule that leaves teams unplaced is not a good schedule, whatever
    // the placed sessions scored — so the shortfall is priced in.
    score: totalSessions === 0 ? 0 : Math.round(score * (scheduled / totalSessions)),
    stats: {
      teams: input.teams.length,
      sessionsRequested: totalSessions,
      sessionsScheduled: scheduled,
      candidatesConsidered,
      gymUtilisation: Object.fromEntries(gymLoad),
      elapsedMs: Date.now() - startedAt,
    },
  };
}

/** One blocked weekday, as data the UI can phrase. */
function blockedDayFinding(day: WeekdayCapacity): Finding {
  const base: Record<string, string | number> = { weekday: day.isoWeekday };
  const gym: Record<string, string | number> = day.gym
    ? { gym: day.gym.name, gymFrom: day.gym.from, gymUntil: day.gym.until }
    : {};
  const trainer: Record<string, string | number> = day.trainer
    ? { trainer: day.trainer.name, trainerFrom: day.trainer.from, trainerUntil: day.trainer.until }
    : {};

  switch (day.blocker) {
    case "NO_GYM_OPEN":
      return { code: "DAY_NO_GYM_OPEN", severity: "CONFLICT", values: base };
    case "NO_TRAINER_AVAILABLE":
      return { code: "DAY_NO_TRAINER", severity: "CONFLICT", values: { ...base, ...gym } };
    case "WINDOW_TOO_SHORT":
      return {
        code: "DAY_WINDOW_TOO_SHORT",
        severity: "CONFLICT",
        values: { ...base, ...gym, ...trainer, minutes: day.longestOverlap ?? 0 },
      };
    default:
      return {
        code: "DAY_NO_OVERLAP",
        severity: "CONFLICT",
        values: { ...base, ...gym, ...trainer },
      };
  }
}
