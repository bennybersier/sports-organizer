/**
 * Editing what a record is linked to, through the real service code.
 *
 * These write join tables, and the thing worth pinning is what happens on
 * removal: a coach who took the side until March took it until March, and a
 * schedule published in that time still names them. So a removal ends the
 * assignment and leaves the row, and a page that lists "current" must not show
 * it any more.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Permission } from "@/domain/permissions";
import type { AuthContext } from "@/server/auth/context";
import { setTeamAthletes, setTeamTrainers } from "@/server/services/team-service";
import { setAthleteTeams } from "@/server/services/athlete-service";
import { setTrainerTeams } from "@/server/services/trainer-service";

const db = createAdminClient();

let tenantId = "";
let userId = "";
let context: AuthContext;
const team: Record<string, string> = {};
const coach: Record<string, string> = {};
const player: Record<string, string> = {};

const insert = async <T,>(table: string, row: object): Promise<T> => {
  const { data, error } = await db.from(table as never).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
};

beforeAll(async () => {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await insert<{ id: string }>("tenants", {
    name: "ZZ Relations", slug: `zz-rel-${stamp}`, timezone: "Europe/Rome",
  });
  tenantId = tenant.id;

  const { data: authUser } = await db.auth.admin.createUser({
    email: `zz-rel-${stamp}@example.test`, password: `zz-${stamp}-Aa1!`, email_confirm: true,
  });
  userId = authUser.user!.id;

  const { data: role } = await db
    .from("roles").select("id, key, name, rank").eq("key", "OWNER").is("tenant_id", null).single();
  await insert("tenant_memberships", { tenant_id: tenantId, user_id: userId, role_id: role!.id });

  const season = await insert<{ id: string }>("seasons", {
    tenant_id: tenantId, name: "2026/2027",
    start_date: "2026-09-01", end_date: "2027-06-30", status: "ACTIVE",
  });

  for (const name of ["U15", "U17"]) {
    const row = await insert<{ id: string }>("teams", {
      tenant_id: tenantId, season_id: season.id, name, sport: "Basketball",
    });
    team[name] = row.id;
  }
  for (const name of ["Ada", "Bo"]) {
    const row = await insert<{ id: string }>("trainers", {
      tenant_id: tenantId, first_name: name, last_name: "Coach",
    });
    coach[name] = row.id;
  }
  for (const name of ["Cai", "Dee"]) {
    const row = await insert<{ id: string }>("athletes", {
      tenant_id: tenantId, first_name: name, last_name: "Player",
    });
    player[name] = row.id;
  }

  const { data: permissionRows } = await db.from("permissions").select("key");
  context = {
    user: { id: userId, email: "", fullName: null, avatarUrl: null, locale: "en", timezone: "Europe/Rome" },
    tenant: { id: tenantId, name: "ZZ Relations", slug: `zz-rel-${stamp}`, timezone: "Europe/Rome", locale: "en", weekStart: 1 },
    role: { key: role!.key, name: role!.name, rank: role!.rank },
    permissions: new Set((permissionRows ?? []).map((p) => p.key as Permission)),
    actorType: "USER", isPlatformAdmin: false, isActingAsStaff: false, db,
  } as unknown as AuthContext;
}, 120_000);

afterAll(async () => {
  if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  if (userId) await db.auth.admin.deleteUser(userId);
});

const liveTrainers = async (teamId: string) => {
  const { data } = await db
    .from("trainer_teams").select("trainer_id")
    .eq("team_id", teamId).is("unassigned_at", null);
  return (data ?? []).map((row) => row.trainer_id).sort();
};

const liveSquad = async (teamId: string) => {
  const { data } = await db
    .from("athlete_teams").select("athlete_id").eq("team_id", teamId).is("left_at", null);
  return (data ?? []).map((row) => row.athlete_id).sort();
};

describe("editing relations from a detail page", () => {
  it("adds coaches to a team", async () => {
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], null);
    expect(await liveTrainers(team.U15)).toEqual([coach.Ada, coach.Bo].sort());
  }, 30_000);

  it("ends an assignment rather than deleting it", async () => {
    await setTeamTrainers(context, team.U15, [coach.Ada], null);
    expect(await liveTrainers(team.U15)).toEqual([coach.Ada]);

    // Bo is gone from the team's current list, but the record of having taken
    // it is still there — a published schedule may still name them.
    const { data } = await db
      .from("trainer_teams").select("unassigned_at")
      .eq("team_id", team.U15).eq("trainer_id", coach.Bo).single();
    expect(data!.unassigned_at).not.toBeNull();
  }, 30_000);

  it("puts a player back without duplicating the row", async () => {
    await setTeamAthletes(context, team.U15, [player.Cai]);
    await setTeamAthletes(context, team.U15, []);
    await setTeamAthletes(context, team.U15, [player.Cai]);

    expect(await liveSquad(team.U15)).toEqual([player.Cai]);
    const { data } = await db
      .from("athlete_teams").select("id").eq("team_id", team.U15).eq("athlete_id", player.Cai);
    // One live row and one ended row, not two live ones.
    expect(data!.length).toBe(2);
  }, 30_000);

  it("writes the same join from the athlete's side", async () => {
    await setAthleteTeams(context, player.Dee, [team.U15, team.U17]);
    expect(await liveSquad(team.U17)).toEqual([player.Dee]);
    expect((await liveSquad(team.U15)).includes(player.Dee)).toBe(true);
  }, 30_000);

  it("refuses to leave a coach with no team", async () => {
    /*
      Not bureaucracy: the scheduler can only offer a coach to a team they are
      assigned to, so a coach with none quietly stops being schedulable and
      nothing says why.
    */
    await expect(setTrainerTeams(context, coach.Ada, [])).rejects.toThrow();
    expect((await liveTrainers(team.U15)).includes(coach.Ada)).toBe(true);
  }, 30_000);

  it("moves a coach between teams from their own page", async () => {
    await setTrainerTeams(context, coach.Bo, [team.U17]);
    expect(await liveTrainers(team.U17)).toEqual([coach.Bo]);
    expect((await liveTrainers(team.U15)).includes(coach.Bo)).toBe(false);
  }, 30_000);
});

