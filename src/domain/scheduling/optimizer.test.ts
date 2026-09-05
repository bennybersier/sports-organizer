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
  priority: 3,
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

describe("team priority", () => {
  /*
    One hall, one evening, two teams that both want it. Without priority the
    winner is whichever team the most-constrained heuristic happens to favour,
    which is not a decision a club can make.
  */
  // Exactly one 90-minute session fits, so the two teams genuinely compete.
  const oneSlot = { start: 18 * 60, end: 19 * 60 + 30 };
  const tightHall = { id: "hall", name: "hall", availability: { 1: [oneSlot] } };
  const coach = {
    id: "tr1",
    name: "tr1",
    teamIds: ["first", "second"],
    availability: { 1: [oneSlot] },
  };

  const contested = (priorities: { first: number; second: number }) =>
    run({
      teams: [
        team("first", { sessionsPerWeek: 1, allowedWeekdays: [1], priority: priorities.first }),
        team("second", { sessionsPerWeek: 1, allowedWeekdays: [1], priority: priorities.second }),
      ],
      gyms: [tightHall],
      trainers: [coach],
    });

  it("gives the contested slot to the higher-priority team", () => {
    const result = contested({ first: 1, second: 5 });
    expect(result.assignments.map((a) => a.teamId)).toEqual(["first"]);
    expect(result.unmet.map((u) => u.teamId)).toEqual(["second"]);
  });

  it("reverses when the priorities reverse", () => {
    const result = contested({ first: 5, second: 1 });
    expect(result.assignments.map((a) => a.teamId)).toEqual(["second"]);
    expect(result.unmet.map((u) => u.teamId)).toEqual(["first"]);
  });

  it("still respects hard constraints — priority buys order, not exemptions", () => {
    // The first team may not use the only hall that is open.
    const result = run({
      teams: [
        team("first", { sessionsPerWeek: 1, allowedWeekdays: [1], priority: 1, allowedGymIds: ["other"] }),
        team("second", { sessionsPerWeek: 1, allowedWeekdays: [1], priority: 5 }),
      ],
      gyms: [tightHall],
      trainers: [coach],
    });

    expect(result.assignments.map((a) => a.teamId)).toEqual(["second"]);
  });

  it("falls back to most-constrained-first when priorities are equal", () => {
    const result = run({
      teams: [
        // Only Monday works for this one; the other can use the whole week.
        team("narrow", { sessionsPerWeek: 1, allowedWeekdays: [1] }),
        team("wide", { sessionsPerWeek: 1 }),
      ],
      gyms: [gym("hall", [1, 2, 3, 4, 5])],
      trainers: [trainer("tr1", ["narrow", "wide"], [1, 2, 3, 4, 5])],
    });

    // Both fit, because the flexible team simply moves to another evening.
    expect(result.assignments).toHaveLength(2);
  });
});

