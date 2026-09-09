import type {
  AbsenceReason,
  AttendanceOccasion,
  AttendanceStateValue,
  RegisterState,
} from "@/types/database";

/**
 * What the club learns from a season of registers.
 *
 * Every number here is a ratio, and every ratio is an argument about its
 * denominator. Get that wrong and the report is worse than none: a coach shown
 * "62%" for a boy who has not missed a session since he joined in November will
 * stop believing the whole module, and they will be right to.
 *
 * So three rules run through this file:
 *
 *  - An athlete is only counted for occasions they could have attended. A
 *    squad membership carries `joined_at` and `left_at`, and a register sits
 *    inside or outside that window. October is not held against a November
 *    arrival, and a player who left in January is not marked absent for spring.
 *  - A cancelled session counts for nobody. Snow, a shut hall and a coach off
 *    sick are not attendance facts, and folding them in punishes the whole
 *    squad for the weather.
 *  - An unmarked register counts for nobody either — but it is reported, so
 *    "we have no data" never quietly reads as "everyone turned up".
 *
 * Pure functions over plain rows: the whole file can be reasoned about, and
 * tested, without a database.
 */

/** A register, reduced to what a statistic needs. */
export interface RegisterFact {
  id: string;
  teamId: string;
  occasion: AttendanceOccasion;
  state: RegisterState;
  /** Absolute instant; bucketed into club-local months by the caller. */
  startsAt: string;
}

/** One athlete's line on one register. */
export interface RecordFact {
  registerId: string;
  athleteId: string;
  state: AttendanceStateValue;
  reason: AbsenceReason | null;
  calledUp: boolean | null;
  started: boolean | null;
  /** Set when the player was picked but never came on. */
  benched: boolean;
}

