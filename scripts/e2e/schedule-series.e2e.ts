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
import {
  getTeamTrainingWeek,
  getVersionWeek,
  listCalendarItems,
} from "@/server/services/calendar-service";
import {
  buildScheduleInput,
  generateAndStore,
} from "@/server/services/schedule-generation-service";
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
let versionId = "";
const teamIds: string[] = [];
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
      // U16 outranks U18, so a contested slot goes to U16.
      priority: name === "U16" ? 1 : 5,
      earliest_start: "17:00",
      latest_end: "22:00",
    });
    teams.push(team);
    teamIds.push(team.id);
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

  ({ versionId } = await generateAndStore(context, { seasonId: season.id }));

  // The team week reads the published schedule, which is what a club sees.
  // Published through the service-role entry point because this process holds
  // no session for auth.uid() to find.
  const { error: publishError } = await db.rpc("internal_publish_schedule_version", {
    p_version_id: versionId,
    p_user_id: userId,
  });
  if (publishError) throw new Error(`publish: ${publishError.message}`);

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

describe("a team's training week", () => {
  it("lands on the week of the team's next session", async () => {
    const week = await getTeamTrainingWeek(context, teamIds[0]);

    expect(week.days).toHaveLength(7);
    // Weeks start on the club's configured first day.
    expect(new Date(`${week.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(week.scheduledCount).toBeGreaterThan(0);

    // Every session shown belongs to this team and to the week shown.
    const shown = week.days.flatMap((day) => day.items);
    expect(shown.every((item) => item.teamId === teamIds[0])).toBe(true);
    for (const day of week.days) {
      expect(day.items.every((item) => item.startAt.slice(0, 10) === day.date)).toBe(true);
    }
  });

  it("shows the requested week when one is given, and counts only live sessions", async () => {
    const anchor = await getTeamTrainingWeek(context, teamIds[0]);
    const next = await getTeamTrainingWeek(context, teamIds[0], anchor.nextWeek);
    expect(next.weekStart).toBe(anchor.nextWeek);

    const session = next.days.flatMap((day) => day.items)[0];
    expect(session).toBeDefined();

    await db
      .from("schedule_entries")
      .update({ status: "CANCELLED" })
      .eq("id", session.id);

    const after = await getTeamTrainingWeek(context, teamIds[0], anchor.nextWeek);
    // Still visible — a cancelled session must not silently disappear — but
    // no longer counted as training that is going ahead.
    expect(after.days.flatMap((day) => day.items).some((item) => item.id === session.id)).toBe(true);
    expect(after.scheduledCount).toBe(next.scheduledCount - 1);
  });
});

describe("previewing a draft", () => {
  it("shows a draft's sessions that the calendar deliberately hides", async () => {
    // A second generation, left unpublished — exactly the state the organizer's
    // "view in calendar" used to open an empty week for.
    const { versionId: draftId } = await generateAndStore(context, {
      seasonId: (await db.from("seasons").select("id").eq("tenant_id", tenantId).single()).data!.id,
    });

    const week = await getVersionWeek(context, draftId);
    const sessions = week.days.flatMap((day) => day.items);
    expect(sessions.length).toBeGreaterThan(0);

    // The club's calendar still shows only the published schedule, so none of
    // the draft's sessions leak into it.
    const onCalendar = await listCalendarItems(context, week.weekStart, week.weekEnd);
    const draftIds = new Set(sessions.map((session) => session.id));
    expect(onCalendar.some((item) => draftIds.has(item.id))).toBe(false);

    // Stepping a week returns the week asked for.
    const next = await getVersionWeek(context, draftId, week.nextWeek);
    expect(next.weekStart).toBe(week.nextWeek);
  });
});

describe("booking priority", () => {
  it("reaches the engine from the team's saved requirements", async () => {
    const { data: season } = await db
      .from("seasons").select("id").eq("tenant_id", tenantId).single();
    const { input } = await buildScheduleInput(context, { seasonId: season!.id });

    const priorities = Object.fromEntries(input.teams.map((team) => [team.name, team.priority]));
    expect(priorities).toEqual({ U16: 1, U18: 5 });

    // And it survives an edit rather than being read once at creation.
    await db
      .from("team_training_requirements")
      .update({ priority: 2 })
      .eq("tenant_id", tenantId)
      .eq("team_id", teamIds[1]);

    const reloaded = await buildScheduleInput(context, { seasonId: season!.id });
    expect(reloaded.input.teams.find((team) => team.name === "U18")?.priority).toBe(2);
  });
});

describe("a team's first training date", () => {
  it("delays that team only, and leaves the rest of the season intact", async () => {
    const { data: season } = await db
      .from("seasons").select("id").eq("tenant_id", tenantId).single();

    // U18 comes back three weeks after everyone else.
    const LATE_START = "2026-09-28";
    await db
      .from("team_training_requirements")
      .update({ starts_on: LATE_START })
      .eq("tenant_id", tenantId)
      .eq("team_id", teamIds[1]);

    const { versionId: delayed } = await generateAndStore(context, { seasonId: season!.id });

    const { data: entries } = await db
      .from("schedule_entries")
      .select("team_id, start_at")
      .eq("schedule_version_id", delayed)
      .order("start_at");

    const dates = (teamId: string) =>
      (entries ?? []).filter((row) => row.team_id === teamId).map((row) => row.start_at.slice(0, 10));

    const late = dates(teamIds[1]);
    const others = dates(teamIds[0]);

    expect(late.length).toBeGreaterThan(0);
    expect(late.every((date) => date >= LATE_START)).toBe(true);

    // The delay is the team's own: everyone else still starts at the top.
    expect(others.some((date) => date < LATE_START)).toBe(true);

    // And the season still runs to the end for the delayed team — this trims
    // the front of the series, it does not shorten it to a single week.
    expect(late.at(-1)! > "2026-11-25").toBe(true);
  });
});
