import { describe, expect, it } from "vitest";

import { generateSchedule } from "./optimizer";
import type { EngineGym, EngineTeam, EngineTrainer, ScheduleInput } from "./types";

/**
 * The scenarios the spec calls out, plus the ones that turned out to matter
 * while building it. Every case runs entirely in memory.
 */

const evening = { start: 960, end: 1320 }; // 16:00–22:00

const gym = (id: string, days: number[] = [1, 2, 3, 4, 5]): EngineGym => ({
  id,
  name: id,
  availability: Object.fromEntries(days.map((day) => [day, [evening]])),
});

const trainer = (id: string, teamIds: string[], days: number[] = [1, 2, 3, 4, 5]): EngineTrainer => ({
  id,
  name: id,
  teamIds,
  availability: Object.fromEntries(days.map((day) => [day, [evening]])),
});

const team = (id: string, overrides: Partial<EngineTeam> = {}): EngineTeam => ({
  id,
  name: id,
  availability: {},
  sessionsPerWeek: 2,
  durationMinutes: 90,
  allowedWeekdays: [1, 2, 3, 4, 5],
  earliestStart: 960,
  latestEnd: 1320,
  minDaysBetween: 1,
  maxDaysBetween: null,
  allowedGymIds: [],
  preferredWeekdays: [],
  preferredStart: null,
  preferredEnd: null,
  preferredGymIds: [],
  ...overrides,
});

const run = (input: Partial<ScheduleInput> & Pick<ScheduleInput, "teams">) =>
  generateSchedule({ trainers: [], gyms: [], blockedSlots: [], ...input });

describe("basic scheduling", () => {
  it("places one team in the single slot available to it", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 1080, latestEnd: 1170 })],
      gyms: [gym("g1", [1])],
      trainers: [trainer("tr1", ["t1"], [1])],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.unmet).toEqual([]);
    expect(result.assignments[0]).toMatchObject({
      teamId: "t1",
      gymId: "g1",
      trainerId: "tr1",
      isoWeekday: 1,
      window: { start: 1080, end: 1170 },
    });
  });

  it("places every session a team asks for", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 3 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });

    expect(result.assignments).toHaveLength(3);
    expect(result.stats.sessionsScheduled).toBe(3);
  });

  it("is deterministic — the same input gives the same schedule", () => {
    const input = {
      teams: [team("t1", { sessionsPerWeek: 2 }), team("t2", { sessionsPerWeek: 2 })],
      gyms: [gym("g1"), gym("g2")],
      trainers: [trainer("tr1", ["t1"]), trainer("tr2", ["t2"])],
    };
    const a = run(input);
    const b = run(input);
    expect(a.assignments).toEqual(b.assignments);
  });
});