/** When an athlete was part of a squad. `leftAt` null means still there. */
export interface SquadWindow {
  athleteId: string;
  teamId: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface TrainingStats {
  /** Recorded, uncancelled sessions the athlete was a squad member for. */
  eligible: number;
  present: number;
  late: number;
  /** Absent, but the club was told beforehand or given a reason. */
  excused: number;
  /** Absent with no word. The number a coach actually wants. */
  unexplained: number;
  /** (present + late) / eligible. Null when there is nothing to divide by. */
  turnout: number | null;
  /** How often an absence came with an explanation. Null when never absent. */
  explained: number | null;
  /** Consecutive most-recent sessions missed. Zero when the last one was made. */
  currentAbsenceStreak: number;
  byReason: Partial<Record<AbsenceReason, number>>;
}

export interface MatchStats {
  /** Match sheets opened while the athlete was in the squad. */
  eligible: number;
  calledUp: number;
  started: number;
  /** Called up and got on court. */
  played: number;
  /** Called up, turned up, never came on. */
  benched: number;
  /** Not picked at all. */
  omitted: number;
  /** calledUp / eligible. Null when there were no matches. */
  callUpRate: number | null;
  /** Consecutive most-recent matches not picked for. The fairness alarm. */
  currentOmissionStreak: number;
}

/* -------------------------------------------------------------------------- */

/**
 * Was this athlete in the squad when this register was taken?
 *
 * Dates are compared as ISO strings, which sorts correctly for `YYYY-MM-DD`,
 * against the register's date rather than its instant — a session at 21:00 on
 * the day someone joined is theirs, and the timezone of the comparison should
 * not decide that.
 */
function inSquad(window: SquadWindow, day: string): boolean {
  if (day < window.joinedAt) return false;
  return window.leftAt === null || day <= window.leftAt;
}

/** The club-local day a register falls on, for squad-window comparisons. */
export function registerDay(startsAt: string, timeZone: string): string {
  // `en-CA` formats as YYYY-MM-DD, which is what the date columns hold.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startsAt));
}

interface Inputs {
  registers: RegisterFact[];
  records: RecordFact[];
  squads: SquadWindow[];
  timeZone: string;
}

/**
 * Registers an athlete could have been on, newest first.
 *
 * Newest first because both streaks read from the present backwards, and
 * because a report about a season is always read from today.
 */
function eligibleRegisters(
  athleteId: string,
  occasion: AttendanceOccasion,
  { registers, squads, timeZone }: Inputs,
): RegisterFact[] {
  const windows = squads.filter((window) => window.athleteId === athleteId);
  if (windows.length === 0) return [];

  return registers
    .filter((register) => {
      if (register.occasion !== occasion) return false;
      // Only a marked sheet is evidence. OPEN means nobody has said yet;
      // CANCELLED means it did not happen.
      if (register.state !== "RECORDED") return false;
      const day = registerDay(register.startsAt, timeZone);
      return windows.some(
        (window) => window.teamId === register.teamId && inSquad(window, day),
      );
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export function trainingStats(athleteId: string, inputs: Inputs): TrainingStats {
  const eligible = eligibleRegisters(athleteId, "TRAINING", inputs);
  const byRegister = new Map(
    inputs.records
      .filter((record) => record.athleteId === athleteId)
      .map((record) => [record.registerId, record]),
  );

  const stats: TrainingStats = {
    eligible: eligible.length,
    present: 0,
    late: 0,
    excused: 0,
    unexplained: 0,
    turnout: null,
    explained: null,
    currentAbsenceStreak: 0,
    byReason: {},
  };

  let streakOpen = true;

  for (const register of eligible) {
    const record = byRegister.get(register.id);
    // A sheet marked without this athlete on it: they were in the squad but
    // nobody said. Neither present nor absent, so it moves no counter — but it
    // does break the streak, because we cannot claim they were missing.
    if (!record) {
      streakOpen = false;
      continue;
    }

    switch (record.state) {
      case "PRESENT":
        stats.present += 1;
        break;
      case "LATE":
        stats.late += 1;
        break;
      case "EXCUSED":
        stats.excused += 1;
        break;
      case "ABSENT":
        stats.unexplained += 1;
        break;
    }

    if (record.reason) {
      stats.byReason[record.reason] = (stats.byReason[record.reason] ?? 0) + 1;
    }

    const attended = record.state === "PRESENT" || record.state === "LATE";
    if (attended) streakOpen = false;
    else if (streakOpen) stats.currentAbsenceStreak += 1;
  }

  const counted = stats.present + stats.late + stats.excused + stats.unexplained;
  if (counted > 0) stats.turnout = (stats.present + stats.late) / counted;

  const missed = stats.excused + stats.unexplained;
  if (missed > 0) stats.explained = stats.excused / missed;

  return stats;
}

export function matchStats(athleteId: string, inputs: Inputs): MatchStats {
  const eligible = eligibleRegisters(athleteId, "MATCH", inputs);
  const byRegister = new Map(
    inputs.records
      .filter((record) => record.athleteId === athleteId)
      .map((record) => [record.registerId, record]),
  );

  const stats: MatchStats = {
    eligible: 0,
    calledUp: 0,
    started: 0,
    played: 0,
    benched: 0,
    omitted: 0,
    callUpRate: null,
    currentOmissionStreak: 0,
  };

  let streakOpen = true;

  for (const register of eligible) {
    const record = byRegister.get(register.id);
    if (!record) {
      streakOpen = false;
      continue;
    }

    stats.eligible += 1;

    if (record.calledUp) {
      stats.calledUp += 1;
      if (record.started) stats.started += 1;
      if (record.benched) stats.benched += 1;
      // Turning up and being an unused substitute is not playing; neither is
      // being called and then not appearing at all.
      const turnedUp = record.state === "PRESENT" || record.state === "LATE";
      if (turnedUp && !record.benched) stats.played += 1;
      streakOpen = false;
    } else {
      stats.omitted += 1;
      if (streakOpen) stats.currentOmissionStreak += 1;
    }
  }

  if (stats.eligible > 0) stats.callUpRate = stats.calledUp / stats.eligible;

  return stats;
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                      */
/* -------------------------------------------------------------------------- */

export interface MonthlyTurnout {
  /** `YYYY-MM` in the club's timezone. */
  month: string;
  eligible: number;
  attended: number;
  turnout: number;
}

/**
 * Turnout month by month — the shape of a season rather than one number for it.
 *
 * A flat 75% hides both the boy who was perfect until Christmas and stopped,
 * and the one who started badly and fixed it. Those are opposite conversations.
 */
export function monthlyTurnout(athleteId: string, inputs: Inputs): MonthlyTurnout[] {
  const eligible = eligibleRegisters(athleteId, "TRAINING", inputs);
  const byRegister = new Map(
    inputs.records
      .filter((record) => record.athleteId === athleteId)
      .map((record) => [record.registerId, record]),
  );

  const buckets = new Map<string, { eligible: number; attended: number }>();

  for (const register of eligible) {
    const record = byRegister.get(register.id);
    if (!record) continue;

    const month = registerDay(register.startsAt, inputs.timeZone).slice(0, 7);
    const bucket = buckets.get(month) ?? { eligible: 0, attended: 0 };
    bucket.eligible += 1;
    if (record.state === "PRESENT" || record.state === "LATE") bucket.attended += 1;
    buckets.set(month, bucket);
  }

  return [...buckets.entries()]
    .map(([month, bucket]) => ({
      month,
      eligible: bucket.eligible,
      attended: bucket.attended,
      turnout: bucket.attended / bucket.eligible,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/* -------------------------------------------------------------------------- */
/* Squad-level findings                                                       */
/* -------------------------------------------------------------------------- */

export type FindingKind =
  | "ABSENCE_STREAK"
  | "OMISSION_STREAK"
  | "LOW_TURNOUT"
  | "NEVER_STARTED";

export interface Finding {
  kind: FindingKind;
  athleteId: string;
  /** The number behind the finding, for the sentence that renders it. */
  value: number;
}

/**
 * Thresholds, named rather than inlined.
 *
 * These are the point at which a pattern is worth a coach's attention, not a
 * rule about anything. A club that disagrees should be able to see the number
 * and change it, which it cannot do if it is buried in a comparison.
 */
export const FINDING_THRESHOLDS = {
  /** Three in a row is a pattern; two is a fortnight's flu. */
  absenceStreak: 3,
  /** Four matches unpicked is the conversation the club keeps not having. */
  omissionStreak: 4,
  lowTurnout: 0.6,
  /** Below this many sessions, a percentage is noise. */
  minimumSessions: 5,
} as const;

/**
 * What a coach should be told about their squad, without asking.
 *
 * The whole point of collecting the data. A report nobody opens changes
 * nothing; a line saying "Nicolò has not been picked for four matches" is the
 * club acting on it.
 */
export function squadFindings(athleteIds: string[], inputs: Inputs): Finding[] {
  const findings: Finding[] = [];

  for (const athleteId of athleteIds) {
    const training = trainingStats(athleteId, inputs);
    const matches = matchStats(athleteId, inputs);

    if (training.currentAbsenceStreak >= FINDING_THRESHOLDS.absenceStreak) {
      findings.push({
        kind: "ABSENCE_STREAK",
        athleteId,
        value: training.currentAbsenceStreak,
      });
    }

    if (
      training.turnout !== null &&
      training.eligible >= FINDING_THRESHOLDS.minimumSessions &&
      training.turnout < FINDING_THRESHOLDS.lowTurnout
    ) {
      findings.push({ kind: "LOW_TURNOUT", athleteId, value: training.turnout });
    }

    if (matches.currentOmissionStreak >= FINDING_THRESHOLDS.omissionStreak) {
      findings.push({
        kind: "OMISSION_STREAK",
        athleteId,
        value: matches.currentOmissionStreak,
      });
    }

    // Only worth saying once there have been enough matches to mean something,
    // and only about someone who is actually being picked — a player who is
    // never called has a different problem, already reported above.
    if (matches.calledUp >= FINDING_THRESHOLDS.omissionStreak && matches.started === 0) {
      findings.push({ kind: "NEVER_STARTED", athleteId, value: matches.calledUp });
    }
  }

  return findings;
}
