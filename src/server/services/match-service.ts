import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import { assertPermission } from "@/server/auth/authorization";
import type { AuthContext } from "@/server/auth/context";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { outcomeOf, teamRecord, type Outcome, type TeamRecord } from "@/domain/competitions/record";
import type { MatchResultRow, MatchResultState } from "@/types/database";
import type { SaveResultInput } from "@/lib/validation/match";

/**
 * Matches, and what happened in them.
 *
 * A "match" here is a `calendar_events` row with an opponent, paired with one
 * of our teams through `calendar_event_teams`. That pairing is the unit
 * throughout this file — a derby is one event and two matches, and each side
 * has its own result, its own register and its own box score.
 *
 * Nothing in this file can produce a league table, and that is a property of
 * the data rather than a gap to fill: we only ever see our own fixtures. See
 * `src/domain/competitions/record.ts`.
 */

/** A match as it appears in a list. */
export interface MatchListItem {
  eventId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  startsAt: string;
  endsAt: string;
  opponent: string;
  isHome: boolean | null;
  competition: string | null;
  gymName: string | null;
  /** Null until somebody opens one; the sheet lives behind it. */
  registerId: string | null;
  result: MatchResultSummary | null;
  /** True when the team keeps a scoresheet, so a sheet is worth uploading. */
  tracksBoxScore: boolean;
}

export interface MatchResultSummary {
  state: MatchResultState;
  ourScore: number | null;
  theirScore: number | null;
  ourPeriods: number[] | null;
  theirPeriods: number[] | null;
  /** Null while the result is PENDING. */
  outcome: Outcome | null;
  notes: string | null;
}

