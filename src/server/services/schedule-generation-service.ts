import "server-only";

import { ConflictError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import {
  resolveAvailability,
  toMinutes,
  type IsoWeekday,
  type MinuteWindow,
} from "@/domain/availability";
import { generateSchedule } from "@/domain/scheduling/optimizer";
import {
  DEFAULT_WEIGHTS,
  type BlockedSlot,
  type EngineGym,
  type EngineTeam,
  type EngineTrainer,
  type GenerationResult,
  type ScheduleInput,
} from "@/domain/scheduling/types";
import { addDays, toInstant, toWallClock } from "@/domain/scheduling/timezone";
import type { ValidationState } from "@/types/database";
import { getSeason } from "@/server/services/season-service";

/**
 * Turns the club's stored configuration into engine input, runs the optimizer,
 * and writes the result as a new draft version.
 *
 * The engine itself knows nothing about any of this: it takes plain data and
 * returns plain data. This module is the only place the two worlds meet, which
 * is what keeps the optimizer testable and what will let a better algorithm
 * replace it without touching persistence.
 */

export interface GenerationOptions {
  seasonId: string;
  /** Restrict to a subset; empty means every active team in the season. */
  teamIds?: string[];
  gymIds?: string[];
  /** The week the pattern is written into. Defaults to the season start. */
  appliesFrom?: string;
  appliesUntil?: string;
  weights?: Partial<typeof DEFAULT_WEIGHTS>;
  name?: string;
}

/** Loads everything the engine needs, resolved to plain windows. */
export async function buildScheduleInput(
  context: AuthContext,
  options: GenerationOptions,
): Promise<{ input: ScheduleInput; teamNames: Map<string, string>; weekStart: string }> {
  assertPermission(context, "schedule.generate");

  const season = await getSeason(context, options.seasonId);
  const tenantId = context.tenant.id;

  // The pattern is generated for one representative week and then repeated by
  // the caller. Anchor on the season start so weekdays line up.
  const weekStart = options.appliesFrom ?? season.start_date;

  const [teamsResult, trainersResult, gymsResult, requirementsResult, assignmentsResult] =
    await Promise.all([
      context.db
        .from("teams")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("season_id", options.seasonId)
        .eq("status", "ACTIVE")
        .is("deleted_at", null),
      context.db
        .from("trainers")
        .select("id, first_name, last_name")
        .eq("tenant_id", tenantId)
        .eq("status", "ACTIVE")
        .is("deleted_at", null),
      context.db
        .from("gyms")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("status", "ACTIVE")
        .is("deleted_at", null),
      context.db
        .from("team_training_requirements")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("season_id", options.seasonId),
      context.db
        .from("trainer_teams")
        .select("trainer_id, team_id")
        .eq("tenant_id", tenantId)
        .is("unassigned_at", null),
    ]);

  let teams = teamsResult.data ?? [];
  let gyms = gymsResult.data ?? [];
  if (options.teamIds?.length) teams = teams.filter((t) => options.teamIds!.includes(t.id));
  if (options.gymIds?.length) gyms = gyms.filter((g) => options.gymIds!.includes(g.id));

  const trainers = trainersResult.data ?? [];
  const requirements = new Map((requirementsResult.data ?? []).map((r) => [r.team_id, r]));
  const coaching = assignmentsResult.data ?? [];

  // Availability is resolved per weekday for the representative week, so
  // exceptions falling in that week are honoured exactly as the calendar shows.
  const weekDates = Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset));

  const resolveFor = async (
    domain: "gym" | "trainer" | "team",
    ownerId: string,
  ): Promise<Record<number, MinuteWindow[]>> => {
    const [{ listAvailability }, { listExceptions }] = [
      await import("@/server/services/availability-service"),
      await import("@/server/services/availability-service"),
    ];
    const [windows, exceptions] = await Promise.all([
      listAvailability(context, domain, ownerId),
      listExceptions(context, domain, ownerId),
    ]);

    const byWeekday: Record<number, MinuteWindow[]> = {};
    for (const date of weekDates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const iso = (weekday === 0 ? 7 : weekday) as IsoWeekday;
      const resolved = resolveAvailability(
        date,
        iso,
        windows,
        exceptions.map((exception) => ({
          date: exception.exceptionDate,
          startTime: exception.startTime,
          endTime: exception.endTime,
          type: exception.type,
        })),
      );
      if (resolved.length > 0) byWeekday[iso] = resolved;
    }
    return byWeekday;
  };

  const engineGyms: EngineGym[] = await Promise.all(
    gyms.map(async (gym) => ({
      id: gym.id,
      name: gym.name,
      availability: await resolveFor("gym", gym.id),
    })),
  );

  const engineTrainers: EngineTrainer[] = await Promise.all(
    trainers.map(async (trainer) => ({
      id: trainer.id,
      name: `${trainer.first_name} ${trainer.last_name}`,
      availability: await resolveFor("trainer", trainer.id),
      teamIds: coaching.filter((c) => c.trainer_id === trainer.id).map((c) => c.team_id),
    })),
  );

  const engineTeams: EngineTeam[] = await Promise.all(
    teams.map(async (team) => {
      const requirement = requirements.get(team.id);
      return {
        id: team.id,
        name: team.name,
        availability: await resolveFor("team", team.id),
        sessionsPerWeek: requirement?.sessions_per_week ?? 2,
        durationMinutes: requirement?.duration_minutes ?? 90,
        allowedWeekdays: requirement?.allowed_weekdays ?? [],
        earliestStart: toMinutes(requirement?.earliest_start ?? "16:30"),
        latestEnd: toMinutes(requirement?.latest_end ?? "22:00"),
        minDaysBetween: requirement?.min_days_between ?? 1,
        maxDaysBetween: requirement?.max_days_between ?? null,
        allowedGymIds: requirement?.allowed_gym_ids ?? [],
        preferredWeekdays: requirement?.preferred_weekdays ?? [],
        preferredStart: requirement?.preferred_start ? toMinutes(requirement.preferred_start) : null,
        preferredEnd: requirement?.preferred_end ? toMinutes(requirement.preferred_end) : null,
        preferredGymIds: requirement?.preferred_gym_ids ?? [],
      };
    }),
  );

  const blockedSlots = await collectBlockedSlots(context, weekStart, weekDates);

  return {
    input: {
      teams: engineTeams,
      trainers: engineTrainers,
      gyms: engineGyms,
      blockedSlots,
      weights: { ...DEFAULT_WEIGHTS, ...options.weights },
    },
    teamNames: new Map(teams.map((team) => [team.id, team.name])),
    weekStart,
  };
}