describe("hard constraints are never violated", () => {
  it("never puts two teams in one gym at the same time", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 3 }), team("t2", { sessionsPerWeek: 3 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"]), trainer("tr2", ["t2"])],
    });

    for (const a of result.assignments) {
      for (const b of result.assignments) {
        if (a === b) continue;
        if (a.gymId !== b.gymId || a.isoWeekday !== b.isoWeekday) continue;
        expect(a.window.start >= b.window.end || b.window.start >= a.window.end).toBe(true);
      }
    }
  });

  it("never books one trainer in two places at once", () => {
    // One coach for both teams: they cannot run simultaneously.
    const shared = trainer("tr1", ["t1", "t2"]);
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 2 }), team("t2", { sessionsPerWeek: 2 })],
      gyms: [gym("g1"), gym("g2")],
      trainers: [shared],
    });

    for (const a of result.assignments) {
      for (const b of result.assignments) {
        if (a === b || a.trainerId !== b.trainerId || a.isoWeekday !== b.isoWeekday) continue;
        expect(a.window.start >= b.window.end || b.window.start >= a.window.end).toBe(true);
      }
    }
  });

  it("respects the hours a gym is open", () => {
    const morning: EngineGym = { id: "g1", name: "g1", availability: { 1: [{ start: 540, end: 720 }] } };
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 540, latestEnd: 720 })],
      gyms: [morning],
      trainers: [trainer("tr1", ["t1"], [1])],
    });
    // The trainer is only free in the evening, so nothing overlaps.
    expect(result.assignments).toHaveLength(0);
    expect(result.unmet).toHaveLength(1);
  });

  it("respects a team's own availability when it has some", () => {
    const result = run({
      teams: [
        team("t1", {
          sessionsPerWeek: 1,
          availability: { 3: [{ start: 1080, end: 1200 }] },
        }),
      ],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].isoWeekday).toBe(3);
  });

  it("keeps sessions at least minDaysBetween apart", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 2, minDaysBetween: 2 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });

    expect(result.assignments).toHaveLength(2);
    const [a, b] = result.assignments;
    expect(Math.abs(a.isoWeekday - b.isoWeekday)).toBeGreaterThanOrEqual(2);
  });

  it("only uses gyms the team is allowed to use", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 2, allowedGymIds: ["g2"] })],
      gyms: [gym("g1"), gym("g2")],
      trainers: [trainer("tr1", ["t1"])],
    });
    expect(result.assignments.every((a) => a.gymId === "g2")).toBe(true);
  });

  it("only offers trainers who actually coach the team", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["other-team"])],
    });
    // No eligible coach, so the slot is placed unstaffed rather than not at all.
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].trainerId).toBeNull();
  });
});

describe("blocked time", () => {
  it("avoids a hall closure", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, allowedWeekdays: [1] })],
      gyms: [gym("g1", [1])],
      trainers: [trainer("tr1", ["t1"], [1])],
      blockedSlots: [
        {
          isoWeekday: 1,
          window: { start: 960, end: 1200 },
          gymId: "g1",
          trainerId: null,
          teamId: null,
          reason: "Floor resurfacing",
        },
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].window.start).toBeGreaterThanOrEqual(1200);
  });

  it("avoids a trainer's holiday", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, allowedWeekdays: [1, 2] })],
      gyms: [gym("g1", [1, 2])],
      trainers: [trainer("tr1", ["t1"], [1, 2])],
      blockedSlots: [
        {
          isoWeekday: 1,
          window: { start: 0, end: 1440 },
          gymId: null,
          trainerId: "tr1",
          teamId: null,
          reason: "Vacation",
        },
      ],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].isoWeekday).toBe(2);
  });
});

describe("preferences steer without blocking", () => {
  it("prefers the team's preferred weekday", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, preferredWeekdays: [4] })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });
    expect(result.assignments[0].isoWeekday).toBe(4);
    expect(result.assignments[0].score).toBe(100);
  });

  it("prefers the team's preferred gym", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, preferredGymIds: ["g2"] })],
      gyms: [gym("g1"), gym("g2")],
      trainers: [trainer("tr1", ["t1"])],
    });
    expect(result.assignments[0].gymId).toBe("g2");
  });

  it("prefers the team's preferred time window", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, preferredStart: 1140, preferredEnd: 1260 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });
    const { window } = result.assignments[0];
    expect(window.start).toBeGreaterThanOrEqual(1140);
    expect(window.end).toBeLessThanOrEqual(1260);
  });

  it("places the session anyway when a preference cannot be met, and says so", () => {
    // Preferred day is Saturday, but the team may only train on weekdays.
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, allowedWeekdays: [1], preferredWeekdays: [6] })],
      gyms: [gym("g1", [1])],
      trainers: [trainer("tr1", ["t1"], [1])],
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].score).toBeLessThan(100);
    expect(result.assignments[0].explanation.tradeOffs.map((t) => t.code)).toContain(
      "NOT_PREFERRED_WEEKDAY",
    );
  });
});

