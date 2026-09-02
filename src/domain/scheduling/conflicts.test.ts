import { describe, expect, it } from "vitest";

import {
  isBlocking,
  validatePlacement,
  worstOf,
  type AvailabilityContext,
  type Booking,
  type Candidate,
} from "./conflicts";

const EVENING = [{ start: 960, end: 1320 }]; // 16:00–22:00

const availability: AvailabilityContext = {
  gym: EVENING,
  trainer: EVENING,
  team: EVENING,
};

const candidate: Candidate = {
  window: { start: 1080, end: 1170 }, // 18:00–19:30
  isoWeekday: 1,
  teamId: "team-a",
  trainerId: "trainer-a",
  gymId: "gym-a",
};

const codes = (result: { findings: { code: string }[] }) => result.findings.map((f) => f.code);

describe("validatePlacement — structural", () => {
  it("accepts a placement that breaks nothing", () => {
    const result = validatePlacement(candidate, availability, []);
    expect(result.severity).toBe("VALID");
    expect(result.findings).toEqual([]);
  });

  it("rejects a session that ends before it starts, and stops there", () => {
    const result = validatePlacement(
      { ...candidate, window: { start: 1170, end: 1080 } },
      availability,
      [],
    );
    expect(result.severity).toBe("INVALID");
    // No point reporting availability problems about an impossible window.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("END_BEFORE_START");
  });
});

describe("validatePlacement — availability", () => {
  it("flags a session running past the gym's closing time", () => {
    const result = validatePlacement(
      { ...candidate, window: { start: 1260, end: 1380 } }, // 21:00–23:00
      availability,
      [],
    );
    expect(codes(result)).toContain("OUTSIDE_GYM_HOURS");
    expect(result.severity).toBe("CONFLICT");
  });

  it("rejects a session that spans a gap rather than fitting one window", () => {
    // Hall open 16:00–18:00 and 19:00–22:00; training straight through the
    // closure in between is not availability.
    const split: AvailabilityContext = {
      gym: [{ start: 960, end: 1080 }, { start: 1140, end: 1320 }],
      trainer: EVENING,
      team: EVENING,
    };
    const result = validatePlacement(
      { ...candidate, window: { start: 1020, end: 1200 } },
      split,
      [],
    );
    expect(codes(result)).toContain("OUTSIDE_GYM_HOURS");
  });

  it("treats a team with no availability rows as unconstrained, not unavailable", () => {
    const result = validatePlacement(candidate, { ...availability, team: [] }, []);
    expect(codes(result)).not.toContain("OUTSIDE_TEAM_HOURS");
    expect(result.severity).toBe("VALID");
  });

  it("skips the trainer check when no trainer is assigned", () => {
    const result = validatePlacement(
      { ...candidate, trainerId: null },
      { ...availability, trainer: null },
      [],
    );
    expect(codes(result)).not.toContain("OUTSIDE_TRAINER_HOURS");
    expect(codes(result)).toContain("NO_TRAINER_ASSIGNED");
    // Unstaffed is a warning: place the slot now, assign a coach later.
    expect(result.severity).toBe("WARNING");
  });
});

