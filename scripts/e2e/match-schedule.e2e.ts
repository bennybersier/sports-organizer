/**
 * Fixtures, through the real service code.
 *
 * A match has to do three separate things, and the ways it can go wrong are all
 * ways of confusing them: block the team that plays, hold the hall for setup
 * and pack-down as well as the game, and — the one that is easy to get
 * catastrophically wrong — cost that team *only that evening* rather than every
 * Wednesday for the rest of the season.
 *
 * Builds a throwaway club with a two-month season, plants three fixtures, and
 * checks what generation actually wrote. Removes everything it made.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Permission } from "@/domain/permissions";
import type { AuthContext } from "@/server/auth/context";
import { generateAndStore } from "@/server/services/schedule-generation-service";

const db = createAdminClient();

const SEASON_START = "2026-09-07";
const SEASON_END = "2026-11-08";

/** A Wednesday in the third week — deliberately not the representative one. */
const MATCH_DATE = "2026-09-23";
/** The same weekday, a fortnight later. Must survive. */
const LATER_WEDNESDAY = "2026-10-07";

let tenantId = "";
let userId = "";
let seasonId = "";
let gymId = "";
let spareGymId = "";
let context: AuthContext;
const team: Record<string, string> = {};

const insert = async <T,>(table: string, row: object): Promise<T> => {
  const { data, error } = await db.from(table as never).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
};

