import { describe, expect, it } from "vitest";

import { findRescueSlot } from "./rescue";
import type { EngineGym, EngineTeam, EngineTrainer } from "./types";

const team = (overrides: Partial<EngineTeam> = {}): EngineTeam => ({
  id: "t1",
  name: "U15",
  availability: {},
  sessionsPerWeek: 1,
  durationMinutes: 60,
  priority: 3,
  allowedWeekdays: [1],
  earliestStart: 17 * 60,
  latestEnd: 19 * 60,
  minDaysBetween: 1,
  maxDaysBetween: null,
  allowedGymIds: ["hall"],
  preferredWeekdays: [],
  preferredStart: null,
  preferredEnd: null,
  preferredGymIds: [],
  ...overrides,
});

const gym = (id: string, days: number[], from = 16 * 60, until = 22 * 60): EngineGym => ({
  id,
  name: id,
  availability: Object.fromEntries(days.map((day) => [day, [{ start: from, end: until }]])),
});

const coach: EngineTrainer = {
  id: "c1",
  name: "coach",
  teamIds: ["t1"],
  availability: Object.fromEntries([1, 2, 3].map((day) => [day, [{ start: 16 * 60, end: 22 * 60 }]])),
};

const find = (subject: EngineTeam, gyms: EngineGym[], taken: (c: { window: { start: number } }) => boolean = () => false) =>
  findRescueSlot({
    team: subject,
    gyms,
    trainers: [coach],
    blocked: [],
    granularity: 30,
    isPlaceable: (candidate) => !taken(candidate),
  });

describe("findRescueSlot", () => {
  it("offers a later slot before anything else", () => {
    // Everything inside 17:00–19:00 is taken; the hall is open until 22:00.
    const slot = find(team(), [gym("hall", [1])], (c) => c.window.start < 18 * 60);
    expect(slot).toMatchObject({ relaxation: "LATER", isoWeekday: 1 });
    expect(slot!.start).toBeGreaterThanOrEqual(18 * 60);
  });

  it("offers another hall when staying later would not help", () => {
    // The team's own hall is shut on its only weekday; another one is open.
    const slot = find(team(), [gym("hall", [2]), gym("annexe", [1])]);
    expect(slot).toMatchObject({ relaxation: "OTHER_GYM", gymId: "annexe", isoWeekday: 1 });
  });

  it("offers a hall in the team's own town before one further away", () => {
    /*
      A hall twenty kilometres off is free far more often than one down the
      road, so an unranked search reliably suggests the one nobody will drive
      to. Both are free here; the local one wins.
    */
    const local: EngineGym = { ...gym("local", [1]), city: "Codogno" };
    const distant: EngineGym = { ...gym("distant", [1]), city: "Lodi" };
    const home: EngineGym = { ...gym("hall", [2]), city: "Codogno" };

    // `distant` sorts before `local` alphabetically, so only the town breaks it.
    const slot = find(team(), [distant, local, home]);
    expect(slot).toMatchObject({ relaxation: "OTHER_GYM", gymId: "local" });
  });

  it("suggests a distant hall only to a side that already travels", () => {
    const distant: EngineGym = { ...gym("distant", [1]), city: "Lodi" };
    const home: EngineGym = { ...gym("hall", [2]), city: "Codogno" };
    const away: EngineGym = { ...gym("away", [2]), city: "Crema" };

    // Every hall in one town: no out-of-town suggestion, because this side
    // does not travel and would not start now.
    expect(find(team(), [distant, home])?.relaxation).not.toBe("OTHER_GYM");

    // Already spread across two towns, so a third is a real option.
    const traveller = team({ allowedGymIds: ["hall", "away"] });
    expect(find(traveller, [distant, home, away])).toMatchObject({
      relaxation: "OTHER_GYM",
      gymId: "distant",
    });
  });

  it("offers another weekday last", () => {
    // One hall, open only on a day the team has ruled out.
    const slot = find(team({ allowedGymIds: ["hall"] }), [gym("hall", [3])]);
    expect(slot).toMatchObject({ relaxation: "OTHER_WEEKDAY", isoWeekday: 3 });
  });

  it("finds nothing when nothing is free anywhere", () => {
    expect(find(team(), [gym("hall", [1])], () => true)).toBeNull();
  });

  it("does not offer a hall to a team that may already use every hall", () => {
    // An empty allow-list means "anywhere", so there is no wider set to search
    // and suggesting a hall would be suggesting what it already has.
    const slot = find(team({ allowedGymIds: [] }), [gym("hall", [1])], (c) => c.window.start < 18 * 60);
    expect(slot?.relaxation).toBe("LATER");
  });
});