function summarise(row: MatchResultRow): MatchResultSummary {
  return {
    state: row.state,
    ourScore: row.our_score,
    theirScore: row.their_score,
    ourPeriods: row.our_periods,
    theirPeriods: row.their_periods,
    outcome:
      row.our_score === null || row.their_score === null
        ? null
        : outcomeOf({ ourScore: row.our_score, theirScore: row.their_score }),
    notes: row.notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

export interface ListMatchesOptions {
  teamId?: string;
  /** Restricts to the matches of one competition, via its dated fixtures. */
  competitionId?: string;
  seasonId?: string;
  /** Defaults to everything; "PLAYED" is the results view. */
  only?: "PLAYED" | "PENDING";
}

/**
 * Every match of ours, most recent first.
 *
 * Six queries regardless of how many matches there are. The shape is dictated
 * by `opponent` living on the event while the team lives on a join table: there
 * is no single row that is "a match", so the list is assembled rather than
 * selected. Doing it per match would be a hundred round trips for a season.
 */
export async function listMatches(
  context: AuthContext,
  options: ListMatchesOptions = {},
): Promise<MatchListItem[]> {
  assertPermission(context, "attendance.read");

  /*
    A match is an event with an opponent. `type` is not the test: a TOURNAMENT
    is a match too, and a MATCH-typed event with no opponent is a draft the
    organizer has not finished. `opponent` is the column migration 0021 added
    precisely so this question needed no second table.
  */
  let eventQuery = context.db
    .from("calendar_events")
    .select("id, start_at, end_at, gym_id, opponent, is_home, competition")
    .eq("tenant_id", context.tenant.id)
    .not("opponent", "is", null)
    .neq("status", "CANCELLED")
    .order("start_at", { ascending: false });

  /*
    Narrowing to a competition goes through its fixtures, which are the only
    thing that knows an event belongs to one. `calendar_events.competition` is
    free text typed by a human and is a label, not a key.
  */
  if (options.competitionId) {
    const { data: fixtures, error } = await context.db
      .from("fixtures")
      .select("calendar_event_id")
      .eq("tenant_id", context.tenant.id)
      .eq("competition_id", options.competitionId)
      .not("calendar_event_id", "is", null);
    if (error) throw fromDatabaseError(error, { resource: "competition" });

    const ids = (fixtures ?? [])
      .map((fixture) => fixture.calendar_event_id)
      .filter((id): id is string => id !== null);
    if (ids.length === 0) return [];
    eventQuery = eventQuery.in("id", ids);
  }

  const { data: events, error: eventError } = await eventQuery;
  if (eventError) throw fromDatabaseError(eventError, { resource: "event" });

  const eventIds = (events ?? []).map((event) => event.id);
  if (eventIds.length === 0) return [];

  let linkQuery = context.db
    .from("calendar_event_teams")
    .select("event_id, team_id")
    .eq("tenant_id", context.tenant.id)
    .in("event_id", eventIds);
  if (options.teamId) linkQuery = linkQuery.eq("team_id", options.teamId);

  const [{ data: links }, { data: registers }, { data: results }, { data: gyms }] =
    await Promise.all([
      linkQuery,
      context.db
        .from("attendance_registers")
        .select("id, event_id, team_id")
        .eq("tenant_id", context.tenant.id)
        .in("event_id", eventIds),
      context.db
        .from("match_results")
        .select("*")
        .eq("tenant_id", context.tenant.id)
        .in("event_id", eventIds),
      context.db.from("gyms").select("id, name").eq("tenant_id", context.tenant.id),
    ]);

  const teamIds = [...new Set((links ?? []).map((link) => link.team_id))];
  if (teamIds.length === 0) return [];

  let teamQuery = context.db
    .from("teams")
    .select("id, name, color, season_id, tracks_box_score")
    .eq("tenant_id", context.tenant.id)
    .in("id", teamIds);
  if (options.seasonId) teamQuery = teamQuery.eq("season_id", options.seasonId);
  const { data: teams } = await teamQuery;

  const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
  const eventById = new Map((events ?? []).map((event) => [event.id, event]));
  const gymById = new Map((gyms ?? []).map((gym) => [gym.id, gym.name]));
  const key = (eventId: string, teamId: string) => `${eventId}:${teamId}`;
  /*
    A register's `event_id` is nullable — most registers hang off a schedule
    entry instead, because most sessions are training. Only the match ones can
    be keyed this way, and the rest are not registers for any match here.
  */
  const registerByKey = new Map(
    (registers ?? [])
      .filter((row): row is typeof row & { event_id: string } => row.event_id !== null)
      .map((row) => [key(row.event_id, row.team_id), row.id]),
  );
  const resultByKey = new Map(
    (results ?? []).map((row) => [key(row.event_id, row.team_id), row]),
  );

  const matches: MatchListItem[] = [];
  for (const link of links ?? []) {
    const event = eventById.get(link.event_id);
    const team = teamById.get(link.team_id);
    // A team filtered out by season is not a match we are listing.
    if (!event || !team || event.opponent === null) continue;

    const opponent = event.opponent;
    const result = resultByKey.get(key(link.event_id, link.team_id)) ?? null;
    const played = result !== null && result.state !== "PENDING";
    if (options.only === "PLAYED" && !played) continue;
    if (options.only === "PENDING" && played) continue;

    matches.push({
      eventId: event.id,
      teamId: link.team_id,
      teamName: team.name,
      teamColor: team.color,
      startsAt: event.start_at,
      endsAt: event.end_at,
      opponent,
      isHome: event.is_home,
      competition: event.competition,
      gymName: event.gym_id ? (gymById.get(event.gym_id) ?? null) : null,
      registerId: registerByKey.get(key(link.event_id, link.team_id)) ?? null,
      result: result ? summarise(result) : null,
      tracksBoxScore: team.tracks_box_score,
    });
  }

  return matches.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

/* -------------------------------------------------------------------------- */
/* One match                                                                  */
/* -------------------------------------------------------------------------- */

export interface MatchDetail extends MatchListItem {
  seasonId: string;
  /** The competition this came from, when it came from one. */
  competitionRef: { id: string; name: string; matchday: number } | null;
  /** Whether the caller may change the result as things stand. */
  editable: boolean;
}

/**
 * One match, by event and team.
 *
 * Two keys rather than one id because that is genuinely what identifies a
 * match: a derby is one event with a result for each side, and a URL carrying
 * only the event could not say which one it meant.
 */
export async function getMatch(
  context: AuthContext,
  eventId: string,
  teamId: string,
): Promise<MatchDetail> {
  assertPermission(context, "attendance.read");

  const [{ data: event, error: eventError }, { data: team }, { data: link }] = await Promise.all([
    context.db
      .from("calendar_events")
      .select("id, start_at, end_at, gym_id, opponent, is_home, competition, status")
      .eq("tenant_id", context.tenant.id)
      .eq("id", eventId)
      .maybeSingle(),
    context.db
      .from("teams")
      .select("id, name, color, season_id, tracks_box_score")
      .eq("tenant_id", context.tenant.id)
      .eq("id", teamId)
      .maybeSingle(),
    context.db
      .from("calendar_event_teams")
      .select("event_id")
      .eq("tenant_id", context.tenant.id)
      .eq("event_id", eventId)
      .eq("team_id", teamId)
      .maybeSingle(),
  ]);

  if (eventError) throw fromDatabaseError(eventError, { resource: "event" });
  if (!event || !team || !link) throw new NotFoundError("match");
  // An event with no opponent is a training session or a meeting: not a match,
  // and not something a match URL should resolve to.
  if (event.opponent === null) throw new NotFoundError("match");

  const [{ data: register }, { data: result }, { data: gym }, { data: fixture }] =
    await Promise.all([
      context.db
        .from("attendance_registers")
        .select("id")
        .eq("tenant_id", context.tenant.id)
        .eq("event_id", eventId)
        .eq("team_id", teamId)
        .maybeSingle(),
      context.db
        .from("match_results")
        .select("*")
        .eq("tenant_id", context.tenant.id)
        .eq("event_id", eventId)
        .eq("team_id", teamId)
        .maybeSingle(),
      event.gym_id
        ? context.db.from("gyms").select("name").eq("id", event.gym_id).maybeSingle()
        : Promise.resolve({ data: null }),
      context.db
        .from("fixtures")
        .select("matchday, competition_id")
        .eq("tenant_id", context.tenant.id)
        .eq("calendar_event_id", eventId)
        .maybeSingle(),
    ]);

  // Named separately rather than embedded: `Relationships` is empty in our
  // hand-written Database type, so a PostgREST embed has no usable shape.
  const { data: competition } = fixture
    ? await context.db
        .from("competitions")
        .select("id, name")
        .eq("tenant_id", context.tenant.id)
        .eq("id", fixture.competition_id)
        .maybeSingle()
    : { data: null };

  return {
    eventId: event.id,
    teamId: team.id,
    teamName: team.name,
    teamColor: team.color,
    seasonId: team.season_id,
    startsAt: event.start_at,
    endsAt: event.end_at,
    opponent: event.opponent,
    isHome: event.is_home,
    competition: event.competition,
    gymName: gym?.name ?? null,
    registerId: register?.id ?? null,
    result: result ? summarise(result) : null,
    tracksBoxScore: team.tracks_box_score,
    competitionRef:
      competition && fixture
        ? { id: competition.id, name: competition.name, matchday: fixture.matchday }
        : null,
    editable: context.permissions.has("attendance.record"),
  };
}

/* -------------------------------------------------------------------------- */
/* Recording a result                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Writes the score, or clears it back to pending.
 *
 * Upserts on `(event_id, team_id)` rather than reading first: two people typing
 * Sunday's score into two phones is a normal Sunday, and the second write
 * should win rather than fail. The database's own constraints are what keep a
 * state and a score from disagreeing, so there is nothing to check here that
 * Postgres would not catch anyway — the one thing worth checking in application
 * code is the season, which must be the team's own and is not something a form
 * should be trusted to supply.
 */
export async function saveResult(
  context: AuthContext,
  input: SaveResultInput,
): Promise<MatchResultSummary> {
  assertPermission(context, "attendance.record");

  const { data: team, error: teamError } = await context.db
    .from("teams")
    .select("id, season_id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.teamId)
    .maybeSingle();
  if (teamError) throw fromDatabaseError(teamError, { resource: "team" });
  if (!team) throw new NotFoundError("team");

  const { data: link } = await context.db
    .from("calendar_event_teams")
    .select("event_id")
    .eq("tenant_id", context.tenant.id)
    .eq("event_id", input.eventId)
    .eq("team_id", input.teamId)
    .maybeSingle();
  if (!link) {
    throw new ConflictError("That team is not playing in that match.");
  }

  const pending = input.state === "PENDING";

  const { data, error } = await context.db
    .from("match_results")
    .upsert(
      {
        tenant_id: context.tenant.id,
        season_id: team.season_id,
        event_id: input.eventId,
        team_id: input.teamId,
        state: input.state,
        // Cleared together with the state, so "not played yet" leaves nothing
        // of a score somebody typed by mistake.
        our_score: pending ? null : input.ourScore,
        their_score: pending ? null : input.theirScore,
        our_periods: pending ? null : input.ourPeriods,
        their_periods: pending ? null : input.theirPeriods,
        notes: input.notes,
        recorded_by: context.user.id,
      },
      { onConflict: "event_id,team_id" },
    )
    .select("*")
    .single();
  if (error) throw fromDatabaseError(error, { resource: "result" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MATCH_RESULT_RECORDED,
    resourceType: "calendar_event",
    resourceId: input.eventId,
    newValue: {
      team: input.teamId,
      state: input.state,
      score: pending ? null : `${input.ourScore}-${input.theirScore}`,
    },
  });

  return summarise(data);
}

/* -------------------------------------------------------------------------- */
/* Record and form                                                            */
/* -------------------------------------------------------------------------- */

export interface TeamSeasonRecord extends TeamRecord {
  /** The matches the record is made of, most recent first. */
  results: {
    eventId: string;
    startsAt: string;
    opponent: string;
    isHome: boolean | null;
    ourScore: number;
    theirScore: number;
    outcome: Outcome;
  }[];
}

/**
 * One team's record, optionally within one competition.
 *
 * ABANDONED matches are fetched and then excluded by the domain function rather
 * than filtered out in SQL, so the reason a count looks low is visible in one
 * place instead of hidden in a `where`.
 */
export async function getTeamRecord(
  context: AuthContext,
  teamId: string,
  options: { competitionId?: string } = {},
): Promise<TeamSeasonRecord> {
  assertPermission(context, "attendance.read");

  const matches = await listMatches(context, {
    teamId,
    competitionId: options.competitionId,
    only: "PLAYED",
  });

  /*
    `only: "PLAYED"` already excludes a pending result, but the non-null
    assertions that would rely on that are exactly the kind that survive a
    refactor of the filter above and then throw in production. Narrowed once,
    here, into a shape the rest of the function can trust.
  */
  const scored = matches.flatMap((match) => {
    const result = match.result;
    if (!result || result.ourScore === null || result.theirScore === null) return [];
    if (result.outcome === null) return [];
    // `outcome` is carried along rather than read back off `result`, so nothing
    // downstream needs a non-null assertion to use it.
    return [
      {
        match,
        state: result.state,
        ourScore: result.ourScore,
        theirScore: result.theirScore,
        outcome: result.outcome,
      },
    ];
  });

  const facts = scored.map((entry) => ({
    playedAt: entry.match.startsAt,
    ourScore: entry.ourScore,
    theirScore: entry.theirScore,
    // A forfeit counts; a match abandoned part-way does not.
    counts: entry.state !== "ABANDONED",
  }));

  const record = teamRecord(facts);

  return {
    ...record,
    results: scored
      .filter((entry) => entry.state !== "ABANDONED")
      .map((entry) => ({
        eventId: entry.match.eventId,
        startsAt: entry.match.startsAt,
        opponent: entry.match.opponent,
        isHome: entry.match.isHome,
        ourScore: entry.ourScore,
        theirScore: entry.theirScore,
        outcome: entry.outcome,
      })),
  };
}

/* -------------------------------------------------------------------------- */
/* Squad, for assigning a sheet's shirt numbers                               */
/* -------------------------------------------------------------------------- */

export interface SquadMember {
  athleteId: string;
  name: string;
  /** The number on file, offered as a suggestion and never trusted as a key. */
  jerseyNumber: number | null;
}

/**
 * Who could appear on this team's game sheet.
 *
 * Current members only: `left_at` is what stops a player who moved up in
 * January from being offered for a sheet from March. The number comes from
 * `athlete_teams` rather than from the athlete, because a number belongs to a
 * squad — the same child is 7 for the Under 13s and 23 for the Under 15s.
 */
export async function listSquad(
  context: AuthContext,
  teamId: string,
): Promise<SquadMember[]> {
  assertPermission(context, "attendance.read");

  /*
    Two queries rather than an embed: `Relationships` is empty in our
    hand-written `Database` type, so PostgREST embedding does not typecheck.
    Two round trips for a squad of twelve is not the problem worth solving.
  */
  const { data: links, error } = await context.db
    .from("athlete_teams")
    .select("athlete_id, jersey_number")
    .eq("tenant_id", context.tenant.id)
    .eq("team_id", teamId)
    .is("left_at", null);
  if (error) throw fromDatabaseError(error, { resource: "athlete" });

  const athleteIds = (links ?? []).map((link) => link.athlete_id);
  if (athleteIds.length === 0) return [];

  const { data: athletes, error: athleteError } = await context.db
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("tenant_id", context.tenant.id)
    .in("id", athleteIds)
    .is("deleted_at", null);
  if (athleteError) throw fromDatabaseError(athleteError, { resource: "athlete" });

  const nameById = new Map(
    (athletes ?? []).map((row) => [row.id, `${row.last_name} ${row.first_name}`]),
  );

  return (links ?? [])
    .flatMap((link) => {
      const name = nameById.get(link.athlete_id);
      return name
        ? [{ athleteId: link.athlete_id, name, jerseyNumber: link.jersey_number }]
        : [];
    })
    .sort((a, b) => {
      // By number where there is one, so the list reads like the team sheet.
      if (a.jerseyNumber !== null && b.jerseyNumber !== null) {
        return a.jerseyNumber - b.jerseyNumber;
      }
      if (a.jerseyNumber !== null) return -1;
      if (b.jerseyNumber !== null) return 1;
      return a.name.localeCompare(b.name);
    });
}

/* -------------------------------------------------------------------------- */
/* One athlete's matches                                                      */
/* -------------------------------------------------------------------------- */

export interface AthleteMatchLine {
  eventId: string;
  teamId: string;
  teamName: string;
  startsAt: string;
  opponent: string;
  isHome: boolean | null;
  result: { ourScore: number; theirScore: number; outcome: Outcome } | null;
  /** What a game sheet can tell you, so always present. */
  points: number;
  fouls: number;
  twoPointMade: number;
  threePointMade: number;
  freeThrowMade: number;
  /**
   * Null for a line that came off a referto: the document records no minutes,
   * rebounds or assists, and a zero would read as "none" rather than "unknown".
   */
  detail: {
    minutes: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    efficiency: number;
  } | null;
}

/**
 * Every match this athlete has a line in, most recent first.
 *
 * The counterpart to clicking a name in a match's box score: from the player's
 * page, back out to any of the games the average is made of. Five queries
 * regardless of how long the season is.
 */
export async function listAthleteMatches(
  context: AuthContext,
  athleteId: string,
): Promise<AthleteMatchLine[]> {
  assertPermission(context, "attendance.read");

  const { data: lines, error } = await context.db
    .from("match_box_scores")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId);
  if (error) throw fromDatabaseError(error, { resource: "box score" });
  if (!lines || lines.length === 0) return [];

  const { data: registers } = await context.db
    .from("attendance_registers")
    .select("id, event_id, team_id, starts_at")
    .eq("tenant_id", context.tenant.id)
    .in("id", lines.map((line) => line.register_id));

  /*
    Only registers that belong to a calendar event can be linked to a match
    page, which is keyed on one. A match register always has an event — the
    schema's `registers_match_has_event` says so — so anything filtered out
    here is a training register, which has no box score anyway.
  */
  const byRegister = new Map(
    (registers ?? [])
      .filter((row): row is typeof row & { event_id: string } => row.event_id !== null)
      .map((row) => [row.id, row]),
  );

  const eventIds = [...new Set([...byRegister.values()].map((row) => row.event_id))];
  if (eventIds.length === 0) return [];

  const teamIds = [...new Set([...byRegister.values()].map((row) => row.team_id))];
  const [{ data: events }, { data: teams }, { data: results }] = await Promise.all([
    context.db
      .from("calendar_events")
      .select("id, opponent, is_home, start_at")
      .eq("tenant_id", context.tenant.id)
      .in("id", eventIds),
    context.db
      .from("teams")
      .select("id, name")
      .eq("tenant_id", context.tenant.id)
      .in("id", teamIds),
    context.db
      .from("match_results")
      .select("event_id, team_id, state, our_score, their_score")
      .eq("tenant_id", context.tenant.id)
      .in("event_id", eventIds),
  ]);

  const eventById = new Map((events ?? []).map((row) => [row.id, row]));
  const teamById = new Map((teams ?? []).map((row) => [row.id, row.name]));
  const resultByKey = new Map(
    (results ?? []).map((row) => [`${row.event_id}:${row.team_id}`, row]),
  );

  return lines
    .flatMap((line) => {
      const register = byRegister.get(line.register_id);
      if (!register) return [];
      const event = eventById.get(register.event_id);
      if (!event || event.opponent === null) return [];

      const result = resultByKey.get(`${register.event_id}:${register.team_id}`);
      const scored =
        result && result.our_score !== null && result.their_score !== null
          ? {
              ourScore: result.our_score,
              theirScore: result.their_score,
              outcome: outcomeOf({
                ourScore: result.our_score,
                theirScore: result.their_score,
              }),
            }
          : null;

      return [
        {
          eventId: register.event_id,
          teamId: register.team_id,
          teamName: teamById.get(register.team_id) ?? "",
          startsAt: event.start_at,
          opponent: event.opponent,
          isHome: event.is_home,
          result: scored,
          points: line.points,
          fouls: line.fouls_committed,
          twoPointMade: line.two_point_made,
          threePointMade: line.three_point_made,
          freeThrowMade: line.free_throw_made,
          detail:
            line.source === "REFERTO"
              ? null
              : {
                  minutes: line.seconds_played / 60,
                  rebounds: line.rebounds,
                  assists: line.assists,
                  steals: line.steals,
                  blocks: line.blocks,
                  turnovers: line.turnovers,
                  efficiency: line.efficiency,
                },
        },
      ];
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}