/**
 * Events that take time off the table: holidays, hall closures, matches.
 * Only events flagged `blocks_scheduling`, plus anything occupying a gym.
 */
async function collectBlockedSlots(
  context: AuthContext,
  weekStart: string,
  weekDates: string[],
): Promise<BlockedSlot[]> {
  const zone = context.tenant.timezone;
  const rangeStart = toInstant(weekStart, 0, zone).toISOString();
  const rangeEnd = toInstant(addDays(weekStart, 7), 0, zone).toISOString();

  const { data } = await context.db
    .from("calendar_events")
    .select("id, title, gym_id, trainer_id, start_at, end_at, blocks_scheduling")
    .eq("tenant_id", context.tenant.id)
    .neq("status", "CANCELLED")
    .lt("start_at", rangeEnd)
    .gt("end_at", rangeStart);

  const blocked: BlockedSlot[] = [];

  for (const event of data ?? []) {
    // An event with no gym and no trainer blocks nothing in particular unless
    // it is explicitly a club-wide closure.
    if (!event.blocks_scheduling && !event.gym_id && !event.trainer_id) continue;

    const start = toWallClock(event.start_at, zone);
    const end = toWallClock(event.end_at, zone);
    if (!weekDates.includes(start.date)) continue;

    blocked.push({
      isoWeekday: start.isoWeekday as IsoWeekday,
      window: {
        start: start.minutes,
        end: end.date === start.date ? end.minutes : 1440,
      },
      gymId: event.gym_id,
      trainerId: event.trainer_id,
      teamId: null,
      reason: event.title,
    });
  }

  return blocked;
}