describe("validatePlacement — double-booking", () => {
  const clash: Booking = {
    id: "existing",
    window: { start: 1110, end: 1200 }, // 18:30–20:00
    teamId: "team-b",
    trainerId: "trainer-b",
    gymId: "gym-a",
    teamName: "U18 Boys",
  };

  it("flags two teams in one gym at once, naming the other team", () => {
    const result = validatePlacement(candidate, availability, [clash]);
    expect(codes(result)).toContain("GYM_DOUBLE_BOOKED");
    expect(result.findings.find((f) => f.code === "GYM_DOUBLE_BOOKED")?.values?.team).toBe(
      "U18 Boys",
    );
  });

  it("allows sharing when the existing event is a deliberate multi-team one", () => {
    const result = validatePlacement(candidate, availability, [
      { ...clash, allowsGymSharing: true },
    ]);
    expect(codes(result)).not.toContain("GYM_DOUBLE_BOOKED");
  });

  it("flags a trainer booked in two places at once", () => {
    const result = validatePlacement(candidate, availability, [
      { ...clash, gymId: "gym-b", trainerId: "trainer-a" },
    ]);
    expect(codes(result)).toContain("TRAINER_DOUBLE_BOOKED");
  });

  it("flags a team booked in two places at once", () => {
    const result = validatePlacement(candidate, availability, [
      { ...clash, gymId: "gym-b", trainerId: "trainer-b", teamId: "team-a" },
    ]);
    expect(codes(result)).toContain("TEAM_DOUBLE_BOOKED");
  });

  it("does not conflict with back-to-back bookings", () => {
    const result = validatePlacement(candidate, availability, [
      { ...clash, window: { start: 1170, end: 1260 } }, // starts as this ends
    ]);
    expect(result.severity).toBe("VALID");
  });

  it("does not conflict with itself when an existing entry is moved", () => {
    const result = validatePlacement(
      { ...candidate, id: "existing" },
      availability,
      [{ ...clash, id: "existing", teamId: "team-a" }],
    );
    expect(result.severity).toBe("VALID");
  });
});

describe("validatePlacement — team rules", () => {
  it("flags a start before the team's earliest allowed time", () => {
    const result = validatePlacement(candidate, availability, [], { earliestStart: 1110 });
    expect(codes(result)).toContain("OUTSIDE_ALLOWED_HOURS");
    expect(result.severity).toBe("CONFLICT");
  });

  it("flags a disallowed weekday and a disallowed gym", () => {
    const result = validatePlacement(candidate, availability, [], {
      allowedWeekdays: [2, 4],
      allowedGymIds: ["gym-b"],
    });
    expect(codes(result)).toContain("WEEKDAY_NOT_ALLOWED");
    expect(codes(result)).toContain("GYM_NOT_ALLOWED");
  });

  it("treats empty allow-lists as no restriction", () => {
    const result = validatePlacement(candidate, availability, [], {
      allowedWeekdays: [],
      allowedGymIds: [],
    });
    expect(result.severity).toBe("VALID");
  });

  it("reports a duration that doesn't match the requirement as a warning", () => {
    const result = validatePlacement(candidate, availability, [], { durationMinutes: 120 });
    const finding = result.findings.find((f) => f.code === "DURATION_MISMATCH");
    expect(finding?.values).toEqual({ expected: 120, actual: 90 });
    expect(result.severity).toBe("WARNING");
  });
});

describe("validatePlacement — preferences never block", () => {
  it("downgrades unmet preferences to warnings", () => {
    const result = validatePlacement(candidate, availability, [], {
      preferredWeekdays: [3],
      preferredStart: 1140,
      preferredEnd: 1260,
      preferredGymIds: ["gym-b"],
    });
    expect(codes(result)).toEqual([
      "NOT_PREFERRED_WEEKDAY",
      "NOT_PREFERRED_TIME",
      "NOT_PREFERRED_GYM",
    ]);
    expect(result.severity).toBe("WARNING");
    expect(isBlocking(result.severity)).toBe(false);
  });

  it("reports every problem at once rather than one per save", () => {
    const result = validatePlacement(
      { ...candidate, window: { start: 1260, end: 1380 }, trainerId: null },
      { ...availability, trainer: null },
      [],
      { allowedWeekdays: [2], preferredGymIds: ["gym-b"] },
    );
    expect(result.findings.length).toBeGreaterThanOrEqual(4);
    expect(result.severity).toBe("CONFLICT");
  });
});

describe("worstOf", () => {
  it("returns the most serious severity present", () => {
    expect(worstOf([])).toBe("VALID");
    expect(worstOf([{ code: "NOT_PREFERRED_GYM", severity: "WARNING" }])).toBe("WARNING");
    expect(
      worstOf([
        { code: "NOT_PREFERRED_GYM", severity: "WARNING" },
        { code: "GYM_DOUBLE_BOOKED", severity: "CONFLICT" },
      ]),
    ).toBe("CONFLICT");
  });
});
