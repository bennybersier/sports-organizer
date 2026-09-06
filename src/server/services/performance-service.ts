import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission, hasPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import {
  matchStats,
  monthlyTurnout,
  squadFindings,
  trainingStats,
  type Finding,
  type MatchStats,
  type MonthlyTurnout,
  type RecordFact,
  type RegisterFact,
  type SquadWindow,
  type TrainingStats,
} from "@/domain/attendance/statistics";
import type {
  AthleteAvailabilityExceptionRow,
  AthleteEvaluationRow,
  AttendanceOccasion,
  MatchBoxScoreRow,
} from "@/types/database";
import type { SaveBoxScoresInput, SaveEvaluationInput } from "@/lib/validation/attendance";

/**
 * Reading a season back.
 *
 * The arithmetic lives in `@/domain/attendance/statistics`, which knows nothing
 * about a database; this file's whole job is to fetch the three sets of rows it
 * needs — registers, records, and squad windows — and hand them over.
 *
 * Squad windows are the part that is easy to skip and expensive to skip. Every
 * ratio here is only honest because `athlete_teams.joined_at` and `left_at` say
 * which sessions an athlete could actually have attended.
 */

interface Facts {
  registers: RegisterFact[];
  records: RecordFact[];
  squads: SquadWindow[];
  timeZone: string;
}

/**
 * Fetches everything the statistics need for a set of athletes.
 *
 * Four queries regardless of how many athletes are asked about, because a
 * squad report for sixteen players must not be sixteen round trips.
 */
async function collectFacts(
  context: AuthContext,
  athleteIds: string[],
  options: { seasonId?: string; teamId?: string } = {},
): Promise<Facts> {
  const empty: Facts = { registers: [], records: [], squads: [], timeZone: context.tenant.timezone };
  if (athleteIds.length === 0) return empty;

  let squadQuery = context.db
    .from("athlete_teams")
    .select("athlete_id, team_id, joined_at, left_at")
    .eq("tenant_id", context.tenant.id)
    .in("athlete_id", athleteIds);
  if (options.teamId) squadQuery = squadQuery.eq("team_id", options.teamId);

  const { data: links, error: linkError } = await squadQuery;
  if (linkError) throw fromDatabaseError(linkError, { resource: "athlete" });

  const squads: SquadWindow[] = (links ?? []).map((row) => ({
    athleteId: row.athlete_id,
    teamId: row.team_id,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  }));

  const teamIds = [...new Set(squads.map((window) => window.teamId))];
  if (teamIds.length === 0) return empty;

  let registerQuery = context.db
    .from("attendance_registers")
    .select("id, team_id, occasion, state, starts_at")
    .eq("tenant_id", context.tenant.id)
    .in("team_id", teamIds);
  if (options.seasonId) registerQuery = registerQuery.eq("season_id", options.seasonId);

  const { data: registerRows, error: registerError } = await registerQuery;
  if (registerError) throw fromDatabaseError(registerError, { resource: "register" });

  const registers: RegisterFact[] = (registerRows ?? []).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    occasion: row.occasion,
    state: row.state,
    startsAt: row.starts_at,
  }));

  if (registers.length === 0) return { ...empty, squads };

  const { data: recordRows, error: recordError } = await context.db
    .from("attendance_records")
    .select("register_id, athlete_id, state, reason, called_up, started, bench_reason")
    .eq("tenant_id", context.tenant.id)
    .in("athlete_id", athleteIds)
    .in("register_id", registers.map((register) => register.id));
  if (recordError) throw fromDatabaseError(recordError, { resource: "register" });

  const records: RecordFact[] = (recordRows ?? []).map((row) => ({
    registerId: row.register_id,
    athleteId: row.athlete_id,
    state: row.state,
    reason: row.reason,
    calledUp: row.called_up,
    started: row.started,
    // "Called up and never came on" is the presence of a reason, which is the
    // only thing that distinguishes an unused substitute from a player who
    // came off the bench and played.
    benched: row.bench_reason !== null,
  }));

  return { registers, records, squads, timeZone: context.tenant.timezone };
}

