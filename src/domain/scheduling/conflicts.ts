/**
 * Placement validation.
 *
 * Answers one question: if this training session were placed here, what would
 * be wrong with it? Used in three places that must never disagree —
 *
 *   - the calendar, when someone drags an event
 *   - the manual event editor, before saving
 *   - the optimizer in Phase 5, when scoring candidate slots
 *
 * Pure and dependency-free for the same reason as the availability module: this
 * is the code that decides whether a club's week is valid, and it has to be
 * testable without a database.
 *
 * Times are minutes from midnight in the club's scheduling timezone. Callers
 * convert absolute instants once, at the boundary, where the timezone is known.
 */

import { overlaps, type MinuteWindow } from "../availability";
import { NO_GYM_SHARING, assessGymShare, type GymSharingPolicy } from "./sharing";

/** Ordered by seriousness; the overall verdict is the worst finding present. */
export type PlacementSeverity = "VALID" | "WARNING" | "CONFLICT" | "INVALID";

const SEVERITY_ORDER: Record<PlacementSeverity, number> = {
  VALID: 0,
  WARNING: 1,
  CONFLICT: 2,
  INVALID: 3,
};

/**
 * A stable, translatable reason. The engine never produces prose — the UI owns
 * the wording, and the same code has to read sensibly in English and Italian.
 */
export type FindingCode =
  | "END_BEFORE_START"
  | "DURATION_MISMATCH"
  | "OUTSIDE_GYM_HOURS"
  | "OUTSIDE_TRAINER_HOURS"
  | "OUTSIDE_TEAM_HOURS"
  | "GYM_DOUBLE_BOOKED"
  /* A hall that permits a changeover, and this placement is using it. */
  | "GYM_SHARED"
  | "GYM_OVERLAP_TOO_LONG"
  | "GYM_AT_CAPACITY"
  | "TRAINER_DOUBLE_BOOKED"
  | "TEAM_DOUBLE_BOOKED"
  | "OUTSIDE_ALLOWED_HOURS"
  | "WEEKDAY_NOT_ALLOWED"
  | "GYM_NOT_ALLOWED"
  | "NO_TRAINER_ASSIGNED"
  | "NOT_PREFERRED_WEEKDAY"
  | "NOT_PREFERRED_TIME"
  | "NOT_PREFERRED_GYM"
  /* Why a team can never reach its weekly total, whatever the optimizer does. */
  | "WEEKLY_CAPACITY"
  | "DAY_NO_GYM_OPEN"
  | "DAY_NO_TRAINER"
  | "DAY_NO_OVERLAP"
  | "DAY_TEAM_UNAVAILABLE"
  | "DAY_WINDOW_TOO_SHORT"
  /* What to change to fix the above. Rendered apart from the diagnosis. */
  | "SUGGEST_GYM_HOURS"
  | "SUGGEST_TRAINER_HOURS"
  | "SUGGEST_ASSIGN_TRAINER"
  | "SUGGEST_EXTEND_WINDOW"
  | "SUGGEST_MORE_CAPACITY";

export interface Finding {
  code: FindingCode;
  severity: PlacementSeverity;
  /** Interpolated into the message, e.g. the name of the clashing team. */
  values?: Record<string, string | number>;
}

/** An existing booking the candidate might collide with. */
export interface Booking {
  id: string;
  window: MinuteWindow;
  teamId: string | null;
  trainerId: string | null;
  gymId: string | null;
  teamName?: string;
  /**
   * Set only on deliberate multi-team events — an in-house match or tournament.
   * The optimizer never sets it and never relies on it; it exists so a manually
   * created event can legitimately share a hall.
   */
  allowsGymSharing?: boolean;
}

export interface Candidate {
  /** Present when editing: the entry excludes itself from conflict checks. */
  id?: string;
  window: MinuteWindow;
  isoWeekday: number;
  teamId: string;
  trainerId: string | null;
  gymId: string;
}

