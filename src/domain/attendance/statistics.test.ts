import { describe, expect, it } from "vitest";

import {
  FINDING_THRESHOLDS,
  matchStats,
  monthlyTurnout,
  registerDay,
  squadFindings,
  trainingStats,
  type RecordFact,
  type RegisterFact,
  type SquadWindow,
} from "./statistics";

const TZ = "Europe/Rome";
const TEAM = "team-1";
const ATHLETE = "athlete-1";

function register(
  id: string,
  startsAt: string,
  overrides: Partial<RegisterFact> = {},
): RegisterFact {
  return {
    id,
    teamId: TEAM,
    occasion: "TRAINING",
    state: "RECORDED",
    startsAt,
    ...overrides,
  };
}

function record(registerId: string, overrides: Partial<RecordFact> = {}): RecordFact {
  return {
    registerId,
    athleteId: ATHLETE,
    state: "PRESENT",
    reason: null,
    calledUp: null,
    started: null,
    benched: false,
    ...overrides,
  };
}

const wholeSeason: SquadWindow = {
  athleteId: ATHLETE,
  teamId: TEAM,
  joinedAt: "2026-09-01",
  leftAt: null,
};

const inputs = (
  registers: RegisterFact[],
  records: RecordFact[],
  squads: SquadWindow[] = [wholeSeason],
) => ({ registers, records, squads, timeZone: TZ });

