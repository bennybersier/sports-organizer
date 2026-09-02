/**
 * Generation and series removal, through the real service code.
 *
 * Builds a throwaway club with a three-month season, generates, and checks the
 * things a club would notice: that training fills the season rather than a
 * single week, that a hall closure takes out only the week it falls in, and
 * that cancelling an event stops that slot alone — not the other team's, not
 * the other weekday's, and not the weeks already trained.
 *
 * Runs against whatever .env.local points at, and removes everything it made.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Permission } from "@/domain/permissions";
import type { AuthContext } from "@/server/auth/context";
import { generateAndStore } from "@/server/services/schedule-generation-service";
import {
  cancelScheduleSeries,
  restoreScheduleSeries,
} from "@/server/services/schedule-publish-service";

const db = createAdminClient();

const SEASON_START = "2026-09-07";
const SEASON_END = "2026-12-06";
/** Falls in the third week, and takes the hall out for the evening. */
const CLOSURE_DATE = "2026-09-21";

interface Row {
  id: string;
  series_id: string;
  team_id: string;
  start_at: string;
  status: string;
}

let tenantId = "";
let userId = "";
let context: AuthContext;
let rows: Row[] = [];
let bySeries: Row[][] = [];
let dates: string[] = [];

const insert = async <T,>(table: string, row: object): Promise<T> => {
  const { data, error } = await db.from(table as never).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
};

beforeAll(async () => {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const tenant = await insert<{ id: string }>("tenants", {
    name: "ZZ Series",
    slug: `zz-series-${stamp}`,
    timezone: "Europe/Rome",
  });
  tenantId = tenant.id;

  const { data: authUser } = await db.auth.admin.createUser({
    email: `zz-series-${stamp}@example.test`,
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

  await insert("tenant_memberships", {
    tenant_id: tenantId,
    user_id: userId,
    role_id: role!.id,
  });

  const season = await insert<{ id: string }>("seasons", {
    tenant_id: tenantId,
    name: "2026/2027",
    start_date: SEASON_START,
    end_date: SEASON_END,
    status: "ACTIVE",
  });
  const gym = await insert<{ id: string }>("gyms", { tenant_id: tenantId, name: "Hall" });
  const trainer = await insert<{ id: string }>("trainers", {
    tenant_id: tenantId,
    first_name: "Ada",
    last_name: "Coach",
  });

  const teams = [];
  for (const name of ["U16", "U18"]) {
    const team = await insert<{ id: string }>("teams", {
      tenant_id: tenantId,
      season_id: season.id,
      name,
      sport: "Volleyball",
    });
    await insert("trainer_teams", {
      tenant_id: tenantId,
      trainer_id: trainer.id,
      team_id: team.id,
    });
    await insert("team_training_requirements", {
      tenant_id: tenantId,
      season_id: season.id,
      team_id: team.id,
      sessions_per_week: 1,
      duration_minutes: 90,
      earliest_start: "17:00",
      latest_end: "22:00",
    });
    teams.push(team);
  }

  // Hall and coach free Monday and Wednesday evenings, all season long.
  for (const weekday of [1, 3]) {
    await insert("gym_availability", {
      tenant_id: tenantId,
      gym_id: gym.id,
      iso_weekday: weekday,
      start_time: "17:00",
      end_time: "22:00",
      valid_from: "2026-09-01",
    });
    await insert("trainer_availability", {
      tenant_id: tenantId,
      trainer_id: trainer.id,
      iso_weekday: weekday,
      start_time: "17:00",
      end_time: "22:00",
      valid_from: "2026-09-01",
    });
  }

  await insert("calendar_events", {
    tenant_id: tenantId,
    type: "BLACKOUT",
    title: "Hall closed",
    start_at: `${CLOSURE_DATE}T15:00:00Z`,
    end_at: `${CLOSURE_DATE}T21:00:00Z`,
    gym_id: gym.id,
    blocks_scheduling: true,
  });

  const { data: permissionRows } = await db.from("permissions").select("key");

  context = {
    user: {
      id: userId,
      email: `zz-series-${stamp}@example.test`,
      fullName: null,
      avatarUrl: null,
      locale: "en",
      timezone: "Europe/Rome",
    },
    tenant: {
      id: tenantId,
      name: "ZZ Series",
      slug: `zz-series-${stamp}`,
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

  const { versionId } = await generateAndStore(context, { seasonId: season.id });

  const { data: entries } = await db
    .from("schedule_entries")
    .select("id, series_id, team_id, start_at, status")
    .eq("schedule_version_id", versionId)
    .order("start_at");

  rows = (entries ?? []) as Row[];
  dates = [...new Set(rows.map((row) => row.start_at.slice(0, 10)))].sort();

  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.series_id, [...(grouped.get(row.series_id) ?? []), row]);
  bySeries = [...grouped.values()].sort((a, b) => b.length - a.length);
});

afterAll(async () => {
  if (tenantId) await db.from("tenants").delete().eq("id", tenantId);
  if (userId) await db.auth.admin.deleteUser(userId);
});

describe("generating a season", () => {
  it("fills the whole season, not a single week", () => {
    expect(dates.length).toBeGreaterThan(8);
    // Lexical comparison is date comparison for ISO dates.
    expect(dates.at(-1)! > "2026-11-25").toBe(true);
  });

  it("schedules both teams", () => {
    expect(new Set(rows.map((row) => row.team_id)).size).toBe(2);
  });

  it("groups each recurring slot into one series", () => {
    expect(bySeries.length).toBe(2);
    expect(rows.length).toBeGreaterThan(10);
  });

  it("keeps a series on one weekday at one time", () => {
    for (const series of bySeries) {
      const weekdays = new Set(series.map((row) => new Date(row.start_at).getUTCDay()));
      expect(weekdays.size).toBe(1);
    }
  });

  it("skips the week the hall is closed, and only that week", () => {
    expect(dates).not.toContain(CLOSURE_DATE);
    expect(dates).toContain("2026-09-14");
    expect(dates).toContain("2026-09-28");
  });
});

describe("cancelling an event", () => {
  it("stops this occurrence and every later one, and can be undone", async () => {
    const target = bySeries[0];
    const other = bySeries[1];
    const third = target[2];

    const cancelled = await cancelScheduleSeries(context, third.id, "Coach on sabbatical");
    expect(cancelled).toBe(target.length - 2);

    const statuses = async (ids: string[]) =>
      ((await db.from("schedule_entries").select("id, status").in("id", ids)).data ?? []).map(
        (row) => row.status,
      );

    // The weeks already trained are history, not something to rewrite.
    expect(await statuses(target.slice(0, 2).map((row) => row.id))).not.toContain("CANCELLED");
    // And the other team's Wednesday is none of this event's business.
    expect(await statuses(other.map((row) => row.id))).not.toContain("CANCELLED");

    expect(await restoreScheduleSeries(context, third.id)).toBe(cancelled);
  });
});