/**
 * Generates a schedule and stores it as a new DRAFT version.
 *
 * Never touches the published schedule — that is the whole point of versions.
 * The generation config is stored alongside so a run can be reproduced or
 * explained months later.
 */
export async function generateAndStore(
  context: AuthContext,
  options: GenerationOptions,
): Promise<{ versionId: string; result: GenerationResult }> {
  assertPermission(context, "schedule.generate");

  const season = await getSeason(context, options.seasonId);
  const { input, weekStart } = await buildScheduleInput(context, options);

  if (input.teams.length === 0) {
    throw new ConflictError("There are no active teams in this season to schedule.");
  }
  if (input.gyms.length === 0) {
    throw new ConflictError("Add at least one gym with availability before generating.");
  }

  const result = generateSchedule(input);

  const { data: version, error: versionError } = await context.db
    .from("schedule_versions")
    .insert({
      tenant_id: context.tenant.id,
      season_id: options.seasonId,
      name: options.name ?? null,
      status: "GENERATED",
      applies_from: options.appliesFrom ?? season.start_date,
      applies_until: options.appliesUntil ?? season.end_date,
      generated_at: new Date().toISOString(),
      generation_config: JSON.parse(
        JSON.stringify({
          weights: input.weights,
          teamIds: options.teamIds ?? null,
          gymIds: options.gymIds ?? null,
          weekStart,
        }),
      ),
      result_summary: JSON.parse(
        JSON.stringify({ score: result.score, stats: result.stats, unmet: result.unmet }),
      ),
      created_by: context.user.id,
    })
    .select("id")
    .single();

  if (versionError) throw fromDatabaseError(versionError, { resource: "schedule" });

  if (result.assignments.length > 0) {
    const zone = context.tenant.timezone;

    const rows = result.assignments.map((assignment) => {
      // The engine works in weekdays; the calendar needs real instants. Convert
      // once, here, anchored on the representative week.
      const offset = (assignment.isoWeekday - isoWeekdayOfDate(weekStart) + 7) % 7;
      const date = addDays(weekStart, offset);

      return {
        tenant_id: context.tenant.id,
        season_id: options.seasonId,
        schedule_version_id: version.id,
        team_id: assignment.teamId,
        trainer_id: assignment.trainerId,
        gym_id: assignment.gymId,
        start_at: toInstant(date, assignment.window.start, zone).toISOString(),
        end_at: toInstant(date, assignment.window.end, zone).toISOString(),
        status: "PROPOSED" as const,
        score: assignment.score,
        explanation: JSON.parse(JSON.stringify(assignment.explanation)),
        // Trade-offs are warnings by construction: the engine never places a
        // session that breaks a hard rule, so nothing here is ever a CONFLICT.
        validation_state: (assignment.explanation.tradeOffs.length > 0
          ? "WARNING"
          : "VALID") as ValidationState,
        created_by: context.user.id,
      };
    });

    const { error: entriesError } = await context.db.from("schedule_entries").insert(rows);
    if (entriesError) {
      throw fromDatabaseError(entriesError, {
        resource: "schedule",
        exclusionMessage:
          "The generated schedule collided with itself. This is a bug — please report it.",
      });
    }
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_GENERATED,
    resourceType: "schedule_version",
    resourceId: version.id,
    newValue: {
      season: season.name,
      score: result.score,
      scheduled: result.stats.sessionsScheduled,
      requested: result.stats.sessionsRequested,
      unmet: result.unmet.length,
    },
  });

  return { versionId: version.id, result };
}

function isoWeekdayOfDate(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