beforeAll(async () => {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const tenant = await insert<{ id: string }>("tenants", {
    name: "ZZ Fixtures",
    slug: `zz-fixtures-${stamp}`,
    timezone: "Europe/Rome",
  });
  tenantId = tenant.id;

  const { data: authUser } = await db.auth.admin.createUser({
    email: `zz-fixtures-${stamp}@example.test`,
    password: `zz-${stamp}-Aa1!`,
    email_confirm: true,
  });
  userId = authUser.user!.id;

  const { data: role } = await db
    .from("roles")
    .select("id, key, name, rank")
    .eq("key", "OWNER")
    .is("tenant_id", null)
    .single();
  await insert("tenant_memberships", { tenant_id: tenantId, user_id: userId, role_id: role!.id });

  const season = await insert<{ id: string }>("seasons", {
    tenant_id: tenantId,
    name: "2026/2027",
    start_date: SEASON_START,
    end_date: SEASON_END,
    status: "ACTIVE",
  });
  seasonId = season.id;

  const hall = await insert<{ id: string }>("gyms", { tenant_id: tenantId, name: "Hall" });
  gymId = hall.id;
  const spare = await insert<{ id: string }>("gyms", { tenant_id: tenantId, name: "Annexe" });
  spareGymId = spare.id;

  const trainer = await insert<{ id: string }>("trainers", {
    tenant_id: tenantId,
    first_name: "Ada",
    last_name: "Coach",
  });

  // Three sides, all training once a week on a Wednesday evening. `playing`
  // and `travelling` have fixtures; `resting` never does, and is the control.
  // `cautious` trains Tuesdays and Thursdays and keeps a day clear either side
  // of a fixture. Deliberately off Wednesday: the others are all there, and one
  // coach can only take so many 90-minute sessions in an evening.
  for (const name of ["playing", "travelling", "resting", "cautious"]) {
    const row = await insert<{ id: string }>("teams", {
      tenant_id: tenantId,
      season_id: seasonId,
      name,
      sport: "Basketball",
    });
    team[name] = row.id;
    await insert("trainer_teams", { tenant_id: tenantId, trainer_id: trainer.id, team_id: row.id });
    await insert("team_training_requirements", {
      tenant_id: tenantId,
      season_id: seasonId,
      team_id: row.id,
      sessions_per_week: name === "cautious" ? 2 : 1,
      duration_minutes: 90,
      allowed_weekdays: name === "cautious" ? [2, 4] : [3],
      match_rest_days: name === "cautious" ? 1 : 0,
      earliest_start: "17:00",
      latest_end: "22:00",
    });
  }

  // Both halls and the coach are free every Wednesday evening, so nothing is
  // ever short for a reason other than a fixture.
  for (const weekday of [2, 3, 4]) {
    for (const id of [gymId, spareGymId]) {
      await insert("gym_availability", {
        tenant_id: tenantId,
        gym_id: id,
        iso_weekday: weekday,
        start_time: "17:00",
        end_time: "22:00",
        valid_from: "2026-09-01",
      });
    }
    await insert("trainer_availability", {
      tenant_id: tenantId,
      trainer_id: trainer.id,
      iso_weekday: weekday,
      start_time: "17:00",
      end_time: "22:00",
      valid_from: "2026-09-01",
    });
  }

  /* A home fixture: holds the hall 17:30–21:30 once its buffers are counted. */
  const home = await insert<{ id: string }>("calendar_events", {
    tenant_id: tenantId,
    season_id: seasonId,
    type: "MATCH",
    title: "playing v Virtus",
    opponent: "Virtus",
    is_home: true,
    gym_id: gymId,
    start_at: `${MATCH_DATE}T17:00:00Z`, // 19:00 Rome
    end_at: `${MATCH_DATE}T19:00:00Z`, // 21:00 Rome
    buffer_before_minutes: 90,
    buffer_after_minutes: 30,
  });
  await insert("calendar_event_teams", {
    tenant_id: tenantId,
    event_id: home.id,
    team_id: team.playing,
  });

  /* An away fixture the same evening: blocks the team, holds no hall of ours. */
  const away = await insert<{ id: string }>("calendar_events", {
    tenant_id: tenantId,
    season_id: seasonId,
    type: "MATCH",
    title: "Crema v travelling",
    opponent: "Crema",
    is_home: false,
    location: "Palazzetto Crema",
    start_at: `${MATCH_DATE}T17:00:00Z`,
    end_at: `${MATCH_DATE}T19:00:00Z`,
  });
  await insert("calendar_event_teams", {
    tenant_id: tenantId,
    event_id: away.id,
    team_id: team.travelling,
  });

  /* A third fixture, so the rest-day rule has something to rest around. */
  const cautiousMatch = await insert<{ id: string }>("calendar_events", {
    tenant_id: tenantId,
    season_id: seasonId,
    type: "MATCH",
    title: "cautious v Crema",
    opponent: "Crema",
    is_home: false,
    start_at: `${MATCH_DATE}T17:00:00Z`,
    end_at: `${MATCH_DATE}T19:00:00Z`,
  });
  await insert("calendar_event_teams", {
    tenant_id: tenantId,
    event_id: cautiousMatch.id,
    team_id: team.cautious,
  });

  const { data: permissionRows } = await db.from("permissions").select("key");

  context = {
    user: {
      id: userId,
      email: `zz-fixtures-${stamp}@example.test`,
      fullName: null,
      avatarUrl: null,
      locale: "en",
      timezone: "Europe/Rome",
    },
    tenant: {
      id: tenantId,
      name: "ZZ Fixtures",
      slug: `zz-fixtures-${stamp}`,
      timezone: "Europe/Rome",
      locale: "en",
      weekStart: 1,
    },
    role: { key: role!.key, name: role!.name, rank: role!.rank },
    permissions: new Set((permissionRows ?? []).map((p) => p.key as Permission)),
    actorType: "USER",
    isPlatformAdmin: false,
    isActingAsStaff: false,
    db,
  } as unknown as AuthContext;
}, 120_000);

afterAll(async () => {
  if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  if (userId) await db.auth.admin.deleteUser(userId);
});

