import type { IsoWeekday, MinuteWindow } from "../availability";
import type { EngineGym, EngineTeam, EngineTrainer } from "./types";

/**
 * How many days a week a team could train, and what blocks the rest.
 *
 * The count of sessions a team asks for is capped by something simpler than
 * scheduling pressure: the number of weekdays on which a hall and one of the
 * team's coaches are free at the same time, for long enough. A team wanting
 * four sessions when only two days work will always come up short, however the
 * optimizer searches, and no amount of rescheduling changes that.
 *
 * Saying so is the difference between an answer an organizer can act on —
 * "Thursday the only hall open is Codogno Sede 20:00–22:00, but the coach
 * finishes at 20:00" — and one they can only stare at.
 */
export type WeekdayBlocker =
  | "USABLE"
  | "NO_GYM_OPEN"
  | "NO_TRAINER_AVAILABLE"
  | "GYM_TRAINER_NO_OVERLAP"
  | "TEAM_UNAVAILABLE"
  | "WINDOW_TOO_SHORT";

export interface WeekdayCapacity {
  isoWeekday: IsoWeekday;
  blocker: WeekdayBlocker;
  /** The widest hall window that day, for the "but it opens at 20:00" half. */
  gym?: { name: string; from: number; until: number };
  /** The widest coach window that day, for the other half. */
  trainer?: { name: string; from: number; until: number };
  /** Longest overlap actually found, when one exists but is too short. */
  longestOverlap?: number;
}

const widest = (windows: MinuteWindow[]): MinuteWindow | null =>
  windows.reduce<MinuteWindow | null>(
    (best, window) =>
      !best || window.end - window.start > best.end - best.start ? window : best,
    null,
  );

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

/**
 * Examines each weekday the team is allowed to use, in isolation: no other
 * team has been placed, nothing is booked. A day marked USABLE could host a
 * session in an empty club; anything else never could.
 */
export function analyseWeekdays(
  team: EngineTeam,
  gyms: EngineGym[],
  trainers: EngineTrainer[],
): WeekdayCapacity[] {
  const weekdays = (
    team.allowedWeekdays.length > 0 ? team.allowedWeekdays : [1, 2, 3, 4, 5, 6, 7]
  ) as IsoWeekday[];

  const usableGyms =
    team.allowedGymIds.length > 0
      ? gyms.filter((gym) => team.allowedGymIds.includes(gym.id))
      : gyms;

  const eligibleTrainers = trainers.filter((trainer) => trainer.teamIds.includes(team.id));
  // Mirrors candidate generation: with no coach assigned a session may still be
  // placed unstaffed, so the trainer half simply does not constrain the day.
  const trainerOptions: (EngineTrainer | null)[] =
    eligibleTrainers.length > 0 ? eligibleTrainers : [null];

  return weekdays.map((weekday) => {
    const openGyms = usableGyms.filter((gym) => (gym.availability[weekday] ?? []).length > 0);
    if (openGyms.length === 0) return { isoWeekday: weekday, blocker: "NO_GYM_OPEN" };

    const freeTrainers = trainerOptions.filter(
      (trainer) => trainer === null || (trainer.availability[weekday] ?? []).length > 0,
    );
    if (freeTrainers.length === 0) {
      return {
        isoWeekday: weekday,
        blocker: "NO_TRAINER_AVAILABLE",
        gym: describe(openGyms[0].name, openGyms[0].availability[weekday] ?? []),
      };
    }

    /*
      Mirrors candidate generation: a day the team has said nothing about is
      unconstrained, not shut. Reporting TEAM_UNAVAILABLE for a silent day sent
      organizers looking for availability that was never the problem.
    */
    const dayWindows = team.availability[weekday] ?? [];
    const teamWindows = dayWindows.length > 0 ? dayWindows : null;

    let longest = 0;
    let bestGym = openGyms[0];
    let bestTrainer = freeTrainers[0];

    for (const gym of openGyms) {
      const gymWindows = gym.availability[weekday] ?? [];
      const base = teamWindows ? intersect(gymWindows, teamWindows) : gymWindows;

      for (const trainer of freeTrainers) {
        const combined = trainer
          ? intersect(base, trainer.availability[weekday] ?? [])
          : base;

        for (const window of combined) {
          // Clipped by the team's own earliest/latest, exactly as a candidate is.
          const from = Math.max(window.start, team.earliestStart);
          const until = Math.min(window.end, team.latestEnd);
          if (until - from > longest) {
            longest = until - from;
            bestGym = gym;
            bestTrainer = trainer;
          }
        }
      }
    }

    const detail = {
      gym: describe(bestGym.name, bestGym.availability[weekday] ?? []),
      trainer: bestTrainer
        ? describe(bestTrainer.name, bestTrainer.availability[weekday] ?? [])
        : undefined,
    };

    if (longest === 0) {
      return { isoWeekday: weekday, blocker: "GYM_TRAINER_NO_OVERLAP", ...detail };
    }
    if (longest < team.durationMinutes) {
      return {
        isoWeekday: weekday,
        blocker: "WINDOW_TOO_SHORT",
        longestOverlap: longest,
        ...detail,
      };
    }

    return { isoWeekday: weekday, blocker: "USABLE", ...detail };
  });
}

