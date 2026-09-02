import "server-only";

import { ConflictError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import {
  resolveAvailability,
  toMinutes,
  type IsoWeekday,
  type AvailabilityException,
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
import { randomUUID } from "node:crypto";

import {
  addDays,
  isoWeekdayOfDate,
  toInstant,
  todayInZone,
  toWallClock,
} from "@/domain/scheduling/timezone";
import type { Database, ValidationState } from "@/types/database";
import { getSeason } from "@/server/services/season-service";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { occurrenceDates, overlaps } from "@/domain/scheduling/occurrences";
import { log } from "@/lib/observability";

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

type AvailabilityDomain = "gym" | "trainer" | "team";

/**
 * Raw recurring windows and exceptions, keyed `domain:ownerId`.
 *
 * Kept unresolved on purpose: resolution depends on the date being asked
 * about, and occurrences span the whole season.
 */
type RawAvailability = Map<
  string,
  {
    windows: Awaited<ReturnType<typeof listAvailability>>;
    exceptions: AvailabilityException[];
  }
>;

/** Loads everything the engine needs, resolved to plain windows. */
export async function buildScheduleInput(
  context: AuthContext,
  options: GenerationOptions,
): Promise<{
  input: ScheduleInput;
  teamNames: Map<string, string>;
  weekStart: string;
  rawAvailability: RawAvailability;
  teamStartDates: Map<string, string | null>;
}> {
  assertPermission(context, "schedule.generate");

  const season = await getSeason(context, options.seasonId);
  const tenantId = context.tenant.id;

  /*
    The pattern is generated for one representative week.

    Anchoring purely on the season start looks right and is not: a club whose
    season began in August but who entered its opening hours in September gets
    a week in which none of that availability is yet in force, so the engine
    sees an empty club and reports that no hours are set. Scheduling is forward
    work — anchor on the later of the season start and today, clamped inside
    the season so a finished season still resolves to a week within it.
  */
  const today = todayInZone(context.tenant.timezone);
  const weekStart =
    options.appliesFrom ??
    (today > season.end_date
      ? season.start_date
      : today > season.start_date
        ? today
        : season.start_date);

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

  /*
    The engine plans one representative week, but every occurrence of a slot is
    materialised across the season and each one has to be checked against the
    availability actually in force on *that* date — a hall whose hours end in
    December must not be booked in January. Caching the raw windows here means
    that second pass costs no further queries.
  */
  const rawAvailability: RawAvailability = new Map();

  const loadRaw = async (domain: AvailabilityDomain, ownerId: string) => {
    const key = `${domain}:${ownerId}`;
    const cached = rawAvailability.get(key);
    if (cached) return cached;

    const [windows, exceptions] = await Promise.all([
      listAvailability(context, domain, ownerId),
      listExceptions(context, domain, ownerId),
    ]);
    const value = {
      windows,
      exceptions: exceptions.map((exception) => ({
        date: exception.exceptionDate,
        startTime: exception.startTime,
        endTime: exception.endTime,
        type: exception.type,
      })),
    };
    rawAvailability.set(key, value);
    return value;
  };

  const resolveFor = async (
    domain: AvailabilityDomain,
    ownerId: string,
  ): Promise<Record<number, MinuteWindow[]>> => {
    const { windows, exceptions } = await loadRaw(domain, ownerId);

    const byWeekday: Record<number, MinuteWindow[]> = {};
    for (const date of weekDates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const iso = (weekday === 0 ? 7 : weekday) as IsoWeekday;
      const resolved = resolveAvailability(date, iso, windows, exceptions);
      if (resolved.length > 0) byWeekday[iso] = resolved;
    }
    return byWeekday;
  };

  const engineGyms: EngineGym[] = await Promise.all(
    gyms.map(async (gym) => ({
      id: gym.id,
      name: gym.name,
      availability: await resolveFor("gym", gym.id),
      // Distinguishes "no hours entered" from "hours entered but not in force
      // for this week" — two different problems with two different fixes.
      hasConfiguredAvailability: (await loadRaw("gym", gym.id)).windows.length > 0,
    })),
  );

  const engineTrainers: EngineTrainer[] = await Promise.all(
    trainers.map(async (trainer) => ({
      id: trainer.id,
      name: `${trainer.first_name} ${trainer.last_name}`,
      availability: await resolveFor("trainer", trainer.id),
      hasConfiguredAvailability: (await loadRaw("trainer", trainer.id)).windows.length > 0,
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
        priority: requirement?.priority ?? 3,
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
    rawAvailability,
    // Null means "start when the schedule starts", which is not the same as a
    // date and must not be flattened into one.
    teamStartDates: new Map(
      teams.map((team) => [team.id, requirements.get(team.id)?.starts_on ?? null]),
    ),
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
  const { input, weekStart, rawAvailability, teamStartDates } = await buildScheduleInput(
    context,
    options,
  );

  if (input.teams.length === 0) {
    throw new ConflictError("There are no active teams in this season to schedule.");
  }
  if (input.gyms.length === 0) {
    throw new ConflictError("Add at least one gym with availability before generating.");
  }

  const result = generateSchedule(input);

  log.info("schedule.generated", {
    tenantId: context.tenant.id,
    userId: context.user.id,
    actor: context.actorType,
    durationMs: result.stats.elapsedMs,
    teams: result.stats.teams,
    requested: result.stats.sessionsRequested,
    scheduled: result.stats.sessionsScheduled,
    candidates: result.stats.candidatesConsidered,
    unmet: result.unmet.length,
    score: result.score,
  });

  /*
    The engine produced a weekly pattern; a club trains all season. Every slot
    is expanded into one real dated session per week, and the occurrences of a
    slot share a series id — that is what makes cancelling one Tuesday
    different from cancelling Tuesdays.

    Expansion happens before the version row is written so the summary can
    report what was actually put on the calendar rather than a week's worth.
  */
  const appliesFrom = options.appliesFrom ?? weekStart;
  const appliesUntil = options.appliesUntil ?? season.end_date;
  const plan = await planOccurrences(context, {
    assignments: result.assignments,
    teams: input.teams,
    from: weekStart,
    until: appliesUntil,
    rawAvailability,
    teamStartDates,
  });

  const { data: version, error: versionError } = await context.db
    .from("schedule_versions")
    .insert({
      tenant_id: context.tenant.id,
      season_id: options.seasonId,
      name: options.name ?? null,
      status: "GENERATED",
      applies_from: appliesFrom,
      applies_until: appliesUntil,
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
        JSON.stringify({
          score: result.score,
          stats: result.stats,
          unmet: result.unmet,
          occurrences: plan.rows.length,
          series: plan.seriesCount,
          skipped: plan.skipped,
        }),
      ),
      created_by: context.user.id,
    })
    .select("id")
    .single();

  if (versionError) throw fromDatabaseError(versionError, { resource: "schedule" });

  if (plan.rows.length > 0) {
    const rows = plan.rows.map((row) => ({
      ...row,
      tenant_id: context.tenant.id,
      season_id: options.seasonId,
      schedule_version_id: version.id,
      created_by: context.user.id,
    }));

    /*
      A season is a few hundred sessions. Inserted in chunks because a single
      statement carrying every row of a long season is where request size
      limits start to bite, and a half-written schedule is worse than a slow one.
    */
    for (let index = 0; index < rows.length; index += 500) {
      const { error: entriesError } = await context.db
        .from("schedule_entries")
        .insert(rows.slice(index, index + 500));

      if (entriesError) {
        throw fromDatabaseError(entriesError, {
          resource: "schedule",
          exclusionMessage:
            "The generated schedule collided with itself. This is a bug — please report it.",
        });
      }
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
      occurrences: plan.rows.length,
    },
  });

  return { versionId: version.id, result };
}


/**
 * Expands the weekly pattern into dated sessions, one series per slot.
 *
 * Two things can stop an individual week from happening, and both are checked
 * per date rather than assumed from the representative week:
 *
 *  - the hours in force changed (a hall's season ends, a coach's window has a
 *    validity range, an exception closes that day), and
 *  - something already occupies the slot that week — a match, a hall closure,
 *    a public holiday.
 *
 * A week that fails either check is skipped and reported, never silently
 * dropped: "26 Dec skipped, Winter closure" is the answer to the question a
 * coach will actually ask.
 */
async function planOccurrences(
  context: AuthContext,
  args: {
    assignments: GenerationResult["assignments"];
    teams: ScheduleInput["teams"];
    from: string;
    until: string;
    rawAvailability: RawAvailability;
    teamStartDates: Map<string, string | null>;
  },
): Promise<{
  rows: Omit<
    Database["public"]["Tables"]["schedule_entries"]["Insert"],
    "tenant_id" | "season_id" | "schedule_version_id" | "created_by"
  >[];
  seriesCount: number;
  skipped: { teamId: string; date: string; reason: string }[];
}> {
  const zone = context.tenant.timezone;
  const blocking = await collectBlockingEvents(context, args.from, args.until);
  const rows: Awaited<ReturnType<typeof planOccurrences>>["rows"] = [];
  const skipped: { teamId: string; date: string; reason: string }[] = [];

  /* Mirrors the engine exactly: a team with no hours anywhere is
     unconstrained, but one that has hours must be free on the date. */
  const constrainedTeams = new Set(
    args.teams.filter((team) => Object.keys(team.availability).length > 0).map((team) => team.id),
  );

  const covers = (key: string, date: string, window: { start: number; end: number }) => {
    const entry = args.rawAvailability.get(key);
    if (!entry) return false;
    return resolveAvailability(date, isoWeekdayOfDate(date), entry.windows, entry.exceptions).some(
      (available) => available.start <= window.start && available.end >= window.end,
    );
  };

  for (const assignment of args.assignments) {
    const seriesId = randomUUID();

    /*
      A team that starts later simply has no sessions before that date. Not a
      skip with a reason — nothing was prevented, the team was not training
      yet — so these never appear in the shortfall report.
    */
    const startsOn = args.teamStartDates.get(assignment.teamId) ?? null;
    const from = startsOn && startsOn > args.from ? startsOn : args.from;

    for (const date of occurrenceDates(from, assignment.isoWeekday, args.until)) {
      if (!covers(`gym:${assignment.gymId}`, date, assignment.window)) {
        skipped.push({ teamId: assignment.teamId, date, reason: "Gym unavailable that week" });
        continue;
      }
      if (
        assignment.trainerId &&
        !covers(`trainer:${assignment.trainerId}`, date, assignment.window)
      ) {
        skipped.push({ teamId: assignment.teamId, date, reason: "Trainer unavailable that week" });
        continue;
      }
      if (
        constrainedTeams.has(assignment.teamId) &&
        !covers(`team:${assignment.teamId}`, date, assignment.window)
      ) {
        skipped.push({ teamId: assignment.teamId, date, reason: "Team unavailable that week" });
        continue;
      }

      const startAt = toInstant(date, assignment.window.start, zone).toISOString();
      const endAt = toInstant(date, assignment.window.end, zone).toISOString();

      const clash = blocking.find(
        (event) =>
          overlaps({ start: startAt, end: endAt }, { start: event.startAt, end: event.endAt }) &&
          (event.gymId
            ? event.gymId === assignment.gymId
            : event.trainerId
              ? event.trainerId === assignment.trainerId
              : event.blocksScheduling),
      );

      if (clash) {
        skipped.push({ teamId: assignment.teamId, date, reason: clash.title });
        continue;
      }

      rows.push({
        series_id: seriesId,
        team_id: assignment.teamId,
        trainer_id: assignment.trainerId,
        gym_id: assignment.gymId,
        start_at: startAt,
        end_at: endAt,
        status: "PROPOSED",
        score: assignment.score,
        explanation: JSON.parse(JSON.stringify(assignment.explanation)),
        // Trade-offs are warnings by construction: the engine never places a
        // session that breaks a hard rule, so nothing here is ever a CONFLICT.
        validation_state: (assignment.explanation.tradeOffs.length > 0
          ? "WARNING"
          : "VALID") as ValidationState,
      });
    }
  }

  return { rows, seriesCount: args.assignments.length, skipped };
}

/** Everything already occupying time across the whole schedule window. */
async function collectBlockingEvents(
  context: AuthContext,
  from: string,
  until: string,
): Promise<
  {
    startAt: string;
    endAt: string;
    gymId: string | null;
    trainerId: string | null;
    blocksScheduling: boolean;
    title: string;
  }[]
> {
  const zone = context.tenant.timezone;

  const { data } = await context.db
    .from("calendar_events")
    .select("title, gym_id, trainer_id, start_at, end_at, blocks_scheduling")
    .eq("tenant_id", context.tenant.id)
    .neq("status", "CANCELLED")
    .lt("start_at", toInstant(addDays(until, 1), 0, zone).toISOString())
    .gt("end_at", toInstant(from, 0, zone).toISOString());

  return (data ?? [])
    .filter((event) => event.blocks_scheduling || event.gym_id || event.trainer_id)
    .map((event) => ({
      startAt: event.start_at,
      endAt: event.end_at,
      gymId: event.gym_id,
      trainerId: event.trainer_id,
      blocksScheduling: event.blocks_scheduling,
      title: event.title,
    }));
}