/** Resolved availability for the date in question. */
export interface AvailabilityContext {
  gym: MinuteWindow[];
  trainer: MinuteWindow[] | null;
  team: MinuteWindow[] | null;
}

/**
 * Policy belonging to the resources a placement uses, as opposed to the team.
 *
 * Separate from `PlacementRules` because that type is documented as the team's
 * requirements, and a hall's tolerance for two groups at once is not one of
 * them. Optional throughout, so a caller that omits it gets exactly the
 * behaviour this function had before halls could be shared.
 */
export interface PlacementResources {
  gymSharing?: GymSharingPolicy;
}

/** The subset of a team's requirements that constrains a single placement. */
export interface PlacementRules {
  durationMinutes?: number;
  earliestStart?: number;
  latestEnd?: number;
  allowedWeekdays?: number[];
  allowedGymIds?: string[];
  preferredWeekdays?: number[];
  preferredStart?: number;
  preferredEnd?: number;
  preferredGymIds?: string[];
}

export interface PlacementResult {
  severity: PlacementSeverity;
  findings: Finding[];
}

function within(candidate: MinuteWindow, windows: MinuteWindow[]): boolean {
  // The whole session must sit inside one window. Spanning a gap — training
  // through the hour a hall is shut — is not availability.
  return windows.some((window) => candidate.start >= window.start && candidate.end <= window.end);
}

/**
 * Validates one placement.
 *
 * Returns every finding rather than stopping at the first: an organizer fixing
 * a slot needs to see all of what is wrong with it, not discover the problems
 * one save at a time.
 */