describe("capacity and impossibility", () => {
  /*
    The real shape that prompted this: a team asking for four sessions on
    Mon/Tue/Thu/Fri, where Tuesday has no hall open at all and Thursday's only
    hall opens at 20:00 — exactly when the coach goes home. The team can train
    twice a week and no rescheduling changes that, so saying "the hall was
    already booked" would send an organizer hunting for the wrong thing.
  */
  it("says a team cannot reach its weekly total, and which days fail", () => {
    const evenings = (days: number[], window: { start: number; end: number }) =>
      Object.fromEntries(days.map((day) => [day, [window]]));

    const result = run({
      teams: [team("t1", { sessionsPerWeek: 4, allowedWeekdays: [1, 2, 4, 5] })],
      gyms: [
        { id: "casale", name: "Casale", availability: evenings([1, 3, 5], { start: 1080, end: 1200 }) },
        { id: "sede", name: "Sede", availability: evenings([1, 4], { start: 1200, end: 1320 }) },
      ],
      trainers: [
        {
          id: "karim",
          name: "Karim",
          teamIds: ["t1"],
          availability: evenings([1, 2, 3, 4, 5], { start: 1020, end: 1200 }),
        },
      ],
    });

    const reasons = result.unmet[0].reasons;
    const codes = reasons.map((reason) => reason.code);

    expect(result.assignments).toHaveLength(2);
    expect(codes).toContain("WEEKLY_CAPACITY");
    expect(reasons.find((r) => r.code === "WEEKLY_CAPACITY")?.values).toMatchObject({
      usableDays: 2,
      requested: 4,
    });

    // Tuesday is nobody's fault but the hall calendar's.
    expect(reasons.find((r) => r.code === "DAY_NO_GYM_OPEN")?.values).toMatchObject({ weekday: 2 });

    // Thursday names both sides, which is the actionable half.
    expect(reasons.find((r) => r.code === "DAY_NO_OVERLAP")?.values).toMatchObject({
      weekday: 4,
      gym: "Sede",
      gymFrom: 1200,
      trainer: "Karim",
      trainerUntil: 1200,
    });

    // And it must not blame contention, which was the misleading answer before.
    expect(codes).not.toContain("GYM_DOUBLE_BOOKED");
  });

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

describe("limited gym sharing", () => {
  /**
   * One hall, one evening, and only enough room for two 90-minute sessions if
   * they overlap at the changeover. Both teams are eligible for both slots.
   */
  const tightDay = (sharing?: EngineGym["sharing"]): ScheduleInput => ({
    teams: [
      team("early", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 1080, latestEnd: 1260 }),
      team("late", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 1080, latestEnd: 1260 }),
    ],
    // 18:00–21:00 fits one 90-minute session twice only if they may overlap.
    gyms: [{ id: "hall", name: "hall", availability: { 1: [{ start: 1080, end: 1230 }] }, sharing }],
    trainers: [trainer("a", ["early"], [1]), trainer("b", ["late"], [1])],
    blockedSlots: [],
  });

  it("leaves a team short when the hall takes one at a time", () => {
    const result = generateSchedule(tightDay());
    expect(result.stats.sessionsScheduled).toBe(1);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].reasons.map((r) => r.code)).toContain("GYM_DOUBLE_BOOKED");
  });

  it("places both when the hall permits a changeover, and says that it did", () => {
    const result = generateSchedule(
      tightDay({ maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 }),
    );

    expect(result.stats.sessionsScheduled).toBe(2);
    expect(result.unmet).toEqual([]);

    const shared = result.assignments.filter((a) =>
      a.explanation.tradeOffs.some((finding) => finding.code === "GYM_SHARED"),
    );
    // Exactly one of the two had to share — the first fitted on its own.
    expect(shared).toHaveLength(1);
    expect(shared[0].explanation.tradeOffs.find((f) => f.code === "GYM_SHARED")?.values).toMatchObject(
      { teams: 2 },
    );
  });

  it("refuses an overlap longer than the hall allows", () => {
    // The two sessions would have to overlap by 60 minutes to both fit here,
    // and this hall tolerates 30.
    const input = tightDay({ maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 });
    input.gyms[0].availability = { 1: [{ start: 1080, end: 1200 }] };

    const result = generateSchedule(input);
    expect(result.stats.sessionsScheduled).toBe(1);
  });

  it("prefers a slot nobody has to share over a higher-scoring shared one", () => {
    /*
      The second team's preferred hall is the contended one, so a shared slot
      there scores higher than the empty hall next door. Sharing is a
      concession, so it must lose to a slot that needs no concession at all.
    */
    const result = generateSchedule({
      teams: [
        team("first", { sessionsPerWeek: 1, allowedWeekdays: [1], earliestStart: 1080, latestEnd: 1260 }),
        team("second", {
          sessionsPerWeek: 1,
          allowedWeekdays: [1],
          earliestStart: 1080,
          latestEnd: 1260,
          priority: 4,
          preferredGymIds: ["shared"],
        }),
      ],
      gyms: [
        {
          id: "shared",
          name: "shared",
          availability: { 1: [{ start: 1080, end: 1230 }] },
          sharing: { maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 },
        },
        { id: "spare", name: "spare", availability: { 1: [{ start: 1080, end: 1260 }] } },
      ],
      trainers: [trainer("a", ["first", "second"], [1])],
      blockedSlots: [],
    });

    // Both placed, and the second is in the empty hall despite preferring the
    // other — no GYM_SHARED anywhere, because sharing was never needed.
    expect(result.stats.sessionsScheduled).toBe(2);
    expect(
      result.assignments.flatMap((a) => a.explanation.tradeOffs.map((f) => f.code)),
    ).not.toContain("GYM_SHARED");
  });

  it("is still deterministic with sharing on", () => {
    const once = generateSchedule(tightDay({ maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 }));
    const twice = generateSchedule(tightDay({ maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 }));
    expect(once.assignments).toEqual(twice.assignments);
  });

  it("still blames the weekday ceiling rather than contention when that is the cause", () => {
    // Sharing can only ever place more sessions, so a team limited by how many
    // days it can train at all must keep getting the sharper diagnosis.
    const result = generateSchedule({
      teams: [team("t1", { sessionsPerWeek: 3, allowedWeekdays: [1] })],
      gyms: [
        {
          id: "hall",
          name: "hall",
          availability: { 1: [evening] },
          sharing: { maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 },
        },
      ],
      trainers: [trainer("a", ["t1"], [1])],
      blockedSlots: [],
    });

    expect(result.unmet[0].reasons[0].code).toBe("WEEKLY_CAPACITY");
  });
});