describe("a team's head coach", () => {
  const headOf = async (teamId: string) => {
    const { data } = await db
      .from("trainer_teams")
      .select("trainer_id")
      .eq("team_id", teamId)
      .is("unassigned_at", null)
      .eq("is_head_coach", true)
      .maybeSingle();
    return data?.trainer_id ?? null;
  };

  it("names one of the staff as head, and the rest are assistants", async () => {
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], coach.Ada);

    expect(await headOf(team.U15)).toBe(coach.Ada);
    expect(await liveTrainers(team.U15)).toEqual([coach.Ada, coach.Bo].sort());
  }, 30_000);

  it("hands the role over without ever having two heads at once", async () => {
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], coach.Ada);

    // `trainer_teams_one_head_coach` permits exactly one, so this only works if
    // the incumbent is demoted before the successor is promoted.
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], coach.Bo);

    expect(await headOf(team.U15)).toBe(coach.Bo);
    const { count } = await db
      .from("trainer_teams")
      .select("*", { count: "exact", head: true })
      .eq("team_id", team.U15)
      .is("unassigned_at", null)
      .eq("is_head_coach", true);
    expect(count).toBe(1);
  }, 30_000);

  it("leaves a side headless when nobody is named", async () => {
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], coach.Ada);
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], null);

    // A group between coaches is a real state, not a validation failure.
    expect(await headOf(team.U15)).toBeNull();
  }, 30_000);

  it("drops the role when the head coach leaves the staff", async () => {
    await setTeamTrainers(context, team.U15, [coach.Ada, coach.Bo], coach.Bo);
    await setTeamTrainers(context, team.U15, [coach.Ada], null);

    expect(await liveTrainers(team.U15)).toEqual([coach.Ada]);
    expect(await headOf(team.U15)).toBeNull();
  }, 30_000);
});