describe("capacity and impossibility", () => {
  it("explains that no gym is available at all", () => {
    const result = run({ teams: [team("t1")], gyms: [], trainers: [] });
    expect(result.assignments).toHaveLength(0);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].reasons.map((r) => r.code)).toContain("NO_ELIGIBLE_GYM");
  });

  it("explains a session that cannot fit its allowed window", () => {
    const result = run({
      teams: [team("t1", { durationMinutes: 120, earliestStart: 1080, latestEnd: 1140 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });
    expect(result.unmet[0].reasons.map((r) => r.code)).toContain("SESSION_LONGER_THAN_WINDOW");
  });

  it("reports a partial shortfall rather than pretending it succeeded", () => {
    // One hall, one evening, three teams wanting two sessions each.
    const result = run({
      teams: [
        team("t1", { sessionsPerWeek: 2, allowedWeekdays: [1] }),
        team("t2", { sessionsPerWeek: 2, allowedWeekdays: [1] }),
        team("t3", { sessionsPerWeek: 2, allowedWeekdays: [1] }),
      ],
      gyms: [gym("g1", [1])],
      trainers: [trainer("tr1", ["t1"]), trainer("tr2", ["t2"]), trainer("tr3", ["t3"])],
    });

    // minDaysBetween is 1, so nobody can have two sessions on one day.
    expect(result.stats.sessionsScheduled).toBeLessThan(6);
    expect(result.unmet.length).toBeGreaterThan(0);
    for (const shortfall of result.unmet) {
      expect(shortfall.scheduled).toBeLessThan(shortfall.requested);
      expect(shortfall.reasons.length).toBeGreaterThan(0);
    }
  });

  it("gives the most-constrained team priority over one with options", () => {
    // t-tight can only ever use Monday; t-loose can use any weekday.
    const result = run({
      teams: [
        team("t-loose", { sessionsPerWeek: 1 }),
        team("t-tight", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 1080, latestEnd: 1170 }),
      ],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t-loose"]), trainer("tr2", ["t-tight"])],
    });

    expect(result.unmet).toEqual([]);
    expect(result.assignments.find((a) => a.teamId === "t-tight")).toMatchObject({
      isoWeekday: 1,
      window: { start: 1080, end: 1170 },
    });
  });
});

describe("result quality", () => {
  it("prices the shortfall into the overall score", () => {
    const full = run({
      teams: [team("t1", { sessionsPerWeek: 2 })],
      gyms: [gym("g1")],
      trainers: [trainer("tr1", ["t1"])],
    });
    const partial = run({
      teams: [team("t1", { sessionsPerWeek: 2, allowedWeekdays: [1] })],
      gyms: [gym("g1", [1])],
      trainers: [trainer("tr1", ["t1"], [1])],
    });

    // The partial run places a perfectly good session but only one of two.
    expect(full.score).toBeGreaterThan(partial.score);
  });

  it("reports how many alternatives each placement had", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 1080, latestEnd: 1170 })],
      gyms: [gym("g1", [1])],
      trainers: [trainer("tr1", ["t1"], [1])],
    });
    // Exactly one slot fits, which is what makes this team fragile.
    expect(result.assignments[0].explanation.alternatives).toBe(1);
  });

  it("spreads load across gyms rather than filling one", () => {
    const result = run({
      teams: Array.from({ length: 4 }, (_, i) => team(`t${i}`, { sessionsPerWeek: 2 })),
      gyms: [gym("g1"), gym("g2")],
      trainers: Array.from({ length: 4 }, (_, i) => trainer(`tr${i}`, [`t${i}`])),
    });

    const load = Object.values(result.stats.gymUtilisation);
    expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(2);
  });

  it("reports honest statistics", () => {
    const result = run({
      teams: [team("t1", { sessionsPerWeek: 2 }), team("t2", { sessionsPerWeek: 3 })],
      gyms: [gym("g1"), gym("g2")],
      trainers: [trainer("tr1", ["t1"]), trainer("tr2", ["t2"])],
    });

    expect(result.stats.teams).toBe(2);
    expect(result.stats.sessionsRequested).toBe(5);
    expect(result.stats.sessionsScheduled).toBe(result.assignments.length);
    expect(result.stats.candidatesConsidered).toBeGreaterThan(0);
  });
});