describe("team-scoped blocked slots", () => {
  /*
    `BlockedSlot.teamId` has existed since the engine was written and
    `candidates.ts` has always matched on it, but nothing ever populated it, so
    the path was never exercised. Fixtures are the first caller — a team playing
    on Wednesday cannot train that Wednesday, while everyone else can.
  */
  const twoTeams = (blocked: ScheduleInput["blockedSlots"]) =>
    generateSchedule({
      teams: [
        team("playing", { sessionsPerWeek: 1, allowedWeekdays: [3] }),
        team("resting", { sessionsPerWeek: 1, allowedWeekdays: [3] }),
      ],
      gyms: [gym("hall", [3]), gym("annexe", [3])],
      trainers: [trainer("coach", ["playing", "resting"], [3])],
      blockedSlots: blocked,
    });

  it("removes only the named team's candidates", () => {
    const result = twoTeams([
      {
        isoWeekday: 3,
        window: evening,
        gymId: null,
        trainerId: null,
        teamId: "playing",
        reason: "vs Virtus",
      },
    ]);

    expect(result.assignments.map((a) => a.teamId)).toEqual(["resting"]);
    expect(result.unmet.map((u) => u.teamId)).toEqual(["playing"]);
  });

  it("blocks a hall for everyone when the slot names one", () => {
    const result = twoTeams([
      {
        isoWeekday: 3,
        window: evening,
        gymId: "hall",
        trainerId: null,
        teamId: null,
        reason: "Match in the main hall",
      },
    ]);

    // Both still place, but nobody is in the hall that was held.
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.every((a) => a.gymId === "annexe")).toBe(true);
  });

  it("blocks the hall and the team together when a slot carries both", () => {
    const result = twoTeams([
      {
        isoWeekday: 3,
        window: evening,
        gymId: "hall",
        trainerId: null,
        teamId: "playing",
        reason: "Home match",
      },
    ]);

    // The playing team is out entirely; the other keeps the annexe.
    expect(result.assignments.map((a) => a.teamId)).toEqual(["resting"]);
    expect(result.assignments[0].gymId).toBe("annexe");
  });
});
