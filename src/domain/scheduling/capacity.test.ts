import { describe, expect, it } from "vitest";

import { analyseWeekdays, weeklyCeiling } from "./capacity";
import type { EngineGym, EngineTeam, EngineTrainer } from "./types";

const team = (overrides: Partial<EngineTeam> = {}): EngineTeam => ({
  id: "team",
  name: "U13 Gold",
  availability: {},
  sessionsPerWeek: 4,
  durationMinutes: 90,
  priority: 3,
  allowedWeekdays: [1, 2, 4, 5],
  earliestStart: 16 * 60 + 30,
  latestEnd: 22 * 60,
  minDaysBetween: 1,
  maxDaysBetween: null,
  allowedGymIds: [],
  preferredWeekdays: [],
  preferredStart: null,
  preferredEnd: null,
  preferredGymIds: [],
  ...overrides,
});

const gym = (name: string, availability: EngineGym["availability"]): EngineGym => ({
  id: name,
  name,
  availability,
  hasConfiguredAvailability: true,
});

const trainer = (name: string, availability: EngineTrainer["availability"]): EngineTrainer => ({
  id: name,
  name,
  availability,
  hasConfiguredAvailability: true,
  teamIds: ["team"],
});

/*
  The real club that prompted this: three halls with narrow evening windows, one
  coach finishing at 20:00, and a team asking for four sessions on Mon/Tue/Thu/Fri.
*/
const HALLS = [
  gym("Casale", { 1: [{ start: 1080, end: 1200 }], 3: [{ start: 1080, end: 1200 }], 5: [{ start: 1080, end: 1200 }] }),
  gym("Codogno Communale", { 1: [{ start: 1080, end: 1200 }], 5: [{ start: 1080, end: 1200 }] }),
  gym("Codogno Sede", { 1: [{ start: 1200, end: 1320 }], 4: [{ start: 1200, end: 1320 }] }),
];
const KARIM = trainer("Karim", {
  1: [{ start: 1020, end: 1200 }],
  2: [{ start: 1020, end: 1200 }],
  3: [{ start: 1020, end: 1200 }],
  4: [{ start: 1020, end: 1200 }],
  5: [{ start: 1020, end: 1200 }],
});

describe("analyseWeekdays", () => {
  const days = analyseWeekdays(team(), HALLS, [KARIM]);
  const on = (weekday: number) => days.find((day) => day.isoWeekday === weekday)!;

  it("marks the days that actually work", () => {
    expect(on(1).blocker).toBe("USABLE");
    expect(on(5).blocker).toBe("USABLE");
  });

  it("says no hall is open, rather than blaming the coach", () => {
    // Tuesday: the coach is free, but not one hall opens.
    expect(on(2).blocker).toBe("NO_GYM_OPEN");
  });

  it("names both sides when the hall and the coach just miss each other", () => {
    // Thursday: Sede opens at 20:00, Karim finishes at 20:00.
    const thursday = on(4);
    expect(thursday.blocker).toBe("GYM_TRAINER_NO_OVERLAP");
    expect(thursday.gym).toEqual({ name: "Codogno Sede", from: 1200, until: 1320 });
    expect(thursday.trainer).toEqual({ name: "Karim", from: 1020, until: 1200 });
  });

  it("caps the week at the days that work", () => {
    expect(weeklyCeiling(team(), days)).toBe(2);
  });

  it("reports an overlap that exists but is too short to use", () => {
    const shortDays = analyseWeekdays(
      team({ allowedWeekdays: [1] }),
      [gym("Tight", { 1: [{ start: 1080, end: 1140 }] })],
      [KARIM],
    );
    expect(shortDays[0].blocker).toBe("WINDOW_TOO_SHORT");
    expect(shortDays[0].longestOverlap).toBe(60);
  });

  it("does not cap the week when a team may train twice in a day", () => {
    expect(weeklyCeiling(team({ minDaysBetween: 0 }), days)).toBeNull();
  });
});
