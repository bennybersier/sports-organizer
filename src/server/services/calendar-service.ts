import "server-only";

import { NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { constrainsDate, resolveAvailability, type IsoWeekday } from "@/domain/availability";
import { occupiedWindow, toOccupyingEvent } from "@/domain/scheduling/fixtures";
import {
  validatePlacement,
  type Booking,
  type PlacementResult,
  type PlacementRules,
} from "@/domain/scheduling/conflicts";
import {
  addDays,
  eachDay,
  endOfDayInZone,
  endOfMonth,
  isoWeekdayOfDate,
  startOfDayInZone,
  startOfMonth,
  startOfWeek,
  todayInZone,
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
  /**
   * The single team, when there is exactly one. Null for training with no team
   * (impossible) and for a club-wide event or a derby, which have none or two.
   */
  teamId: string | null;
  teamName: string | null;
  /** Every team involved. One for training; zero or more for an event. */
  teamIds: string[];
  teamNames: string[];
  trainerId: string | null;
  trainerName: string | null;
  gymId: string | null;
  gymName: string | null;
  /** Only the published schedule and manual events are editable in place. */
  editable: boolean;
  blocksScheduling: boolean;
  allowsGymSharing: boolean;
  /** Where an away fixture is played, when it is not one of our halls. */
  location: string | null;
  /* --- Fixtures only. Null on everything else. --------------------------- */
  opponent: string | null;
  isHome: boolean | null;
  competition: string | null;
  /**
   * When the hall is actually held, setup and pack-down included.
   *
   * Equal to the item's own times when there is no buffer. The calendar draws
   * the event at its real times and shades this behind it — telling a parent to
   * arrive at 16:30 for an 18:00 game would be worse than saying nothing.
   */
  heldFrom: string;
  heldUntil: string;
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

  const teamsByEvent = await eventTeamLinks(
    context,
    events.map((event) => event.id),
  );

  const items: CalendarItem[] = [];

  for (const entry of entries) {
    items.push(toCalendarItem(entry, lookups));
  }

  for (const event of events) {
    const linked = teamsByEvent.get(event.id) ?? [];
    const names = linked.map((id) => lookups.teams.get(id)?.name).filter((n): n is string => !!n);

    /*
      A team filter keeps this event when it names that team — and also when it
      names none at all, because a holiday or a hall closure is every team's
      business. Done here rather than in the query: the range is a week or a
      month, and the rule is not an equality.
    */
    if (filters.teamId && linked.length > 0 && !linked.includes(filters.teamId)) continue;

    const held = occupiedWindow(toOccupyingEvent(event));

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
      teamId: linked.length === 1 ? linked[0] : null,
      teamName: names.length === 1 ? names[0] : null,
      teamIds: linked,
      teamNames: names,
      trainerId: event.trainer_id,
      trainerName: event.trainer_id ? (lookups.trainers.get(event.trainer_id) ?? null) : null,
      gymId: event.gym_id,
      gymName: event.gym_id ? (lookups.gyms.get(event.gym_id) ?? null) : null,
      editable: true,
      blocksScheduling: event.blocks_scheduling,
      allowsGymSharing: event.allows_gym_sharing,
      location: event.location,
      opponent: event.opponent,
      isHome: event.is_home,
      competition: event.competition,
      heldFrom: held.startAt,
      heldUntil: held.endAt,
    });
  }

  return items.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * Which teams each event involves.
 *
 * Kept as one function because three callers need it and the join table is
 * otherwise easy to forget: it has been written since the beginning and, until
 * fixtures, read only to prefill an edit form.
 */
async function eventTeamLinks(
  context: AuthContext,
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const byEvent = new Map<string, string[]>();
  if (eventIds.length === 0) return byEvent;

  const { data } = await context.db
    .from("calendar_event_teams")
    .select("event_id, team_id")
    .eq("tenant_id", context.tenant.id)
    .in("event_id", eventIds);

  for (const link of data ?? []) {
    byEvent.set(link.event_id, [...(byEvent.get(link.event_id) ?? []), link.team_id]);
  }
  return byEvent;
}

type ScheduleEntryRecord = Awaited<ReturnType<typeof fetchScheduleEntries>>[number];
type Lookups = Awaited<ReturnType<typeof fetchLookups>>;