/* -------------------------------------------------------------------------- */
/* One athlete                                                                */
/* -------------------------------------------------------------------------- */

export interface BoxScoreTotals {
  games: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  efficiency: number;
  /** Per-game averages, which is how a coach reads a season. */
  perGame: { points: number; rebounds: number; assists: number; efficiency: number };
}

export interface AthletePerformance {
  training: TrainingStats;
  matches: MatchStats;
  trend: MonthlyTurnout[];
  evaluations: AthleteEvaluationRow[];
  /** Null when this athlete plays for no side that keeps a scoresheet. */
  boxScore: BoxScoreTotals | null;
}

export async function getAthletePerformance(
  context: AuthContext,
  athleteId: string,
  seasonId?: string,
): Promise<AthletePerformance> {
  assertPermission(context, "attendance.read");

  const facts = await collectFacts(context, [athleteId], { seasonId });

  const [evaluations, boxScore] = await Promise.all([
    hasPermission(context, "evaluations.read")
      ? listEvaluations(context, athleteId, seasonId)
      : Promise.resolve([]),
    boxScoreTotals(context, athleteId, facts.registers),
  ]);

  return {
    training: trainingStats(athleteId, facts),
    matches: matchStats(athleteId, facts),
    trend: monthlyTurnout(athleteId, facts),
    evaluations,
    boxScore,
  };
}