describe("trainingStats", () => {
  it("counts turnout over the sessions that were actually marked", () => {
    const registers = [
      register("r1", "2026-10-06T18:00:00Z"),
      register("r2", "2026-10-08T18:00:00Z"),
      register("r3", "2026-10-13T18:00:00Z"),
      register("r4", "2026-10-15T18:00:00Z"),
    ];
    const records = [
      record("r1"),
      record("r2", { state: "LATE" }),
      record("r3", { state: "EXCUSED", reason: "SCHOOL" }),
      record("r4", { state: "ABSENT" }),
    ];

    const stats = trainingStats(ATHLETE, inputs(registers, records));

    expect(stats.eligible).toBe(4);
    expect(stats.present).toBe(1);
    expect(stats.late).toBe(1);
    expect(stats.excused).toBe(1);
    expect(stats.unexplained).toBe(1);
    // Late is still turning up.
    expect(stats.turnout).toBe(0.5);
    expect(stats.explained).toBe(0.5);
    expect(stats.byReason).toEqual({ SCHOOL: 1 });
  });

  it("does not hold sessions before an athlete joined against them", () => {
    const registers = [
      register("r1", "2026-09-15T18:00:00Z"),
      register("r2", "2026-11-10T18:00:00Z"),
      register("r3", "2026-11-12T18:00:00Z"),
    ];
    // Joined in November; present at everything since.
    const joinedLate: SquadWindow = {
      athleteId: ATHLETE,
      teamId: TEAM,
      joinedAt: "2026-11-01",
      leftAt: null,
    };

    const stats = trainingStats(
      ATHLETE,
      inputs(registers, [record("r2"), record("r3")], [joinedLate]),
    );

    expect(stats.eligible).toBe(2);
    expect(stats.turnout).toBe(1);
  });

  it("stops counting once an athlete has left the squad", () => {
    const registers = [
      register("r1", "2026-10-06T18:00:00Z"),
      register("r2", "2026-12-15T18:00:00Z"),
    ];
    const left: SquadWindow = {
      athleteId: ATHLETE,
      teamId: TEAM,
      joinedAt: "2026-09-01",
      leftAt: "2026-11-30",
    };

    const stats = trainingStats(ATHLETE, inputs(registers, [record("r1")], [left]));

    expect(stats.eligible).toBe(1);
    expect(stats.turnout).toBe(1);
  });

  it("counts a cancelled session for nobody", () => {
    const registers = [
      register("r1", "2026-10-06T18:00:00Z"),
      register("r2", "2026-10-08T18:00:00Z", { state: "CANCELLED" }),
    ];

    const stats = trainingStats(ATHLETE, inputs(registers, [record("r1")]));

    expect(stats.eligible).toBe(1);
    expect(stats.turnout).toBe(1);
  });

  it("ignores a sheet nobody has marked yet", () => {
    const registers = [
      register("r1", "2026-10-06T18:00:00Z"),
      register("r2", "2026-10-08T18:00:00Z", { state: "OPEN" }),
    ];

    expect(trainingStats(ATHLETE, inputs(registers, [record("r1")])).eligible).toBe(1);
  });

  it("does not divide by zero when there is nothing to report", () => {
    const stats = trainingStats(ATHLETE, inputs([], []));
    expect(stats.turnout).toBeNull();
    expect(stats.explained).toBeNull();
    expect(stats.currentAbsenceStreak).toBe(0);
  });

  it("counts the absence streak back from the most recent session", () => {
    const registers = [
      register("r1", "2026-10-01T18:00:00Z"),
      register("r2", "2026-10-08T18:00:00Z"),
      register("r3", "2026-10-15T18:00:00Z"),
      register("r4", "2026-10-22T18:00:00Z"),
    ];
    const records = [
      record("r1", { state: "ABSENT" }),
      record("r2"),
      record("r3", { state: "ABSENT" }),
      record("r4", { state: "EXCUSED", reason: "ILLNESS" }),
    ];

    // The two most recent were both missed; the earlier absence is behind an
    // attendance and does not extend the streak.
    expect(trainingStats(ATHLETE, inputs(registers, records)).currentAbsenceStreak).toBe(2);
  });

  it("does not claim an absence for a marked sheet the athlete is missing from", () => {
    const registers = [
      register("r1", "2026-10-01T18:00:00Z"),
      register("r2", "2026-10-08T18:00:00Z"),
    ];
    // Only the older session has a line for this athlete.
    const stats = trainingStats(ATHLETE, inputs(registers, [record("r1", { state: "ABSENT" })]));

    expect(stats.eligible).toBe(2);
    // One absence counted, and no streak: silence is not evidence of absence.
    expect(stats.unexplained).toBe(1);
    expect(stats.currentAbsenceStreak).toBe(0);
    // The percentage divides by what was actually recorded, not by eligibility.
    expect(stats.turnout).toBe(0);
  });

  it("keeps a register on the club's own day, not UTC's", () => {
    // 00:30 on the 7th in Rome is 22:30 on the 6th in UTC.
    expect(registerDay("2026-10-06T22:30:00Z", TZ)).toBe("2026-10-07");
    expect(registerDay("2026-10-06T22:30:00Z", "UTC")).toBe("2026-10-06");
  });
});

describe("matchStats", () => {
  const matches = [
    register("m1", "2026-10-04T16:00:00Z", { occasion: "MATCH" }),
    register("m2", "2026-10-11T16:00:00Z", { occasion: "MATCH" }),
    register("m3", "2026-10-18T16:00:00Z", { occasion: "MATCH" }),
    register("m4", "2026-10-25T16:00:00Z", { occasion: "MATCH" }),
  ];

  it("separates being picked, starting, playing and sitting", () => {
    const records = [
      record("m1", { calledUp: true, started: true }),
      record("m2", { calledUp: true, started: false }),
      record("m3", { calledUp: true, started: false, benched: true }),
      record("m4", { calledUp: false, state: "ABSENT" }),
    ];

    const stats = matchStats(ATHLETE, inputs(matches, records));

    expect(stats.eligible).toBe(4);
    expect(stats.calledUp).toBe(3);
    expect(stats.started).toBe(1);
    expect(stats.played).toBe(2);
    expect(stats.benched).toBe(1);
    expect(stats.omitted).toBe(1);
    expect(stats.callUpRate).toBe(0.75);
  });

  it("does not count a called-up player who never turned up as having played", () => {
    const records = [record("m1", { calledUp: true, state: "ABSENT" })];
    const stats = matchStats(ATHLETE, inputs([matches[0]], records));

    expect(stats.calledUp).toBe(1);
    expect(stats.played).toBe(0);
  });

  it("counts the omission streak back from the most recent match", () => {
    const records = [
      record("m1", { calledUp: true }),
      record("m2", { calledUp: false, state: "ABSENT" }),
      record("m3", { calledUp: false, state: "ABSENT" }),
      record("m4", { calledUp: false, state: "ABSENT" }),
    ];

    expect(matchStats(ATHLETE, inputs(matches, records)).currentOmissionStreak).toBe(3);
  });

  it("keeps training sessions out of the match numbers", () => {
    const mixed = [matches[0], register("r1", "2026-10-06T18:00:00Z")];
    const records = [record("m1", { calledUp: true }), record("r1")];

    expect(matchStats(ATHLETE, inputs(mixed, records)).eligible).toBe(1);
    expect(trainingStats(ATHLETE, inputs(mixed, records)).eligible).toBe(1);
  });
});