describe("fixtures and training", () => {
  let dates: Record<string, string[]> = {};
  let skipped: { teamId: string; date: string; code: string }[] = [];

  beforeAll(async () => {
    const stored = await generateAndStore(context, { seasonId, name: "with fixtures" });

    const { data: rows } = await db
      .from("schedule_entries")
      .select("team_id, start_at, gym_id")
      .eq("schedule_version_id", stored.versionId)
      .neq("status", "CANCELLED");

    dates = {};
    for (const row of rows ?? []) {
      // The club is in Rome and every session is in the evening, so the UTC
      // date is the local one; no need to convert for a date comparison.
      const date = row.start_at.slice(0, 10);
      dates[row.team_id] = [...(dates[row.team_id] ?? []), date];
    }

    // The skip list is persisted with the version rather than returned: it
    // belongs to the stored explanation, not to the engine's own result.
    const { data: version } = await db
      .from("schedule_versions")
      .select("result_summary")
      .eq("id", stored.versionId)
      .single();

    const summary = version!.result_summary as {
      skipped?: { teamId: string; date: string; code: string }[];
    };
    skipped = summary.skipped ?? [];
  }, 180_000);

  it("does not train a team on the day it plays at home", () => {
    expect(dates[team.playing]).not.toContain(MATCH_DATE);
  });

  it("does not train a team on the day it plays away either", () => {
    // An away fixture holds none of our halls, but the squad is on a coach.
    expect(dates[team.travelling]).not.toContain(MATCH_DATE);
  });

  it("keeps every other Wednesday for the teams that played", () => {
    // The one that matters most: a single fixture must cost one evening, not
    // the weekday. Feeding fixtures into the weekly pattern would empty both.
    expect(dates[team.playing]).toContain(LATER_WEDNESDAY);
    expect(dates[team.travelling]).toContain(LATER_WEDNESDAY);
    expect(dates[team.playing].length).toBeGreaterThan(5);
  });

  it("says why the sessions were not created", () => {
    const reasons = skipped.filter((entry) => entry.date === MATCH_DATE);
    const codeFor = (teamId: string) =>
      reasons.find((entry) => entry.teamId === teamId)?.code;

    // Both sides that played are told they were playing — a code the UI can
    // translate, not an English sentence baked in at the point of the skip.
    expect(codeFor(team.playing)).toBe("SKIP_MATCH");
    expect(codeFor(team.travelling)).toBe("SKIP_MATCH");

    // A bystander whose pattern put it in the held hall is told something
    // different and true: the hall was taken, not that it was playing.
    if (codeFor(team.resting)) expect(codeFor(team.resting)).toBe("SKIP_EVENT");
  });

  it("holds the hall for setup and pack-down, not just the game", async () => {
    /*
      The match runs 19:00–21:00 in Rome; with 90 minutes of setup and 30 of
      pack-down the hall is gone 17:30–21:30, which swallows the whole evening
      a 90-minute session could have used. So nothing trains there that night —
      while the same hall is in normal use a fortnight later, which is what
      shows the buffer did it rather than some standing rule.
    */
    const inHall = async (date: string) => {
      const { data } = await db
        .from("schedule_entries")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("gym_id", gymId)
        .gte("start_at", `${date}T00:00:00Z`)
        .lt("start_at", `${date}T23:59:59Z`);
      return (data ?? []).length;
    };

    expect(await inHall(MATCH_DATE)).toBe(0);
    expect(await inHall(LATER_WEDNESDAY)).toBeGreaterThan(0);
  });

  it("keeps the day either side clear when a team asks for rest days", () => {
    /*
      `cautious` plays on the Wednesday and rests one day either side, so it
      loses the Tuesday before and the Thursday after — and nothing else. The
      week before is untouched, which is what separates a rest day from a
      standing ban on the weekday.
    */
    expect(dates[team.cautious]).not.toContain("2026-09-22");
    expect(dates[team.cautious]).not.toContain("2026-09-24");
    expect(dates[team.cautious]).toContain("2026-09-15");
    expect(dates[team.cautious]).toContain("2026-09-17");
  });

  it("tells a rest day apart from a match day", () => {
    // Two different sentences for two different situations: the team is not
    // playing on the Tuesday, it is resting — so an organizer looking at the
    // gap is not sent hunting for a fixture that is not there.
    const codes = new Map(
      skipped
        .filter((entry) => entry.teamId === team.cautious)
        .map((entry) => [entry.date, entry.code]),
    );
    expect(codes.get("2026-09-22")).toBe("SKIP_REST_DAY");
    expect(codes.get("2026-09-24")).toBe("SKIP_REST_DAY");

    const playingCodes = skipped.filter((entry) => entry.teamId === team.playing);
    expect(playingCodes.map((entry) => entry.code)).toContain("SKIP_MATCH");
  });

  it("rests only the team that asked for it", () => {
    // `resting` trains Wednesdays only, so the proof is that it is unaffected
    // by another team's fixture: rest days are per team, not per club.
    expect(dates[team.resting]).toContain(LATER_WEDNESDAY);
  });

  it("costs a bystander only that evening", () => {
    /*
      `resting` has no fixture at all. If the weekly pattern happened to put it
      in the held hall it loses that Wednesday — occurrences are an expansion of
      one weekly pattern, so a clash is a skip, not a re-placement elsewhere.
      What must never happen is losing the weekday.
    */
    expect(dates[team.resting]).toContain(LATER_WEDNESDAY);
    expect(dates[team.resting].length).toBeGreaterThan(5);
  });
});