function toCalendarItem(entry: ScheduleEntryRecord, lookups: Lookups): CalendarItem {
  const team = lookups.teams.get(entry.team_id);
  return {
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
    teamIds: [entry.team_id],
    teamNames: team?.name ? [team.name] : [],
    trainerId: entry.trainer_id,
    trainerName: entry.trainer_id ? (lookups.trainers.get(entry.trainer_id) ?? null) : null,
    gymId: entry.gym_id,
    gymName: lookups.gyms.get(entry.gym_id) ?? null,
    editable: true,
    blocksScheduling: false,
    allowsGymSharing: false,
    location: null,
    opponent: null,
    isHome: null,
    competition: null,
    // Training holds the hall for exactly as long as it runs.
    heldFrom: entry.start_at,
    heldUntil: entry.end_at,
  };
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
      "id, type, title, start_at, end_at, all_day, color, status, gym_id, trainer_id, blocks_scheduling, allows_gym_sharing, season_id, location, opponent, is_home, competition, buffer_before_minutes, buffer_after_minutes",
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

  const [gymWindows, gymExceptions, teamWindows, teamExceptions, requirement, bookings, gym] =
    await Promise.all([
      listAvailability(context, "gym", input.gymId),
      listExceptions(context, "gym", input.gymId),
      listAvailability(context, "team", input.teamId),
      listExceptions(context, "team", input.teamId),
      getTrainingRequirement(context, input.teamId, input.seasonId),
      collectBookings(context, input.startAt, input.endAt),
      // The hall's own policy: whether it tolerates a changeover overlap, and
      // how long. Without this the calendar would refuse placements the
      // optimizer is willing to make, which is exactly the disagreement
      // `validatePlacement` exists to prevent.
      context.db
        .from("gyms")
        .select("max_concurrent_teams, max_shared_overlap_minutes")
        .eq("tenant_id", context.tenant.id)
        .eq("id", input.gymId)
        .maybeSingle(),
    ]);

  const [trainerWindows, trainerExceptions] = input.trainerId
    ? await Promise.all([
        listAvailability(context, "trainer", input.trainerId),
        listExceptions(context, "trainer", input.trainerId),
      ])
    : [null, null];

  const toDomainExceptions = (
    exceptions: { exceptionDate: string; startTime: string | null; endTime: string | null; type: "UNAVAILABLE" | "AVAILABLE_OVERRIDE" }[],
  ) =>
    exceptions.map((exception) => ({
      date: exception.exceptionDate,
      startTime: exception.startTime,
      endTime: exception.endTime,
      type: exception.type,
    }));

  const resolve = (
    windows: { isoWeekday: IsoWeekday; startTime: string; endTime: string; validFrom: string; validUntil: string | null }[],
    exceptions: { exceptionDate: string; startTime: string | null; endTime: string | null; type: "UNAVAILABLE" | "AVAILABLE_OVERRIDE" }[],
  ) =>
    resolveAvailability(
      start.date,
      start.isoWeekday as IsoWeekday,
      windows,
      toDomainExceptions(exceptions),
    );

  /*
    Null when the team's availability has nothing to say about this date, so the
    check matches the generator: a silent day is unconstrained, a day the team
    closed is a conflict. Resolving first and testing for emptiness cannot tell
    those apart — both come back `[]`.
  */
  const teamAvailability = constrainsDate(
    start.date,
    start.isoWeekday as IsoWeekday,
    teamWindows,
    toDomainExceptions(teamExceptions),
  )
    ? resolve(teamWindows, teamExceptions)
    : null;

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
      team: teamAvailability,
    },
    bookings,
    rules,
    {
      gymSharing: gym.data
        ? {
            maxConcurrentTeams: gym.data.max_concurrent_teams,
            maxSharedOverlapMinutes: gym.data.max_shared_overlap_minutes,
          }
        : undefined,
    },
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
      .select(
        "id, gym_id, trainer_id, start_at, end_at, all_day, allows_gym_sharing, buffer_before_minutes, buffer_after_minutes",
      )
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

  // A match is that team's business, not nobody's.
  const teamsByEvent = await eventTeamLinks(
    context,
    (events.data ?? []).map((event) => event.id),
  );

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
      // Training is what a hall's changeover tolerance was built for.
      sharable: true,
    })),
    ...(events.data ?? []).map((event) => {
      const linked = teamsByEvent.get(event.id) ?? [];
      const occupied = occupiedWindow(toOccupyingEvent(event));
      return {
        id: event.id,
        // The hall is gone for setup and pack-down, not just for the event, so
        // dragging a session into the half hour after a match must fail here
        // exactly as generation would have refused it.
        window: toWindow(occupied.startAt, occupied.endAt),
        // `Booking.teamId` is singular and cannot express a derby. The gym
        // clash still fires for one played in our own hall; what it misses is
        // dragging a session onto an away derby, which is not worth widening
        // the type for.
        teamId: linked.length === 1 ? linked[0] : null,
        teamName: linked.length === 1 ? teamNames.get(linked[0]) : undefined,
        trainerId: event.trainer_id,
        gymId: event.gym_id,
        allowsGymSharing: event.allows_gym_sharing,
        // Never: a buffer the club stated is not something to be negotiated
        // down by half an hour because the optimizer was stuck.
        sharable: false,
      };
    }),
  ];
}