export function validatePlacement(
  candidate: Candidate,
  availability: AvailabilityContext,
  bookings: Booking[],
  rules: PlacementRules = {},
  resources: PlacementResources = {},
): PlacementResult {
  const findings: Finding[] = [];
  const { window } = candidate;

  // --- Structural ----------------------------------------------------------
  if (window.end <= window.start) {
    // Nothing else is worth checking about a session that ends before it starts.
    return { severity: "INVALID", findings: [{ code: "END_BEFORE_START", severity: "INVALID" }] };
  }

  const duration = window.end - window.start;
  if (rules.durationMinutes !== undefined && duration !== rules.durationMinutes) {
    findings.push({
      code: "DURATION_MISMATCH",
      severity: "WARNING",
      values: { expected: rules.durationMinutes, actual: duration },
    });
  }

  // --- Hard: availability --------------------------------------------------
  if (!within(window, availability.gym)) {
    findings.push({ code: "OUTSIDE_GYM_HOURS", severity: "CONFLICT" });
  }
  if (availability.trainer !== null && !within(window, availability.trainer)) {
    findings.push({ code: "OUTSIDE_TRAINER_HOURS", severity: "CONFLICT" });
  }
  // A team with no availability configured is unconstrained, not unavailable.
  if (availability.team !== null && availability.team.length > 0 && !within(window, availability.team)) {
    findings.push({ code: "OUTSIDE_TEAM_HOURS", severity: "CONFLICT" });
  }

  // --- Hard: double-booking ------------------------------------------------
  /*
    The hall is judged as a set, not booking by booking: "may two teams be in
    here at once, and for how long" is a question about everything already in
    the room, which a per-booking loop cannot ask. The coach and the team stay
    per-booking below, because those clashes are absolute however tolerant a
    hall is.
  */
  const contended = bookings.filter(
    (booking) =>
      booking.id !== candidate.id &&
      booking.gymId === candidate.gymId &&
      overlaps(window, booking.window) &&
      // A deliberate multi-team event — an in-house match — is exempt outright.
      // That escape hatch predates hall sharing and means something different:
      // "this booking does not own the hall", not "this hall takes two teams".
      !booking.allowsGymSharing,
  );

  const policy = resources.gymSharing ?? NO_GYM_SHARING;
  const share = assessGymShare(
    contended.map((booking) => booking.window),
    window,
    policy,
  );

  if (share.verdict === "SHARED") {
    findings.push({
      code: "GYM_SHARED",
      severity: "WARNING",
      values: { minutes: share.longestOverlap, teams: share.sharedWith + 1 },
    });
  } else if (share.verdict === "BLOCKED") {
    if (share.reason === "OVERLAP_TOO_LONG") {
      findings.push({
        code: "GYM_OVERLAP_TOO_LONG",
        severity: "CONFLICT",
        values: {
          team: contended[0]?.teamName ?? "",
          minutes: share.longestOverlap,
          allowed: policy.maxSharedOverlapMinutes,
        },
      });
    } else if (policy.maxConcurrentTeams > 1) {
      findings.push({
        code: "GYM_AT_CAPACITY",
        severity: "CONFLICT",
        values: { teams: share.sharedWith + 1, allowed: policy.maxConcurrentTeams },
      });
    } else {
      // An ordinary hall produces exactly the finding it always did, values
      // included, so nothing downstream can tell this refactor happened.
      findings.push({
        code: "GYM_DOUBLE_BOOKED",
        severity: "CONFLICT",
        values: { team: contended[0]?.teamName ?? "" },
      });
    }
  }

  for (const booking of bookings) {
    if (booking.id === candidate.id) continue;
    if (!overlaps(window, booking.window)) continue;

    if (candidate.trainerId && booking.trainerId === candidate.trainerId) {
      findings.push({
        code: "TRAINER_DOUBLE_BOOKED",
        severity: "CONFLICT",
        values: { team: booking.teamName ?? "" },
      });
    }
    if (booking.teamId === candidate.teamId) {
      findings.push({ code: "TEAM_DOUBLE_BOOKED", severity: "CONFLICT" });
    }
  }

  // --- Hard: team rules ----------------------------------------------------
  if (rules.earliestStart !== undefined && window.start < rules.earliestStart) {
    findings.push({ code: "OUTSIDE_ALLOWED_HOURS", severity: "CONFLICT" });
  } else if (rules.latestEnd !== undefined && window.end > rules.latestEnd) {
    findings.push({ code: "OUTSIDE_ALLOWED_HOURS", severity: "CONFLICT" });
  }

  if (rules.allowedWeekdays?.length && !rules.allowedWeekdays.includes(candidate.isoWeekday)) {
    findings.push({ code: "WEEKDAY_NOT_ALLOWED", severity: "CONFLICT" });
  }
  if (rules.allowedGymIds?.length && !rules.allowedGymIds.includes(candidate.gymId)) {
    findings.push({ code: "GYM_NOT_ALLOWED", severity: "CONFLICT" });
  }

  // Staffing is a warning, not a conflict: an organizer may legitimately place
  // a slot first and assign a coach afterwards.
  if (!candidate.trainerId) {
    findings.push({ code: "NO_TRAINER_ASSIGNED", severity: "WARNING" });
  }

  // --- Soft: preferences ---------------------------------------------------
  if (rules.preferredWeekdays?.length && !rules.preferredWeekdays.includes(candidate.isoWeekday)) {
    findings.push({ code: "NOT_PREFERRED_WEEKDAY", severity: "WARNING" });
  }
  if (
    rules.preferredStart !== undefined &&
    rules.preferredEnd !== undefined &&
    (window.start < rules.preferredStart || window.end > rules.preferredEnd)
  ) {
    findings.push({ code: "NOT_PREFERRED_TIME", severity: "WARNING" });
  }
  if (rules.preferredGymIds?.length && !rules.preferredGymIds.includes(candidate.gymId)) {
    findings.push({ code: "NOT_PREFERRED_GYM", severity: "WARNING" });
  }

  return { severity: worstOf(findings), findings };
}

export function worstOf(findings: Finding[]): PlacementSeverity {
  return findings.reduce<PlacementSeverity>(
    (worst, finding) =>
      SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[worst] ? finding.severity : worst,
    "VALID",
  );
}

/** True when the placement breaks a hard rule. */
export function isBlocking(severity: PlacementSeverity): boolean {
  return severity === "CONFLICT" || severity === "INVALID";
}