/** Season totals and averages, or null when nothing was ever scored. */
async function boxScoreTotals(
  context: AuthContext,
  athleteId: string,
  registers: RegisterFact[],
): Promise<BoxScoreTotals | null> {
  const matchIds = registers
    .filter((register) => register.occasion === "MATCH")
    .map((register) => register.id);
  if (matchIds.length === 0) return null;

  const { data } = await context.db
    .from("match_box_scores")
    .select("seconds_played, points, rebounds, assists, efficiency")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId)
    .in("register_id", matchIds);

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (sum, row) => ({
      minutes: sum.minutes + row.seconds_played / 60,
      points: sum.points + row.points,
      rebounds: sum.rebounds + row.rebounds,
      assists: sum.assists + row.assists,
      efficiency: sum.efficiency + row.efficiency,
    }),
    { minutes: 0, points: 0, rebounds: 0, assists: 0, efficiency: 0 },
  );

  const games = rows.length;
  return {
    games,
    minutes: Math.round(totals.minutes),
    points: totals.points,
    rebounds: totals.rebounds,
    assists: totals.assists,
    efficiency: totals.efficiency,
    perGame: {
      points: totals.points / games,
      rebounds: totals.rebounds / games,
      assists: totals.assists / games,
      efficiency: totals.efficiency / games,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* One squad                                                                  */
/* -------------------------------------------------------------------------- */

export interface SquadMemberPerformance {
  athleteId: string;
  name: string;
  jerseyNumber: number | null;
  training: TrainingStats;
  matches: MatchStats;
}

export interface SquadPerformance {
  members: SquadMemberPerformance[];
  /** What the coach should be told without having to look for it. */
  findings: Finding[];
  /** Sessions in the past that nobody has marked. */
  unmarked: number;
}

export async function getSquadPerformance(
  context: AuthContext,
  teamId: string,
  seasonId?: string,
): Promise<SquadPerformance> {
  assertPermission(context, "attendance.read");

  const { data: links, error } = await context.db
    .from("athlete_teams")
    .select("athlete_id, jersey_number")
    .eq("tenant_id", context.tenant.id)
    .eq("team_id", teamId)
    .is("left_at", null);
  if (error) throw fromDatabaseError(error, { resource: "team" });

  const athleteIds = (links ?? []).map((row) => row.athlete_id);
  if (athleteIds.length === 0) return { members: [], findings: [], unmarked: 0 };

  const [facts, { data: athletes }, unmarked] = await Promise.all([
    // Scoped to this team: a boy who trains up has two attendance records, and
    // his U15 turnout is not the U14 coach's business.
    collectFacts(context, athleteIds, { seasonId, teamId }),
    context.db.from("athletes").select("id, first_name, last_name").in("id", athleteIds),
    countUnmarked(context, teamId),
  ]);

  const nameById = new Map(
    (athletes ?? []).map((row) => [row.id, `${row.first_name} ${row.last_name}`]),
  );
  const shirtById = new Map((links ?? []).map((row) => [row.athlete_id, row.jersey_number]));

  const members = athleteIds
    .map((athleteId) => ({
      athleteId,
      name: nameById.get(athleteId) ?? "—",
      jerseyNumber: shirtById.get(athleteId) ?? null,
      training: trainingStats(athleteId, facts),
      matches: matchStats(athleteId, facts),
    }))
    .sort((a, b) => {
      if (a.jerseyNumber !== null && b.jerseyNumber !== null) return a.jerseyNumber - b.jerseyNumber;
      if (a.jerseyNumber !== null) return -1;
      if (b.jerseyNumber !== null) return 1;
      return a.name.localeCompare(b.name);
    });

  return { members, findings: squadFindings(athleteIds, facts), unmarked };
}

/** Registers opened for this team, in the past, still waiting to be marked. */
async function countUnmarked(context: AuthContext, teamId: string): Promise<number> {
  const { count } = await context.db
    .from("attendance_registers")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", context.tenant.id)
    .eq("team_id", teamId)
    .eq("state", "OPEN")
    .lt("starts_at", new Date().toISOString());
  return count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* What still needs marking                                                   */
/* -------------------------------------------------------------------------- */

export interface PendingSession {
  /** Set once a sheet exists; null for a scheduled session nobody has opened. */
  registerId: string | null;
  scheduleEntryId: string | null;
  eventId: string | null;
  teamId: string;
  teamName: string;
  teamColor: string;
  occasion: AttendanceOccasion;
  startsAt: string;
  endsAt: string;
  gymName: string | null;
}

/**
 * Sessions in the recent past with nothing recorded against them.
 *
 * Deliberately computed rather than stored. A register is only created when
 * somebody opens one, so "unmarked" is the absence of a row — which means this
 * list is right even for sessions from a schedule that has since been
 * regenerated, and there is no backlog of empty rows to keep in step.
 *
 * Bounded by `sinceDays` because a club that never marks anything should get a
 * useful nudge, not nine months of shame.
 */
export async function listPendingSessions(
  context: AuthContext,
  options: { sinceDays?: number; teamId?: string } = {},
): Promise<PendingSession[]> {
  assertPermission(context, "attendance.read");

  const now = new Date();
  const since = new Date(now.getTime() - (options.sinceDays ?? 21) * 86_400_000);
  const from = since.toISOString();
  const to = now.toISOString();

  const { data: version } = await context.db
    .from("schedule_versions")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PUBLISHED")
    .lte("applies_from", to.slice(0, 10))
    .gte("applies_until", from.slice(0, 10))
    .order("applies_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [entries, registers, events] = await Promise.all([
    version
      ? context.db
          .from("schedule_entries")
          .select("id, team_id, gym_id, start_at, end_at")
          .eq("tenant_id", context.tenant.id)
          .eq("schedule_version_id", version.id)
          .neq("status", "CANCELLED")
          .gte("start_at", from)
          .lte("start_at", to)
      : Promise.resolve({ data: [] }),
    context.db
      .from("attendance_registers")
      .select("id, team_id, occasion, state, schedule_entry_id, event_id, starts_at, ends_at, gym_id")
      .eq("tenant_id", context.tenant.id)
      .gte("starts_at", from)
      .lte("starts_at", to),
    context.db
      .from("calendar_events")
      .select("id, start_at, end_at, gym_id")
      .eq("tenant_id", context.tenant.id)
      .in("type", ["MATCH", "TOURNAMENT"])
      .neq("status", "CANCELLED")
      .gte("start_at", from)
      .lte("start_at", to),
  ]);

  // Fetched separately rather than embedded: the generated types carry no
  // relationships, so an embedded select is untyped. Stitched by key, as
  // everywhere else in the services.
  const fixtureIds = (events.data ?? []).map((event) => event.id);
  const { data: fixtureTeams } = fixtureIds.length
    ? await context.db
        .from("calendar_event_teams")
        .select("event_id, team_id")
        .eq("tenant_id", context.tenant.id)
        .in("event_id", fixtureIds)
    : { data: [] };

  const teamsByEvent = new Map<string, string[]>();
  for (const link of fixtureTeams ?? []) {
    const list = teamsByEvent.get(link.event_id);
    if (list) list.push(link.team_id);
    else teamsByEvent.set(link.event_id, [link.team_id]);
  }

  const openById = new Map(
    (registers.data ?? []).filter((row) => row.state === "OPEN").map((row) => [row.id, row]),
  );
  const settledEntries = new Set(
    (registers.data ?? [])
      .filter((row) => row.state !== "OPEN" && row.schedule_entry_id)
      .map((row) => row.schedule_entry_id),
  );
  const settledEvents = new Set(
    (registers.data ?? [])
      .filter((row) => row.state !== "OPEN" && row.event_id)
      .map((row) => `${row.event_id}:${row.team_id}`),
  );
  const openByEntry = new Map(
    [...openById.values()].filter((r) => r.schedule_entry_id).map((r) => [r.schedule_entry_id, r]),
  );
  const openByEvent = new Map(
    [...openById.values()].filter((r) => r.event_id).map((r) => [`${r.event_id}:${r.team_id}`, r]),
  );

  const teamIds = new Set<string>();
  for (const entry of entries.data ?? []) teamIds.add(entry.team_id);
  for (const teams of teamsByEvent.values()) {
    for (const teamId of teams) teamIds.add(teamId);
  }
  if (teamIds.size === 0) return [];

  const [{ data: teams }, { data: gyms }] = await Promise.all([
    context.db.from("teams").select("id, name, color").in("id", [...teamIds]),
    context.db.from("gyms").select("id, name").eq("tenant_id", context.tenant.id),
  ]);
  const teamById = new Map((teams ?? []).map((row) => [row.id, row]));
  const gymById = new Map((gyms ?? []).map((row) => [row.id, row.name]));

  const pending: PendingSession[] = [];

  for (const entry of entries.data ?? []) {
    if (settledEntries.has(entry.id)) continue;
    if (options.teamId && entry.team_id !== options.teamId) continue;
    const team = teamById.get(entry.team_id);
    if (!team) continue;
    pending.push({
      registerId: openByEntry.get(entry.id)?.id ?? null,
      scheduleEntryId: entry.id,
      eventId: null,
      teamId: entry.team_id,
      teamName: team.name,
      teamColor: team.color,
      occasion: "TRAINING",
      startsAt: entry.start_at,
      endsAt: entry.end_at,
      gymName: entry.gym_id ? (gymById.get(entry.gym_id) ?? null) : null,
    });
  }

  for (const event of events.data ?? []) {
    for (const linkedTeamId of teamsByEvent.get(event.id) ?? []) {
      const key = `${event.id}:${linkedTeamId}`;
      if (settledEvents.has(key)) continue;
      if (options.teamId && linkedTeamId !== options.teamId) continue;
      const team = teamById.get(linkedTeamId);
      if (!team) continue;
      pending.push({
        registerId: openByEvent.get(key)?.id ?? null,
        scheduleEntryId: null,
        eventId: event.id,
        teamId: linkedTeamId,
        teamName: team.name,
        teamColor: team.color,
        occasion: "MATCH",
        startsAt: event.start_at,
        endsAt: event.end_at,
        gymName: event.gym_id ? (gymById.get(event.gym_id) ?? null) : null,
      });
    }
  }

  // Most recent first: last night's session is the one a coach means to mark.
  return pending.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

/**
 * Fixtures still to come, so a squad can be picked before the match.
 *
 * The counterpart to `listPendingSessions`, and not a variant of it: marking a
 * register is something you do afterwards, picking a squad is something you do
 * days before, and a coach looking for one is never looking for the other.
 * Folding them into one list would put last Tuesday's unmarked training next to
 * Saturday's team sheet under a heading that could only be vague about both.
 *
 * Trainings are deliberately absent. There is nothing to decide about a
 * training in advance, and pre-opening one would create exactly the backlog of
 * empty rows this module avoids.
 */
export async function listUpcomingFixtures(
  context: AuthContext,
  options: { days?: number; teamId?: string } = {},
): Promise<PendingSession[]> {
  assertPermission(context, "attendance.read");

  const now = new Date();
  const until = new Date(now.getTime() + (options.days ?? 14) * 86_400_000);
  const from = now.toISOString();
  const to = until.toISOString();

  const { data: events, error } = await context.db
    .from("calendar_events")
    .select("id, start_at, end_at, gym_id")
    .eq("tenant_id", context.tenant.id)
    .in("type", ["MATCH", "TOURNAMENT"])
    .neq("status", "CANCELLED")
    .gte("start_at", from)
    .lte("start_at", to)
    .order("start_at");
  if (error) throw fromDatabaseError(error, { resource: "event" });

  const eventIds = (events ?? []).map((event) => event.id);
  if (eventIds.length === 0) return [];

  const [{ data: links }, { data: registers }] = await Promise.all([
    context.db
      .from("calendar_event_teams")
      .select("event_id, team_id")
      .eq("tenant_id", context.tenant.id)
      .in("event_id", eventIds),
    context.db
      .from("attendance_registers")
      .select("id, event_id, team_id")
      .eq("tenant_id", context.tenant.id)
      .in("event_id", eventIds),
  ]);

  const registerByKey = new Map(
    (registers ?? []).map((row) => [`${row.event_id}:${row.team_id}`, row.id]),
  );

  const teamIds = [...new Set((links ?? []).map((link) => link.team_id))];
  const [{ data: teams }, { data: gyms }] = await Promise.all([
    context.db.from("teams").select("id, name, color").in("id", teamIds),
    context.db.from("gyms").select("id, name").eq("tenant_id", context.tenant.id),
  ]);
  const teamById = new Map((teams ?? []).map((row) => [row.id, row]));
  const gymById = new Map((gyms ?? []).map((row) => [row.id, row.name]));
  const eventById = new Map((events ?? []).map((row) => [row.id, row]));

  const upcoming: PendingSession[] = [];
  for (const link of links ?? []) {
    if (options.teamId && link.team_id !== options.teamId) continue;
    const event = eventById.get(link.event_id);
    const team = teamById.get(link.team_id);
    if (!event || !team) continue;

    upcoming.push({
      registerId: registerByKey.get(`${event.id}:${link.team_id}`) ?? null,
      scheduleEntryId: null,
      eventId: event.id,
      teamId: link.team_id,
      teamName: team.name,
      teamColor: team.color,
      occasion: "MATCH",
      startsAt: event.start_at,
      endsAt: event.end_at,
      gymName: event.gym_id ? (gymById.get(event.gym_id) ?? null) : null,
    });
  }

  // Soonest first: the next match is the one being picked.
  return upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/* -------------------------------------------------------------------------- */
/* Box scores                                                                 */
/* -------------------------------------------------------------------------- */

export async function listBoxScores(
  context: AuthContext,
  registerId: string,
): Promise<MatchBoxScoreRow[]> {
  assertPermission(context, "attendance.read");

  const { data, error } = await context.db
    .from("match_box_scores")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("register_id", registerId);
  if (error) throw fromDatabaseError(error, { resource: "box score" });
  return data ?? [];
}

/**
 * Writes a whole scoresheet.
 *
 * Only players who were actually called up get a line: a box score for someone
 * who was not on the sheet is a transcription error, and catching it here is
 * cheaper than explaining a phantom twelve points in March. The check is a
 * single query against the register rather than one per player.
 */
export async function saveBoxScores(
  context: AuthContext,
  input: SaveBoxScoresInput,
): Promise<{ saved: number }> {
  assertPermission(context, "attendance.record");

  const { data: called, error: calledError } = await context.db
    .from("attendance_records")
    .select("athlete_id, called_up")
    .eq("tenant_id", context.tenant.id)
    .eq("register_id", input.registerId);
  if (calledError) throw fromDatabaseError(calledError, { resource: "register" });

  const eligible = new Set(
    (called ?? []).filter((row) => row.called_up).map((row) => row.athlete_id),
  );
  const stranger = input.lines.find((line) => !eligible.has(line.athleteId));
  if (stranger) {
    throw new ConflictError("A player who was not called up cannot have a box score.");
  }
  if (input.lines.length === 0) return { saved: 0 };

  const { error } = await context.db.from("match_box_scores").upsert(
    input.lines.map((line) => ({
      tenant_id: context.tenant.id,
      register_id: input.registerId,
      athlete_id: line.athleteId,
      seconds_played: line.secondsPlayed,
      two_point_made: line.twoPointMade,
      two_point_attempted: line.twoPointAttempted,
      three_point_made: line.threePointMade,
      three_point_attempted: line.threePointAttempted,
      free_throw_made: line.freeThrowMade,
      free_throw_attempted: line.freeThrowAttempted,
      offensive_rebounds: line.offensiveRebounds,
      defensive_rebounds: line.defensiveRebounds,
      assists: line.assists,
      steals: line.steals,
      blocks: line.blocks,
      turnovers: line.turnovers,
      fouls_committed: line.foulsCommitted,
      fouls_drawn: line.foulsDrawn,
      plus_minus: line.plusMinus ?? null,
      created_by: context.user.id,
    })),
    { onConflict: "register_id,athlete_id" },
  );
  if (error) throw fromDatabaseError(error, { resource: "box score" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.BOX_SCORE_RECORDED,
    resourceType: "attendance_register",
    resourceId: input.registerId,
    newValue: { players: input.lines.length },
  });

  return { saved: input.lines.length };
}

/* -------------------------------------------------------------------------- */
/* Declared absences                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What the club has been told about, most recent first.
 *
 * Past ones are kept rather than tidied away: "he was in Puglia for a fortnight
 * in December" is the explanation for a hole in the attendance chart, and a
 * list that only showed the future would leave that hole unexplained.
 */
export async function listAbsences(
  context: AuthContext,
  athleteId: string,
): Promise<AthleteAvailabilityExceptionRow[]> {
  assertPermission(context, "attendance.read");

  const { data, error } = await context.db
    .from("athlete_availability_exceptions")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId)
    .order("starts_on", { ascending: false });
  if (error) throw fromDatabaseError(error, { resource: "absence" });
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Evaluations                                                                */
/* -------------------------------------------------------------------------- */

export async function listEvaluations(
  context: AuthContext,
  athleteId: string,
  seasonId?: string,
): Promise<AthleteEvaluationRow[]> {
  assertPermission(context, "evaluations.read");

  let query = context.db
    .from("athlete_evaluations")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId);
  if (seasonId) query = query.eq("season_id", seasonId);

  const { data, error } = await query.order("period_start", { ascending: true });
  if (error) throw fromDatabaseError(error, { resource: "evaluation" });
  return data ?? [];
}

export async function saveEvaluation(
  context: AuthContext,
  input: SaveEvaluationInput,
): Promise<{ id: string }> {
  assertPermission(context, "evaluations.write");

  const { data: team } = await context.db
    .from("teams")
    .select("season_id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.teamId)
    .maybeSingle();
  if (!team) throw new NotFoundError("team");

  const row = {
    tenant_id: context.tenant.id,
    season_id: team.season_id,
    athlete_id: input.athleteId,
    team_id: input.teamId,
    trainer_id: input.trainerId ?? null,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    technique: input.technique ?? null,
    tactical: input.tactical ?? null,
    physical: input.physical ?? null,
    attitude: input.attitude ?? null,
    strengths: input.strengths ?? null,
    development: input.development ?? null,
    note: input.note ?? null,
    created_by: context.user.id,
  };

  // Upserting on the natural key means re-opening a period's assessment and
  // saving it again edits it, rather than failing on the unique index.
  const { data, error } = await context.db
    .from("athlete_evaluations")
    .upsert(row, { onConflict: "athlete_id,team_id,period_start" })
    .select("id")
    .single();
  if (error) throw fromDatabaseError(error, { resource: "evaluation" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.EVALUATION_WRITTEN,
    resourceType: "athlete_evaluation",
    resourceId: data.id,
    newValue: { athleteId: input.athleteId, period: input.periodStart },
  });

  return data;
}
