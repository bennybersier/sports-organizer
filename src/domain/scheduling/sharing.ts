/**
 * When two teams may be in one hall at once.
 *
 * Most halls take one team at a time. Some can take two for a changeover — one
 * session winding down at one end of the floor while the next warms up at the
 * other — and a hall with two courts can genuinely run two sessions side by
 * side all evening. Those are three different halls, and one boolean cannot
 * tell them apart, so the policy carries both a count and a tolerance.
 *
 * This lives in its own module rather than inside the optimizer because the
 * engine and the manual drag-and-drop path must reach the same verdict, and
 * `conflicts.ts` cannot import `optimizer.ts` — the dependency runs the other
 * way. A schedule where the two disagree is worse than one that is simply
 * wrong: it validates on the calendar and fails on generation, or the reverse.
 *
 * The tolerance applies **only between two training sessions**. A hall held by
 * a match or a closure is not negotiable, and nothing here is ever consulted
 * for one — see `BlockedSlot` in `types.ts`.
 */

import { overlapMinutes, overlaps, type MinuteWindow } from "../availability";

export interface GymSharingPolicy {
  /** How many sessions may run in this hall at once. 1 is a normal hall. */
  maxConcurrentTeams: number;
  /** The longest overlap allowed between any two of them. */
  maxSharedOverlapMinutes: number;
}

/** One team at a time — what every hall does until a club says otherwise. */
export const NO_GYM_SHARING: GymSharingPolicy = {
  maxConcurrentTeams: 1,
  maxSharedOverlapMinutes: 0,
};

export type ShareVerdict =
  /** The hall is empty at that time. */
  | "FREE"
  /** Legal, but it uses the concession — worth saying so. */
  | "SHARED"
  | "BLOCKED";

export interface ShareAssessment {
  verdict: ShareVerdict;
  /** How many existing sessions this would sit alongside. */
  sharedWith: number;
  /** The worst pairwise overlap in minutes, for the explanation. */
  longestOverlap: number;
  reason?: "CONCURRENCY" | "OVERLAP_TOO_LONG";
}

/**
 * Peak simultaneous sessions.
 *
 * Depth can only change where a session starts, so probing every start is
 * equivalent to a full sweep and avoids sorting boundary events. The `<` on
 * `end` is what keeps windows half-open: at the instant one session ends and
 * another begins, only the new one counts.
 */
function peakConcurrency(windows: MinuteWindow[]): number {
  let peak = 0;
  for (const probe of windows) {
    let depth = 0;
    for (const window of windows) {
      if (window.start <= probe.start && probe.start < window.end) depth += 1;
    }
    if (depth > peak) peak = depth;
  }
  return peak;
}

/**
 * May this session join the ones already booked in the hall?
 *
 * Checking against the current set is enough even though the optimizer is
 * greedy and never revisits a placement: adding a session can only raise the
 * peak and only add pairs, so a placement that was legal when it was made
 * stays legal for the rest of the run. That is the property that lets this be
 * enforced one session at a time, and it is the first thing a reader doubts.
 */
export function assessGymShare(
  booked: MinuteWindow[],
  candidate: MinuteWindow,
  policy: GymSharingPolicy,
): ShareAssessment {
  const clashing = booked.filter((window) => overlaps(candidate, window));

  if (clashing.length === 0) {
    return { verdict: "FREE", sharedWith: 0, longestOverlap: 0 };
  }

  const longestOverlap = Math.max(
    ...clashing.map((window) => overlapMinutes(candidate, window)),
  );

  if (policy.maxConcurrentTeams <= 1) {
    return { verdict: "BLOCKED", sharedWith: clashing.length, longestOverlap, reason: "CONCURRENCY" };
  }

  // A changeover is a property of a *pair*, so every existing session has to
  // tolerate this one. Only the new window needs testing: every pair already
  // in the hall was checked when the later of the two was placed.
  if (longestOverlap > policy.maxSharedOverlapMinutes) {
    return {
      verdict: "BLOCKED",
      sharedWith: clashing.length,
      longestOverlap,
      reason: "OVERLAP_TOO_LONG",
    };
  }

  /*
    Not redundant with the pairwise rule, though it looks it for the 90-minute
    sessions a club actually runs. `duration_minutes` goes down to 15, and
    three twenty-minute sessions can overlap each other by well under the
    tolerance while putting three groups on the floor at once. Without this,
    `maxConcurrentTeams` would be a column that never means anything.
  */
  if (peakConcurrency([...clashing, candidate]) > policy.maxConcurrentTeams) {
    return { verdict: "BLOCKED", sharedWith: clashing.length, longestOverlap, reason: "CONCURRENCY" };
  }

  return { verdict: "SHARED", sharedWith: clashing.length, longestOverlap };
}
