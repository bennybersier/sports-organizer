import "server-only";

import { fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { resolveAvailability, type IsoWeekday } from "@/domain/availability";
import {
  validatePlacement,
  type Booking,
  type PlacementResult,
  type PlacementRules,
} from "@/domain/scheduling/conflicts";
import {
  endOfDayInZone,
  startOfDayInZone,
  toWallClock,
} from "@/domain/scheduling/timezone";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { getTrainingRequirement } from "@/server/services/training-requirement-service";
import { toMinutes } from "@/domain/availability";

/**
 * What the calendar shows.
 *
 * Two sources, deliberately kept apart in the schema and merged only for
 * display: `schedule_entries` are the optimizer's training sessions, tied to a
 * schedule version; `calendar_events` are everything else — matches,
 * tournaments, closures, and the in-house events that may legitimately put
 * several teams in one hall.
 */
export interface CalendarItem {
  id: string;
  source: "SCHEDULE" | "EVENT";
  type: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string | null;
  status: string;
  validationState: string;
  teamId: string | null;
  teamName: string | null;
  trainerId: string | null;
  trainerName: string | null;
  gymId: string | null;
  gymName: string | null;
  /** Only the published schedule and manual events are editable in place. */
  editable: boolean;
  blocksScheduling: boolean;
  allowsGymSharing: boolean;
}

export interface CalendarFilters {
  seasonId?: string;
  teamId?: string;
  trainerId?: string;
  gymId?: string;
  type?: string;
}

/**
 * Everything on the calendar between two dates.
 *
 * The range is given as club-local dates and converted to instants once, here,
 * so every query downstream compares like with like.
 */
export async function listCalendarItems(
  context: AuthContext,
  from: string,
  to: string,
  filters: CalendarFilters = {},
): Promise<CalendarItem[]> {
  assertPermission(context, "calendar.read");

  const zone = context.tenant.timezone;
  const rangeStart = startOfDayInZone(from, zone).toISOString();
  const rangeEnd = endOfDayInZone(to, zone).toISOString();

  // The published version is what the club sees; drafts live in the organizer.
  let publishedVersionId: string | null = null;
  {
    let query = context.db
      .from("schedule_versions")
      .select("id, season_id")
      .eq("tenant_id", context.tenant.id)
      .eq("status", "PUBLISHED");
    if (filters.seasonId) query = query.eq("season_id", filters.seasonId);

    const { data } = await query.limit(1).maybeSingle();
    publishedVersionId = data?.id ?? null;
  }

  const [entries, events, lookups] = await Promise.all([
    publishedVersionId
      ? fetchScheduleEntries(context, publishedVersionId, rangeStart, rangeEnd, filters)
      : Promise.resolve([]),
    fetchCalendarEvents(context, rangeStart, rangeEnd, filters),
    fetchLookups(context),
  ]);

  const items: CalendarItem[] = [];

  for (const entry of entries) {
    const team = lookups.teams.get(entry.team_id);
    items.push({
      id: entry.id,
      source: "SCHEDULE",
      type: "TRAINING",
      title: team?.name ?? "Training",
      startAt: entry.start_at,
      endAt: entry.end_at,
      allDay: false,
      color: team?.color ?? null,
      status: entry.status,
      validationState: entry.validation_state,
      teamId: entry.team_id,
      teamName: team?.name ?? null,
      trainerId: entry.trainer_id,
      trainerName: entry.trainer_id ? (lookups.trainers.get(entry.trainer_id) ?? null) : null,
      gymId: entry.gym_id,
      gymName: lookups.gyms.get(entry.gym_id) ?? null,
      editable: true,
      blocksScheduling: false,
      allowsGymSharing: false,
    });
  }

  for (const event of events) {
    items.push({
      id: event.id,
      source: "EVENT",
      type: event.type,
      title: event.title,
      startAt: event.start_at,
      endAt: event.end_at,
      allDay: event.all_day,
      color: event.color,
      status: event.status,
      validationState: "VALID",
      teamId: null,
      teamName: null,
      trainerId: event.trainer_id,
      trainerName: event.trainer_id ? (lookups.trainers.get(event.trainer_id) ?? null) : null,
      gymId: event.gym_id,
      gymName: event.gym_id ? (lookups.gyms.get(event.gym_id) ?? null) : null,
      editable: true,
      blocksScheduling: event.blocks_scheduling,
      allowsGymSharing: event.allows_gym_sharing,
    });
  }

  return items.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

async function fetchScheduleEntries(
  context: AuthContext,
  versionId: string,
  rangeStart: string,
  rangeEnd: string,
  filters: CalendarFilters,
) {
  let query = context.db
    .from("schedule_entries")
    .select("id, team_id, trainer_id, gym_id, start_at, end_at, status, validation_state")
    .eq("tenant_id", context.tenant.id)
    .eq("schedule_version_id", versionId)
    // Overlap, not containment: a session straddling the range edge belongs on
    // the calendar too.
    .lt("start_at", rangeEnd)
    .gt("end_at", rangeStart);

  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  if (filters.trainerId) query = query.eq("trainer_id", filters.trainerId);
  if (filters.gymId) query = query.eq("gym_id", filters.gymId);
  if (filters.type && filters.type !== "TRAINING") return [];

  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, { resource: "schedule" });
  return data ?? [];
}

async function fetchCalendarEvents(
  context: AuthContext,
  rangeStart: string,
  rangeEnd: string,
  filters: CalendarFilters,
) {
  let query = context.db
    .from("calendar_events")
    .select(
      "id, type, title, start_at, end_at, all_day, color, status, gym_id, trainer_id, blocks_scheduling, allows_gym_sharing, season_id",
    )
    .eq("tenant_id", context.tenant.id)
    .lt("start_at", rangeEnd)
    .gt("end_at", rangeStart);

  if (filters.seasonId) query = query.eq("season_id", filters.seasonId);
  if (filters.gymId) query = query.eq("gym_id", filters.gymId);
  if (filters.trainerId) query = query.eq("trainer_id", filters.trainerId);
  if (filters.type) query = query.eq("type", filters.type as "MATCH");

  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, { resource: "event" });
  return data ?? [];
}