function describe(name: string, windows: MinuteWindow[]) {
  const window = widest(windows);
  return window ? { name, from: window.start, until: window.end } : undefined;
}

/**
 * The most sessions a week this team could ever get.
 *
 * A team cannot train twice in a day once any spacing is required, so usable
 * days are a hard ceiling. With spacing switched off the ceiling does not
 * apply and this returns null rather than guessing.
 */
export function weeklyCeiling(team: EngineTeam, days: WeekdayCapacity[]): number | null {
  if (team.minDaysBetween < 1) return null;
  return days.filter((day) => day.blocker === "USABLE").length;
}

/**
 * What to change so the team could actually get its sessions.
 *
 * The diagnosis says what is wrong; this says what to do about it, which is
 * the part an organizer can act on without first translating "no overlap on
 * Thursday" into "ask Karim to stay until half past nine".
 *
 * Every suggestion is derived from the club's own data — the hall that is
 * actually open, the coach who is actually assigned — never invented.
 */
export type SuggestionCode =
  | "SUGGEST_GYM_HOURS"
  | "SUGGEST_TRAINER_HOURS"
  | "SUGGEST_ASSIGN_TRAINER"
  | "SUGGEST_EXTEND_WINDOW";

export interface Suggestion {
  code: SuggestionCode;
  values: Record<string, string | number>;
}

export function suggestFixes(team: EngineTeam, days: WeekdayCapacity[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const day of days) {
    const weekday = day.isoWeekday;

    switch (day.blocker) {
      case "NO_GYM_OPEN":
        suggestions.push({
          code: "SUGGEST_GYM_HOURS",
          values: { weekday, minutes: team.durationMinutes },
        });
        break;

      case "GYM_TRAINER_NO_OVERLAP": {
        if (!day.gym || !day.trainer) break;
        // The hall is the fixed point — it is the scarcer resource — so the
        // suggestion asks the coach to cover the start of the hall's window.
        const until = Math.min(day.gym.from + team.durationMinutes, day.gym.until);
        suggestions.push({
          code: "SUGGEST_TRAINER_HOURS",
          values: {
            weekday,
            trainer: day.trainer.name,
            gym: day.gym.name,
            from: day.gym.from,
            until,
          },
        });
        break;
      }

      case "NO_TRAINER_AVAILABLE": {
        if (!day.gym) break;
        suggestions.push({
          code: "SUGGEST_ASSIGN_TRAINER",
          values: {
            weekday,
            gym: day.gym.name,
            from: day.gym.from,
            until: Math.min(day.gym.from + team.durationMinutes, day.gym.until),
          },
        });
        break;
      }

      case "WINDOW_TOO_SHORT":
        suggestions.push({
          code: "SUGGEST_EXTEND_WINDOW",
          values: {
            weekday,
            gym: day.gym?.name ?? "",
            minutes: day.longestOverlap ?? 0,
            needed: team.durationMinutes,
          },
        });
        break;
    }
  }

  return suggestions;
}
