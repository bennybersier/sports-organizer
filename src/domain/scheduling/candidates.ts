import type { IsoWeekday, MinuteWindow } from "../availability";
import { overlaps } from "../availability";
import type { BlockedSlot, EngineGym, EngineTeam, EngineTrainer } from "./types";

/**
 * Candidate generation.
 *
 * A candidate is a concrete (weekday, start, gym, trainer) placement that
 * satisfies every *hard* constraint in isolation — before any other team has
 * been placed. Anything the engine could never legally use is eliminated here,
 * so the optimizer only ever searches feasible space.
 *
 * The count also carries information the UI needs: a team with three candidates
 * is fragile, and "only one slot was possible" is a far more useful explanation
 * than "score 62".
 */

export interface Candidate {
  teamId: string;
  trainerId: string | null;
  gymId: string;
  isoWeekday: IsoWeekday;
  window: MinuteWindow;
}

/** Windows where `duration` fits entirely inside one availability block. */
function fittingStarts(
  windows: MinuteWindow[],
  duration: number,
  granularity: number,
  earliest: number,
  latest: number,
): number[] {
  const starts: number[] = [];

  for (const window of windows) {
    const from = Math.max(window.start, earliest);
    const until = Math.min(window.end, latest);
    // Round up to the grid so candidates land on tidy times.
    const first = Math.ceil(from / granularity) * granularity;

    for (let start = first; start + duration <= until; start += granularity) {
      starts.push(start);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

function intersect(a: MinuteWindow[], b: MinuteWindow[]): MinuteWindow[] {
  const result: MinuteWindow[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) result.push({ start, end });
    }
  }
  return result;
}

export function generateCandidates(
  team: EngineTeam,
  gyms: EngineGym[],
  trainers: EngineTrainer[],
  blocked: BlockedSlot[],
  granularity = 30,
): Candidate[] {
  const candidates: Candidate[] = [];

  const weekdays = (
    team.allowedWeekdays.length > 0 ? team.allowedWeekdays : [1, 2, 3, 4, 5, 6, 7]
  ) as IsoWeekday[];

  // A trainer must actually coach this team to be offered for it.
  const eligibleTrainers = trainers.filter((trainer) => trainer.teamIds.includes(team.id));

  const usableGyms =
    team.allowedGymIds.length > 0
      ? gyms.filter((gym) => team.allowedGymIds.includes(gym.id))
      : gyms;

  for (const weekday of weekdays) {
    const teamWindows = team.availability[weekday];
    // No rows at all means "unconstrained"; an explicitly empty day means shut.
    const teamConstraint =
      Object.keys(team.availability).length === 0
        ? null
        : (teamWindows ?? []);

    if (teamConstraint !== null && teamConstraint.length === 0) continue;

    for (const gym of usableGyms) {
      const gymWindows = gym.availability[weekday] ?? [];
      if (gymWindows.length === 0) continue;

      const base = teamConstraint ? intersect(gymWindows, teamConstraint) : gymWindows;
      if (base.length === 0) continue;

      // With no eligible trainer the slot is still generated unstaffed: an
      // organizer may place the session and assign a coach afterwards, and
      // saying "no trainer" is more useful than offering nothing.
      const trainerOptions: (EngineTrainer | null)[] =
        eligibleTrainers.length > 0 ? eligibleTrainers : [null];

      for (const trainer of trainerOptions) {
        const windows = trainer
          ? intersect(base, trainer.availability[weekday] ?? [])
          : base;
        if (windows.length === 0) continue;

        for (const start of fittingStarts(
          windows,
          team.durationMinutes,
          granularity,
          team.earliestStart,
          team.latestEnd,
        )) {
          const window = { start, end: start + team.durationMinutes };

          const isBlocked = blocked.some(
            (slot) =>
              slot.isoWeekday === weekday &&
              overlaps(window, slot.window) &&
              (slot.gymId === gym.id ||
                (trainer !== null && slot.trainerId === trainer.id) ||
                slot.teamId === team.id),
          );
          if (isBlocked) continue;

          candidates.push({
            teamId: team.id,
            trainerId: trainer?.id ?? null,
            gymId: gym.id,
            isoWeekday: weekday,
            window,
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Why a team has no candidates at all.
 *
 * Called only when generation comes back empty, to turn "impossible" into
 * something an organizer can act on. Ordered by how likely each cause is to be
 * the real one.
 */
export function diagnoseNoCandidates(
  team: EngineTeam,
  gyms: EngineGym[],
  trainers: EngineTrainer[],
): string[] {
  const reasons: string[] = [];

  const usableGyms =
    team.allowedGymIds.length > 0
      ? gyms.filter((gym) => team.allowedGymIds.includes(gym.id))
      : gyms;

  if (usableGyms.length === 0) {
    reasons.push("NO_ELIGIBLE_GYM");
  } else if (usableGyms.every((gym) => Object.keys(gym.availability).length === 0)) {
    reasons.push("NO_GYM_AVAILABILITY");
  }

  const eligible = trainers.filter((trainer) => trainer.teamIds.includes(team.id));
  if (trainers.length > 0 && eligible.length === 0) {
    reasons.push("NO_ASSIGNED_TRAINER");
  } else if (eligible.length > 0 && eligible.every((t) => Object.keys(t.availability).length === 0)) {
    reasons.push("NO_TRAINER_AVAILABILITY");
  }

  const window = team.latestEnd - team.earliestStart;
  if (window < team.durationMinutes) {
    reasons.push("SESSION_LONGER_THAN_WINDOW");
  }

  if (team.allowedWeekdays.length > 0 && team.allowedWeekdays.length * 1 < 1) {
    reasons.push("NO_ALLOWED_WEEKDAY");
  }

  if (reasons.length === 0) reasons.push("NO_OVERLAPPING_AVAILABILITY");
  return reasons;
}