describe("monthlyTurnout", () => {
  it("buckets by the club's month and orders oldest first", () => {
    const registers = [
      register("r1", "2026-10-06T18:00:00Z"),
      register("r2", "2026-10-20T18:00:00Z"),
      register("r3", "2026-11-03T18:00:00Z"),
      // 23:30 UTC on 30 November is already December in Rome.
      register("r4", "2026-11-30T23:30:00Z"),
    ];
    const records = [
      record("r1"),
      record("r2", { state: "ABSENT" }),
      record("r3"),
      record("r4"),
    ];

    expect(monthlyTurnout(ATHLETE, inputs(registers, records))).toEqual([
      { month: "2026-10", eligible: 2, attended: 1, turnout: 0.5 },
      { month: "2026-11", eligible: 1, attended: 1, turnout: 1 },
      { month: "2026-12", eligible: 1, attended: 1, turnout: 1 },
    ]);
  });
});

describe("squadFindings", () => {
  it("raises an absence streak at the threshold and not before", () => {
    const build = (missed: number) => {
      const registers = Array.from({ length: missed }, (_, index) =>
        register(`r${index}`, `2026-10-0${index + 1}T18:00:00Z`),
      );
      const records = registers.map((r) => record(r.id, { state: "ABSENT" }));
      return squadFindings([ATHLETE], inputs(registers, records));
    };

    const below = build(FINDING_THRESHOLDS.absenceStreak - 1);
    expect(below.some((f) => f.kind === "ABSENCE_STREAK")).toBe(false);

    const at = build(FINDING_THRESHOLDS.absenceStreak);
    expect(at.some((f) => f.kind === "ABSENCE_STREAK")).toBe(true);
  });

  it("stays quiet about a low percentage drawn from too few sessions", () => {
    const registers = [
      register("r1", "2026-10-01T18:00:00Z"),
      register("r2", "2026-10-08T18:00:00Z"),
    ];
    const records = [record("r1", { state: "ABSENT" }), record("r2", { state: "ABSENT" })];

    const findings = squadFindings([ATHLETE], inputs(registers, records));
    expect(findings.some((f) => f.kind === "LOW_TURNOUT")).toBe(false);
  });

  it("flags a squad member who is picked but never starts", () => {
    const registers = Array.from({ length: FINDING_THRESHOLDS.omissionStreak }, (_, index) =>
      register(`m${index}`, `2026-10-0${index + 1}T16:00:00Z`, { occasion: "MATCH" }),
    );
    const records = registers.map((r) => record(r.id, { calledUp: true, started: false }));

    const findings = squadFindings([ATHLETE], inputs(registers, records));
    expect(findings.find((f) => f.kind === "NEVER_STARTED")?.value).toBe(
      FINDING_THRESHOLDS.omissionStreak,
    );
  });
});