/** Names for the ids the calendar renders, fetched once per request. */
async function fetchLookups(context: AuthContext) {
  const [teams, trainers, gyms] = await Promise.all([
    context.db
      .from("teams")
      .select("id, name, color")
      .eq("tenant_id", context.tenant.id)
      .is("deleted_at", null),
    context.db
      .from("trainers")
      .select("id, first_name, last_name")
      .eq("tenant_id", context.tenant.id)
      .is("deleted_at", null),
    context.db
      .from("gyms")
      .select("id, name")
      .eq("tenant_id", context.tenant.id)
      .is("deleted_at", null),
  ]);

  return {
    teams: new Map((teams.data ?? []).map((t) => [t.id, { name: t.name, color: t.color }])),
    trainers: new Map(
      (trainers.data ?? []).map((t) => [t.id, `${t.first_name} ${t.last_name}`]),
    ),
    gyms: new Map((gyms.data ?? []).map((g) => [g.id, g.name])),
  };
}

export interface PlacementCheck {
  entryId?: string;
  teamId: string;
  trainerId: string | null;
  gymId: string;
  startAt: string;
  endAt: string;
  seasonId: string;
}

/**
 * Validates a proposed placement against everything that constrains it.
 *
 * The same function backs the drag-and-drop preview and the save path, so the
 * calendar can never show "valid" for something the save would reject.
 */