export interface TrainingWeek {
  weekStart: string;
  weekEnd: string;
  previousWeek: string;
  nextWeek: string;
  days: { date: string; isoWeekday: number; items: CalendarItem[] }[];
  /** Sessions that are actually going ahead, so cancelled ones don't flatter the count. */
  scheduledCount: number;
  /**
   * The date this schedule's sessions begin.
   *
   * A schedule generated on a Wednesday starts on that Wednesday, so its first
   * week is a partial one — three days of a five-day pattern. Without this the
   * view shows an empty Monday and Tuesday and looks like the optimizer simply
   * failed to use them.
   */
  coverageStart: string | null;
}

/**
 * One team's training week.
 *
 * A club asks "when does U13 Gold train?" far more often than it asks what the
 * whole club is doing, and answering it from the full calendar means filtering
 * a wall of other teams' sessions.
 *
 * With no week given it lands on the team's next session rather than today:
 * during the summer, or any week the team happens not to train, "this week"
 * is an empty grid that looks like a fault.
 */
export async function getTeamTrainingWeek(
  context: AuthContext,
  teamId: string,
  weekOf?: string,
): Promise<TrainingWeek> {
  assertPermission(context, "calendar.read");

  const zone = context.tenant.timezone;

  const { data: published } = await context.db
    .from("schedule_versions")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PUBLISHED")
    .limit(1)
    .maybeSingle();

  const span = published
    ? await scheduleSpan(context, published.id)
    : { first: null, last: null };

  const anchor = weekOf ?? (await nextTrainingDate(context, teamId)) ?? todayInZone(zone);
  const weekStart = startOfWeek(anchor, context.tenant.weekStart);
  const weekEnd = addDays(weekStart, 6);

  // Training *and* whatever else lands on this team's week — its fixtures
  // above all, which is half of what a coach comes to this page to see.
  const items = await listCalendarItems(context, weekStart, weekEnd, { teamId });

  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(weekStart, offset);
    return {
      date,
      isoWeekday: isoWeekdayOfDate(date),
      // Grouped by the club's local date, not UTC: a 22:00 session in Rome is
      // already tomorrow in UTC and would land on the wrong day.
      items: items.filter((item) => toWallClock(item.startAt, zone).date === date),
    };
  });

  return {
    weekStart,
    weekEnd,
    previousWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    days,
    // Training only. Counting fixtures here would have the badge reading
    // "3 of 2 sessions" the moment a team played a game.
    scheduledCount: items.filter(
      (item) => item.source === "SCHEDULE" && item.status !== "CANCELLED",
    ).length,
    coverageStart: span.first,
  };
}

export interface TrainingMonth {
  /** First day of the month being shown. */
  monthStart: string;
  /** The padded range actually rendered — whole weeks, so the grid is square. */
  from: string;
  to: string;
  previousMonth: string;
  nextMonth: string;
  weeks: {
    date: string;
    isoWeekday: number;
    /** False for the padding days borrowed from the neighbouring months. */
    inMonth: boolean;
    items: CalendarItem[];
  }[][];
  /** Training going ahead this month; cancelled sessions do not flatter it. */
  scheduledCount: number;
  coverageStart: string | null;
}

/**
 * One team's month.
 *
 * The week answers "when are we in the hall on Thursday"; the month answers
 * "how much are we actually training in November, and where are the gaps" —
 * which is the question asked when a fixture needs moving or a hall falls
 * through. Same data, same team filter, a wider window.
 *
 * Padded to whole weeks so the grid is rectangular, with the borrowed days
 * marked rather than blanked: a session on the 1st is worth seeing even when it
 * sits under the previous month's last Sunday.
 */
export async function getTeamTrainingMonth(
  context: AuthContext,
  teamId: string,
  monthOf?: string,
): Promise<TrainingMonth> {
  assertPermission(context, "calendar.read");

  const zone = context.tenant.timezone;
  const weekStart = context.tenant.weekStart;

  const { data: published } = await context.db
    .from("schedule_versions")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PUBLISHED")
    .limit(1)
    .maybeSingle();

  const span = published ? await scheduleSpan(context, published.id) : { first: null, last: null };

  // Same rule as the week view: land where the team actually trains rather
  // than on a month that happens to be empty.
  const anchor = monthOf ?? (await nextTrainingDate(context, teamId)) ?? todayInZone(zone);
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const from = startOfWeek(monthStart, weekStart);
  const to = addDays(startOfWeek(monthEnd, weekStart), 6);

  const items = await listCalendarItems(context, from, to, { teamId });

  const month = monthStart.slice(0, 7);
  const dates = eachDay(from, to);
  const weeks: TrainingMonth["weeks"] = [];

  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(
      dates.slice(index, index + 7).map((date) => ({
        date,
        isoWeekday: isoWeekdayOfDate(date),
        inMonth: date.slice(0, 7) === month,
        // The club's local date, not UTC: a 22:00 session in Rome is already
        // tomorrow in UTC and would land on the wrong day.
        items: items.filter((item) => toWallClock(item.startAt, zone).date === date),
      })),
    );
  }

  return {
    monthStart,
    from,
    to,
    previousMonth: addDays(monthStart, -1),
    nextMonth: addDays(monthEnd, 1),
    weeks,
    scheduledCount: items.filter(
      (item) => item.source === "SCHEDULE" && item.status !== "CANCELLED",
    ).length,
    coverageStart: span.first,
  };
}

