/**
 * Registers, call-ups and the season they add up to — through the real service
 * code, against a throwaway club that is removed afterwards.
 *
 * The unit tests already pin the arithmetic. What only a real database can
 * show is the half this module actually rests on: that a register survives the
 * schedule it came from being regenerated, that opening one twice does not make
 * two, that a declared absence pre-fills the sheet, and that the call-up cap is
 * refused with a sentence rather than a constraint name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Permission } from "@/domain/permissions";
import type { AuthContext } from "@/server/auth/context";
import {
  getRegisterSheet,
  openMatchRegister,
  openTrainingRegister,
  saveRegister,
  declareAbsence,
} from "@/server/services/attendance-service";
import {
  getAthletePerformance,
  getSquadPerformance,
  listAbsences,
  saveBoxScores,
  saveEvaluation,
} from "@/server/services/performance-service";

const db = createAdminClient();

let tenantId = "";
let userId = "";
let seasonId = "";
let teamId = "";
let gymId = "";
let versionId = "";
let entryId = "";
let eventId = "";
const athletes: string[] = [];
let context: AuthContext;

const insert = async <T,>(table: string, row: object): Promise<T> => {
  const { data, error } = await db.from(table as never).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
};

beforeAll(async () => {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const tenant = await insert<{ id: string }>("tenants", {
    name: "ZZ Attendance",
    slug: `zz-att-${stamp}`,
    timezone: "Europe/Rome",
  });
  tenantId = tenant.id;

  const { data: authUser } = await db.auth.admin.createUser({
    email: `zz-att-${stamp}@example.test`,
    password: `zz-${stamp}-Aa1!`,
    email_confirm: true,
  });
  userId = authUser.user!.id;

  const { data: role } = await db
    .from("roles").select("id, key, name, rank").eq("key", "OWNER").is("tenant_id", null).single();
  await insert("tenant_memberships", { tenant_id: tenantId, user_id: userId, role_id: role!.id });

  const season = await insert<{ id: string }>("seasons", {
    tenant_id: tenantId, name: "2026/2027",
    start_date: "2026-09-01", end_date: "2027-06-30", status: "ACTIVE",
  });
  seasonId = season.id;

  const gym = await insert<{ id: string }>("gyms", { tenant_id: tenantId, name: "Hall" });
  gymId = gym.id;

  const team = await insert<{ id: string }>("teams", {
    tenant_id: tenantId, season_id: seasonId, name: "U19", sport: "Basketball",
    match_call_up_limit: 12,
  });
  teamId = team.id;

  // Sixteen registered, which is the case the club described.
  for (let index = 0; index < 16; index += 1) {
    const athlete = await insert<{ id: string }>("athletes", {
      tenant_id: tenantId, first_name: `Player${index}`, last_name: "Test",
    });
    athletes.push(athlete.id);
    await insert("athlete_teams", {
      tenant_id: tenantId, athlete_id: athlete.id, team_id: teamId,
      jersey_number: index + 4, joined_at: "2026-09-01",
    });
  }

  const version = await insert<{ id: string }>("schedule_versions", {
    tenant_id: tenantId, season_id: seasonId, status: "PUBLISHED",
    applies_from: "2026-09-01", applies_until: "2027-06-30",
    published_at: new Date().toISOString(),
  });
  versionId = version.id;

  const entry = await insert<{ id: string }>("schedule_entries", {
    tenant_id: tenantId, season_id: seasonId, schedule_version_id: versionId,
    team_id: teamId, gym_id: gymId,
    start_at: "2026-09-15T18:00:00Z", end_at: "2026-09-15T20:00:00Z",
    status: "SCHEDULED",
  });
  entryId = entry.id;

  const event = await insert<{ id: string }>("calendar_events", {
    tenant_id: tenantId, season_id: seasonId, type: "MATCH", title: "U19 vs Rivals",
    opponent: "Rivals", is_home: true, competition: "U19 Eccellenza", gym_id: gymId,
    start_at: "2026-09-20T16:00:00Z", end_at: "2026-09-20T18:00:00Z",
  });
  eventId = event.id;
  await insert("calendar_event_teams", { tenant_id: tenantId, event_id: eventId, team_id: teamId });

  const { data: permissionRows } = await db.from("permissions").select("key");

  context = {
    user: { id: userId, email: "", fullName: null, avatarUrl: null, locale: "en", timezone: "Europe/Rome" },
    tenant: { id: tenantId, name: "ZZ Attendance", slug: `zz-att-${stamp}`, timezone: "Europe/Rome", locale: "en", weekStart: 1 },
    role: { key: role!.key, name: role!.name, rank: role!.rank },
    permissions: new Set((permissionRows ?? []).map((p) => p.key as Permission)),
    actorType: "USER", isPlatformAdmin: false, isActingAsStaff: false, db,
  } as unknown as AuthContext;
}, 120_000);

afterAll(async () => {
  if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  if (userId) await db.auth.admin.deleteUser(userId);
});

describe("training registers", () => {
  it("puts the whole squad on the sheet when it opens", async () => {
    const registerId = await openTrainingRegister(context, entryId);
    const sheet = await getRegisterSheet(context, registerId);

    expect(sheet.lines).toHaveLength(16);
    // Numbered shirts come first, in order — a coach reads down the sheet.
    expect(sheet.lines[0].jerseyNumber).toBe(4);
    expect(sheet.lines.every((line) => line.calledUp === null)).toBe(true);
  });

  it("opens the same sheet twice rather than making two", async () => {
    const first = await openTrainingRegister(context, entryId);
    const second = await openTrainingRegister(context, entryId);
    expect(second).toBe(first);
  });

  it("survives the schedule it came from being regenerated", async () => {
    const registerId = await openTrainingRegister(context, entryId);

    // What publishing a fresh version does to the old one's entries.
    await db.from("schedule_entries").delete().eq("id", entryId);

    const sheet = await getRegisterSheet(context, registerId);
    expect(sheet.lines).toHaveLength(16);
    // The pointer goes; the record and its snapshot stay.
    expect(sheet.register.schedule_entry_id).toBeNull();
    expect(sheet.register.starts_at).toBe("2026-09-15T18:00:00+00:00");

    // Put it back for the tests that follow.
    const entry = await insert<{ id: string }>("schedule_entries", {
      tenant_id: tenantId, season_id: seasonId, schedule_version_id: versionId,
      team_id: teamId, gym_id: gymId,
      start_at: "2026-09-15T18:00:00Z", end_at: "2026-09-15T20:00:00Z", status: "SCHEDULED",
    });
    entryId = entry.id;
  });

  it("pre-fills a sheet from an absence the club was told about", async () => {
    await declareAbsence(context, {
      athleteId: athletes[0],
      teamId: null,
      startsOn: "2026-09-14",
      endsOn: "2026-09-16",
      reason: "HOLIDAY",
      note: null,
      reportedBy: "Phoned in by a parent",
    });

    const later = await insert<{ id: string }>("schedule_entries", {
      tenant_id: tenantId, season_id: seasonId, schedule_version_id: versionId,
      team_id: teamId, gym_id: gymId,
      start_at: "2026-09-16T18:00:00Z", end_at: "2026-09-16T20:00:00Z", status: "SCHEDULED",
    });

    const sheet = await getRegisterSheet(context, await openTrainingRegister(context, later.id));
    const line = sheet.lines.find((l) => l.athleteId === athletes[0])!;

    expect(line.state).toBe("EXCUSED");
    expect(line.reason).toBe("HOLIDAY");
    // Flagged as assumed rather than observed, so the coach can tell.
    expect(line.prefilled).toBe(true);
  });
});

describe("match sheets", () => {
  it("starts with nobody picked, and the whole squad listed", async () => {
    const sheet = await getRegisterSheet(context, await openMatchRegister(context, eventId, teamId));

    expect(sheet.lines).toHaveLength(16);
    expect(sheet.lines.every((line) => line.calledUp === false)).toBe(true);
    expect(sheet.team.callUpLimit).toBe(12);
    expect(sheet.fixture?.opponent).toBe("Rivals");
  });

  it("refuses a thirteenth call-up in words a coach can act on", async () => {
    const registerId = await openMatchRegister(context, eventId, teamId);
    const sheet = await getRegisterSheet(context, registerId);

    await expect(
      saveRegister(context, {
        registerId,
        state: "OPEN",
        notes: null,
        lines: sheet.lines.map((line, index) => ({
          athleteId: line.athleteId,
          state: "PRESENT" as const,
          reason: null, minutesLate: null,
          calledUp: index < 13,
          started: false, benchReason: null, note: null,
        })),
      }),
    ).rejects.toThrow(/13 players.*holds 12/);
  });

  it("refuses a sixth starter", async () => {
    const registerId = await openMatchRegister(context, eventId, teamId);
    const sheet = await getRegisterSheet(context, registerId);

    await expect(
      saveRegister(context, {
        registerId,
        state: "OPEN",
        notes: null,
        lines: sheet.lines.map((line, index) => ({
          athleteId: line.athleteId,
          state: "PRESENT" as const,
          reason: null, minutesLate: null,
          calledUp: index < 12,
          started: index < 6,
          benchReason: null, note: null,
        })),
      }),
    ).rejects.toThrow(/six|5|five/i);
  });

  it("records twelve of sixteen, and the season counts all of it", async () => {
    const registerId = await openMatchRegister(context, eventId, teamId);
    const sheet = await getRegisterSheet(context, registerId);

    await saveRegister(context, {
      registerId,
      state: "RECORDED",
      notes: null,
      lines: sheet.lines.map((line, index) => ({
        athleteId: line.athleteId,
        state: index < 12 ? ("PRESENT" as const) : ("ABSENT" as const),
        reason: null, minutesLate: null,
        calledUp: index < 12,
        started: index < 5,
        // The last two picked never came on.
        benchReason: index >= 10 && index < 12 ? ("ROTATION" as const) : null,
        note: null,
      })),
    });

    const report = await getSquadPerformance(context, teamId);
    const picked = report.members.find((m) => m.athleteId === sheet.lines[0].athleteId)!;
    const dropped = report.members.find((m) => m.athleteId === sheet.lines[15].athleteId)!;

    expect(picked.matches.calledUp).toBe(1);
    expect(picked.matches.started).toBe(1);
    expect(picked.matches.played).toBe(1);

    // The four who were not picked are still on the report — the whole reason
    // every squad member gets a row.
    expect(dropped.matches.eligible).toBe(1);
    expect(dropped.matches.calledUp).toBe(0);
    expect(dropped.matches.omitted).toBe(1);
    expect(dropped.matches.currentOmissionStreak).toBe(1);

    // Picked, turned up, never came on: not counted as having played.
    const unused = report.members.find((m) => m.athleteId === sheet.lines[11].athleteId)!;
    expect(unused.matches.calledUp).toBe(1);
    expect(unused.matches.benched).toBe(1);
    expect(unused.matches.played).toBe(0);
  });
});

describe("the scoresheet", () => {
  it("refuses a line for someone who was not called up", async () => {
    const registerId = await openMatchRegister(context, eventId, teamId);
    const sheet = await getRegisterSheet(context, registerId);
    const dropped = sheet.lines.find((line) => !line.calledUp)!;

    await expect(
      saveBoxScores(context, {
        registerId,
        lines: [{ ...blankLine(dropped.athleteId), twoPointMade: 3, twoPointAttempted: 5 }],
      }),
    ).rejects.toThrow(/not called up/);
  });

  it("computes points, rebounds and valutazione rather than trusting them", async () => {
    const registerId = await openMatchRegister(context, eventId, teamId);
    const sheet = await getRegisterSheet(context, registerId);
    const scorer = sheet.lines.find((line) => line.calledUp)!;

    await saveBoxScores(context, {
      registerId,
      lines: [
        {
          ...blankLine(scorer.athleteId),
          secondsPlayed: 1634,
          twoPointMade: 5, twoPointAttempted: 9,
          threePointMade: 2, threePointAttempted: 6,
          freeThrowMade: 3, freeThrowAttempted: 4,
          offensiveRebounds: 2, defensiveRebounds: 5,
          assists: 4, steals: 2, blocks: 1, turnovers: 3,
          foulsCommitted: 2, foulsDrawn: 3,
        },
      ],
    });

    const { data } = await db
      .from("match_box_scores")
      .select("points, rebounds, efficiency")
      .eq("register_id", registerId)
      .eq("athlete_id", scorer.athleteId)
      .single();

    expect(data!.points).toBe(19);
    expect(data!.rebounds).toBe(7);
    // 36 earned, 14 given away.
    expect(data!.efficiency).toBe(22);

    // And it reaches the athlete's season as an average.
    const performance = await getAthletePerformance(context, scorer.athleteId);
    expect(performance.boxScore?.games).toBe(1);
    expect(performance.boxScore?.perGame.points).toBe(19);
  });

  it("edits a line rather than duplicating it", async () => {
    const registerId = await openMatchRegister(context, eventId, teamId);
    const sheet = await getRegisterSheet(context, registerId);
    const scorer = sheet.lines.find((line) => line.calledUp)!;

    await saveBoxScores(context, {
      registerId,
      lines: [{ ...blankLine(scorer.athleteId), twoPointMade: 1, twoPointAttempted: 1 }],
    });

    const { data } = await db
      .from("match_box_scores")
      .select("points")
      .eq("register_id", registerId)
      .eq("athlete_id", scorer.athleteId);

    expect(data).toHaveLength(1);
    expect(data![0].points).toBe(2);
  });
});

describe("assessments and absences", () => {
  it("keeps one assessment per player, squad and period", async () => {
    const first = await saveEvaluation(context, {
      athleteId: athletes[0], teamId, trainerId: null,
      periodStart: "2026-09-01", periodEnd: "2026-11-30",
      technique: 3, tactical: 3, physical: 4, attitude: 4,
      strengths: "Reads the pick and roll.", development: null, note: null,
    });

    // The same period again edits rather than failing on the unique index.
    const second = await saveEvaluation(context, {
      athleteId: athletes[0], teamId, trainerId: null,
      periodStart: "2026-09-01", periodEnd: "2026-11-30",
      technique: 4, tactical: 3, physical: 4, attitude: 5,
      strengths: "Reads the pick and roll.", development: "Left hand.", note: null,
    });

    expect(second.id).toBe(first.id);

    const performance = await getAthletePerformance(context, athletes[0]);
    expect(performance.evaluations).toHaveLength(1);
    expect(performance.evaluations[0].technique).toBe(4);
    expect(performance.evaluations[0].development).toBe("Left hand.");
  });

  it("refuses an assessment that scores nothing and says nothing", async () => {
    await expect(
      saveEvaluation(context, {
        athleteId: athletes[1], teamId, trainerId: null,
        periodStart: "2026-09-01", periodEnd: "2026-11-30",
        technique: null, tactical: null, physical: null, attitude: null,
        strengths: null, development: null, note: null,
      }),
    ).rejects.toThrow();
  });

  it("lists a declared absence against the athlete", async () => {
    const declared = await listAbsences(context, athletes[0]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared[0].reason).toBe("HOLIDAY");
    expect(declared[0].reported_by).toBe("Phoned in by a parent");
  });
});

/** Every counter at zero, so a test only states the numbers it cares about. */
function blankLine(athleteId: string) {
  return {
    athleteId,
    secondsPlayed: 0,
    twoPointMade: 0, twoPointAttempted: 0,
    threePointMade: 0, threePointAttempted: 0,
    freeThrowMade: 0, freeThrowAttempted: 0,
    offensiveRebounds: 0, defensiveRebounds: 0,
    assists: 0, steals: 0, blocks: 0, turnovers: 0,
    foulsCommitted: 0, foulsDrawn: 0,
    plusMinus: null,
  };
}