export async function checkPlacement(
  context: AuthContext,
  input: PlacementCheck,
): Promise<PlacementResult> {
  assertPermission(context, "calendar.read");

  const zone = context.tenant.timezone;
  const start = toWallClock(input.startAt, zone);
  const end = toWallClock(input.endAt, zone);

  // A session crossing midnight is not something the engine models; report it
  // as impossible rather than silently validating the wrong window.
  const endMinutes = end.date === start.date ? end.minutes : 1440;

  const [gymWindows, gymExceptions, teamWindows, teamExceptions, requirement, bookings] =
    await Promise.all([
      listAvailability(context, "gym", input.gymId),
      listExceptions(context, "gym", input.gymId),
      listAvailability(context, "team", input.teamId),
      listExceptions(context, "team", input.teamId),
      getTrainingRequirement(context, input.teamId, input.seasonId),
      collectBookings(context, input.startAt, input.endAt),
    ]);

  const [trainerWindows, trainerExceptions] = input.trainerId
    ? await Promise.all([
        listAvailability(context, "trainer", input.trainerId),
        listExceptions(context, "trainer", input.trainerId),
      ])
    : [null, null];

  const resolve = (
    windows: { isoWeekday: IsoWeekday; startTime: string; endTime: string; validFrom: string; validUntil: string | null }[],
    exceptions: { exceptionDate: string; startTime: string | null; endTime: string | null; type: "UNAVAILABLE" | "AVAILABLE_OVERRIDE" }[],
  ) =>
    resolveAvailability(
      start.date,
      start.isoWeekday as IsoWeekday,
      windows,
      exceptions.map((exception) => ({
        date: exception.exceptionDate,
        startTime: exception.startTime,
        endTime: exception.endTime,
        type: exception.type,
      })),
    );

  const rules: PlacementRules = {
    durationMinutes: requirement.durationMinutes,
    earliestStart: toMinutes(requirement.earliestStart),
    latestEnd: toMinutes(requirement.latestEnd),
    allowedWeekdays: requirement.allowedWeekdays,
    allowedGymIds: requirement.allowedGymIds,
    preferredWeekdays: requirement.preferredWeekdays,
    preferredStart: requirement.preferredStart ? toMinutes(requirement.preferredStart) : undefined,
    preferredEnd: requirement.preferredEnd ? toMinutes(requirement.preferredEnd) : undefined,
    preferredGymIds: requirement.preferredGymIds,
  };

  return validatePlacement(
    {
      id: input.entryId,
      window: { start: start.minutes, end: endMinutes },
      isoWeekday: start.isoWeekday,
      teamId: input.teamId,
      trainerId: input.trainerId,
      gymId: input.gymId,
    },
    {
      gym: resolve(gymWindows, gymExceptions),
      trainer: trainerWindows ? resolve(trainerWindows, trainerExceptions!) : null,
      team: resolve(teamWindows, teamExceptions),
    },
    bookings,
    rules,
  );
}

/** Everything already booked in the window a candidate would occupy. */
async function collectBookings(
  context: AuthContext,
  startAt: string,
  endAt: string,
): Promise<Booking[]> {
  const zone = context.tenant.timezone;

  const { data: published } = await context.db
    .from("schedule_versions")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PUBLISHED")
    .limit(1)
    .maybeSingle();

  const [entries, events, teams] = await Promise.all([
    published
      ? context.db
          .from("schedule_entries")
          .select("id, team_id, trainer_id, gym_id, start_at, end_at")
          .eq("tenant_id", context.tenant.id)
          .eq("schedule_version_id", published.id)
          .neq("status", "CANCELLED")
          .lt("start_at", endAt)
          .gt("end_at", startAt)
      : Promise.resolve({ data: [] }),
    context.db
      .from("calendar_events")
      .select("id, gym_id, trainer_id, start_at, end_at, allows_gym_sharing")
      .eq("tenant_id", context.tenant.id)
      .neq("status", "CANCELLED")
      .lt("start_at", endAt)
      .gt("end_at", startAt),
    context.db
      .from("teams")
      .select("id, name")
      .eq("tenant_id", context.tenant.id)
      .is("deleted_at", null),
  ]);

  const teamNames = new Map((teams.data ?? []).map((team) => [team.id, team.name]));
  const toWindow = (from: string, to: string) => {
    const a = toWallClock(from, zone);
    const b = toWallClock(to, zone);
    return { start: a.minutes, end: b.date === a.date ? b.minutes : 1440 };
  };

  return [
    ...(entries.data ?? []).map((entry) => ({
      id: entry.id,
      window: toWindow(entry.start_at, entry.end_at),
      teamId: entry.team_id,
      trainerId: entry.trainer_id,
      gymId: entry.gym_id,
      teamName: teamNames.get(entry.team_id),
    })),
    ...(events.data ?? []).map((event) => ({
      id: event.id,
      window: toWindow(event.start_at, event.end_at),
      teamId: null,
      trainerId: event.trainer_id,
      gymId: event.gym_id,
      allowsGymSharing: event.allows_gym_sharing,
    })),
  ];
}
