/**
 * The nearest slot that would have worked.
 *
 * Telling a club that every slot its team could use is taken is true and not
 * much help: it leaves them to guess which of three settings to loosen, and by
 * how much. The schedule already knows. Widen one constraint at a time, ask the
 * same placement question again, and the first widening that succeeds is a
 * concrete answer — Thursday at 21:00 in the town hall, if this side could
 * train half an hour later.
 *
 * One constraint at a time, and in order of how little it asks of the club:
 * staying half an hour later is a smaller change than opening a hall the team
 * has never used, which is smaller than training on a day it had ruled out.
 * The first that works is offered, not the best of all of them, because the
 * cheapest change that solves the problem is the one worth naming.
 */

import { generateCandidates, type Candidate } from "./candidates";
import type { BlockedSlot, EngineGym, EngineTeam, EngineTrainer } from "./types";

export type Relaxation = "LATER" | "EARLIER" | "OTHER_GYM" | "OTHER_WEEKDAY";

export interface RescueSlot {
  relaxation: Relaxation;
  isoWeekday: number;
  /** Minutes from midnight, like everything else the engine reasons about. */
  start: number;
  end: number;
  gymId: string;
}

/** Earliest day, then earliest time, so two runs of one club agree. */
function firstBy(candidates: Candidate[], accept: (candidate: Candidate) => boolean) {
  return [...candidates]
    .sort(
      (a, b) =>
        a.isoWeekday - b.isoWeekday ||
        a.window.start - b.window.start ||
        a.gymId.localeCompare(b.gymId),
    )
    .find(accept);
}

export function findRescueSlot(args: {
  team: EngineTeam;
  gyms: EngineGym[];
  trainers: EngineTrainer[];
  blocked: BlockedSlot[];
  granularity: number;
  /** Free in the hall, free for the coach, and far enough from its own sessions. */
  isPlaceable: (candidate: Candidate) => boolean;
}): RescueSlot | null {
  const { team, gyms, trainers, blocked, granularity, isPlaceable } = args;

  const search = (
    relaxation: Relaxation,
    relaxed: EngineTeam,
    isDifferent: (candidate: Candidate) => boolean,
  ): RescueSlot | null => {
    const found = firstBy(
      generateCandidates(relaxed, gyms, trainers, blocked, granularity),
      (candidate) => isDifferent(candidate) && isPlaceable(candidate),
    );

    return found
      ? {
          relaxation,
          isoWeekday: found.isoWeekday,
          start: found.window.start,
          end: found.window.end,
          gymId: found.gymId,
        }
      : null;
  };

  // Later in the evening, in a hall and on a day the team already uses.
  const later = search(
    "LATER",
    { ...team, latestEnd: 24 * 60 },
    (candidate) => candidate.window.end > team.latestEnd,
  );
  if (later) return later;

  // Earlier in the afternoon. Rarer, but a minibasket group can often start
  // sooner where a senior side cannot.
  const earlier = search(
    "EARLIER",
    { ...team, earliestStart: 0 },
    (candidate) => candidate.window.start < team.earliestStart,
  );
  if (earlier) return earlier;

  /*
    A hall the team has not been given. Only meaningful if it has a list at all:
    a team allowed everywhere has no wider set to search.

    Its own town first. A hall twenty kilometres away is free far more often
    than one down the road, so an unranked search reliably suggests the one
    nobody will drive to — and a suggestion that gets an eye-roll is worse than
    none, because it teaches the reader to stop reading them.
  */
  if (team.allowedGymIds.length > 0) {
    const towns = new Set(
      gyms
        .filter((gym) => team.allowedGymIds.includes(gym.id) && gym.city)
        .map((gym) => gym.city as string),
    );

    const nearby = search(
      "OTHER_GYM",
      { ...team, allowedGymIds: [] },
      (candidate) =>
        !team.allowedGymIds.includes(candidate.gymId) &&
        towns.has(gyms.find((gym) => gym.id === candidate.gymId)?.city ?? ""),
    );
    if (nearby) return nearby;

    /*
      A hall in another town, but only for a side that already travels.

      A club spread across a province genuinely does move a team between towns,
      and for those an out-of-town hall is a real answer. A side whose every
      hall is in one place does not, and telling it to drive twenty kilometres
      is the kind of technically-free suggestion that teaches people to stop
      reading them. Better to say nothing and let the weekday search answer.

      Suppressed only when the towns are known and there is exactly one of
      them. A club that has not filled in where its halls are should still get
      the suggestion — an unanswered question is not a "no".
    */
    if (towns.size !== 1) {
      const elsewhere = search(
        "OTHER_GYM",
        { ...team, allowedGymIds: [] },
        (candidate) => !team.allowedGymIds.includes(candidate.gymId),
      );
      if (elsewhere) return elsewhere;
    }
  }

  // A weekday it had ruled out. Last, because it is the biggest ask.
  if (team.allowedWeekdays.length > 0) {
    const anotherDay = search(
      "OTHER_WEEKDAY",
      { ...team, allowedWeekdays: [] },
      (candidate) => !team.allowedWeekdays.includes(candidate.isoWeekday),
    );
    if (anotherDay) return anotherDay;
  }

  return null;
}