/** First and last dates a version actually puts sessions on. */
async function scheduleSpan(
  context: AuthContext,
  versionId: string,
): Promise<{ first: string | null; last: string | null }> {
  const zone = context.tenant.timezone;

  const range = async (ascending: boolean) => {
    const { data } = await context.db
      .from("schedule_entries")
      .select("start_at")
      .eq("tenant_id", context.tenant.id)
      .eq("schedule_version_id", versionId)
      .order("start_at", { ascending })
      .limit(1)
      .maybeSingle();
    return data ? toWallClock(data.start_at, zone).date : null;
  };

  const [first, last] = await Promise.all([range(true), range(false)]);
  return { first, last };
}

function defaultAnchor(
  span: { first: string | null; last: string | null },
  fallback: string,
  weekStart: number,
): string {
  if (!span.first) return fallback;

  const firstWeek = startOfWeek(span.first, weekStart);
  if (firstWeek === span.first) return span.first;

  // Skipping the partial week is only an improvement if a whole one follows.
  const nextWeek = addDays(firstWeek, 7);
  return span.last && nextWeek <= span.last ? nextWeek : span.first;
}

/** The date of the team's next session, so the week shown is never empty. */
async function nextTrainingDate(
  context: AuthContext,
  teamId: string,
): Promise<string | null> {
  const { data: version } = await context.db
    .from("schedule_versions")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PUBLISHED")
    .limit(1)
    .maybeSingle();

  if (!version) return null;

  const { data } = await context.db
    .from("schedule_entries")
    .select("start_at")
    .eq("tenant_id", context.tenant.id)
    .eq("schedule_version_id", version.id)
    .eq("team_id", teamId)
    .gte("start_at", new Date().toISOString())
    .order("start_at")
    .limit(1)
    .maybeSingle();

  return data ? toWallClock(data.start_at, context.tenant.timezone).date : null;
}

/**
 * One week of a schedule version, published or not.
 *
 * The calendar deliberately shows only the published schedule — a draft is not
 * what the club is doing — which left "view in calendar" on a draft opening an
 * empty week. This is the honest answer to "what would this schedule look
 * like?", without publishing it to find out.
 */
export async function getVersionWeek(
  context: AuthContext,
  versionId: string,
  weekOf?: string,
): Promise<TrainingWeek> {
  assertPermission(context, "schedule.review");

  const { data: version } = await context.db
    .from("schedule_versions")
    .select("id, applies_from")
    .eq("tenant_id", context.tenant.id)
    .eq("id", versionId)
    .maybeSingle();

  if (!version) throw new NotFoundError("schedule");

  const zone = context.tenant.timezone;

  const span = await scheduleSpan(context, versionId);

  /*
    Open on the first *whole* week. A schedule generated mid-week starts
    mid-week, so its opening week shows only the days that were left — which
    reads as "the optimizer ignored Monday" rather than "the schedule starts on
    Wednesday". The partial week is still there, one step back.
  */
  const anchor = weekOf ?? defaultAnchor(span, version.applies_from, context.tenant.weekStart);
  const weekStart = startOfWeek(anchor, context.tenant.weekStart);
  const weekEnd = addDays(weekStart, 6);

  const [entries, lookups] = await Promise.all([
    fetchScheduleEntries(
      context,
      versionId,
      startOfDayInZone(weekStart, zone).toISOString(),
      endOfDayInZone(weekEnd, zone).toISOString(),
      {},
    ),
    fetchLookups(context),
  ]);

  const items = entries
    .map((entry) => toCalendarItem(entry, lookups))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return {
    weekStart,
    weekEnd,
    previousWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    days: Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(weekStart, offset);
      return {
        date,
        isoWeekday: isoWeekdayOfDate(date),
        items: items.filter((item) => toWallClock(item.startAt, zone).date === date),
      };
    }),
    scheduledCount: items.filter((item) => item.status !== "CANCELLED").length,
    coverageStart: span.first,
  };
}
