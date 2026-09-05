/**
 * Competitions, through the real service code.
 *
 * The point of the module is that entering a league tells a club what it owes,
 * and that dating one of those matches puts it on the calendar — where it
 * blocks the team and holds the hall like any other fixture. Both halves are
 * checked here against a throwaway club, which is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Permission } from "@/domain/permissions";
import type { AuthContext } from "@/server/auth/context";
import {
  createCompetition,
  generateFixtures,
  listFixtures,
  scheduleFixture,
  setEntries,
} from "@/server/services/competition-service";

const db = createAdminClient();

let tenantId = "";
let userId = "";
let seasonId = "";
let teamId = "";
let gymId = "";
let competitionId = "";
let context: AuthContext;

const insert = async <T,>(table: string, row: object): Promise<T> => {
  const { data, error } = await db.from(table as never).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
};

beforeAll(async () => {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const tenant = await insert<{ id: string }>("tenants", {
    name: "ZZ Competitions",
    slug: `zz-comp-${stamp}`,
    timezone: "Europe/Rome",
  });
  tenantId = tenant.id;

  const { data: authUser } = await db.auth.admin.createUser({
    email: `zz-comp-${stamp}@example.test`,
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

  const gym = await insert<{ id: string }>("gyms", { tenant_id: tenantId, name: "Home Hall" });
  gymId = gym.id;

  const team = await insert<{ id: string }>("teams", {
    tenant_id: tenantId, season_id: seasonId, name: "U19", sport: "Basketball",
    home_gym_id: gymId,
  });
  teamId = team.id;

  const { data: permissionRows } = await db.from("permissions").select("key");

  context = {
    user: { id: userId, email: "", fullName: null, avatarUrl: null, locale: "en", timezone: "Europe/Rome" },
    tenant: { id: tenantId, name: "ZZ Competitions", slug: `zz-comp-${stamp}`, timezone: "Europe/Rome", locale: "en", weekStart: 1 },
    role: { key: role!.key, name: role!.name, rank: role!.rank },
    permissions: new Set((permissionRows ?? []).map((p) => p.key as Permission)),
    actorType: "USER", isPlatformAdmin: false, isActingAsStaff: false, db,
  } as unknown as AuthContext;

  const competition = await createCompetition(context, {
    seasonId, teamId, name: "Under 19 Eccellenza",
    format: "LEAGUE", phase: "SINGLE", parentId: null, expectedClubs: null,
    homeBufferBeforeMinutes: 90, homeBufferAfterMinutes: 60, notes: null,
  });
  competitionId = competition.id;
}, 120_000);

afterAll(async () => {
  if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  if (userId) await db.auth.admin.deleteUser(userId);
});

describe("competitions", () => {
  it("enters our own team without being asked", async () => {
    // Home and away are only computable once we are a participant, so the
    // club never has to add its own side to its own competition.
    const { data } = await db
      .from("competition_entries").select("club_name, team_id").eq("competition_id", competitionId);
    expect(data).toHaveLength(1);
    expect(data![0].team_id).toBe(teamId);
  });

  it("plans a home and an away match against every club entered", async () => {
    await setEntries(context, {
      competitionId,
      clubs: ["Cantù", "Varese", "Bergamo", "Brescia", "Cremona", "Pavia", "Treviglio"].map(
        (clubName) => ({ clubName, town: clubName, venue: null }),
      ),
    });

    const planned = await generateFixtures(context, competitionId);
    expect(planned).toBe(14);

    const fixtures = await listFixtures(context, competitionId);
    expect(fixtures.filter((f) => f.isHome)).toHaveLength(7);
    expect(fixtures.filter((f) => f.isHome === false)).toHaveLength(7);
  }, 60_000);

  it("refuses to plan twice over dates somebody has agreed", async () => {
    expect(await generateFixtures(context, competitionId)).toBe(0);
  });

  it("puts a dated home fixture on the calendar, holding the hall", async () => {
    const fixtures = await listFixtures(context, competitionId);
    const home = fixtures.find((f) => f.isHome)!;

    await scheduleFixture(context, {
      id: home.id, date: "2026-10-18", startTime: "18:00",
      durationMinutes: 120, hostEntryId: null,
    });

    const [updated] = (await listFixtures(context, competitionId)).filter((f) => f.id === home.id);
    expect(updated.calendar_event_id).not.toBeNull();

    const { data: event } = await db
      .from("calendar_events").select("*").eq("id", updated.calendar_event_id!).single();

    expect(event!.type).toBe("MATCH");
    expect(event!.is_home).toBe(true);
    expect(event!.gym_id).toBe(gymId);
    expect(event!.opponent).toBe(home.opponent!.clubName);
    expect(event!.competition).toBe("Under 19 Eccellenza");
    // The competition's own buffers, so the hall is held for setup and
    // pack-down rather than only for the ninety minutes of basketball.
    expect(event!.buffer_before_minutes).toBe(90);
    expect(event!.buffer_after_minutes).toBe(60);

    // Linked to the team, which is what makes it block that team's training.
    const { data: links } = await db
      .from("calendar_event_teams").select("team_id").eq("event_id", event!.id);
    expect(links!.map((l) => l.team_id)).toEqual([teamId]);
  }, 60_000);

  it("holds no hall for an away fixture, but still records it", async () => {
    const away = (await listFixtures(context, competitionId)).find((f) => f.isHome === false)!;

    await scheduleFixture(context, {
      id: away.id, date: "2026-10-25", startTime: "17:00",
      durationMinutes: 120, hostEntryId: null,
    });

    const updated = (await listFixtures(context, competitionId)).find((f) => f.id === away.id)!;
    const { data: event } = await db
      .from("calendar_events").select("*").eq("id", updated.calendar_event_id!).single();

    expect(event!.is_home).toBe(false);
    expect(event!.gym_id).toBeNull();
    // None of our halls is held, but the squad is on a coach all the same.
    expect(event!.buffer_before_minutes).toBe(0);
    expect(event!.location).not.toBeNull();
  }, 60_000);

  it("takes a fixture off the calendar when its date is cleared", async () => {
    const dated = (await listFixtures(context, competitionId)).find(
      (f) => f.calendar_event_id !== null,
    )!;
    const eventId = dated.calendar_event_id!;

    await scheduleFixture(context, {
      id: dated.id, date: null, startTime: null, durationMinutes: 120, hostEntryId: null,
    });

    const cleared = (await listFixtures(context, competitionId)).find((f) => f.id === dated.id)!;
    expect(cleared.calendar_event_id).toBeNull();
    expect(cleared.starts_at).toBeNull();

    const { data: event } = await db
      .from("calendar_events").select("id").eq("id", eventId).maybeSingle();
    expect(event).toBeNull();
  }, 60_000);
});
