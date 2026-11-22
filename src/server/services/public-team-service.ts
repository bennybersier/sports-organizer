import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fromDatabaseError } from "@/lib/errors";
import { outcomeOf, type Outcome } from "@/domain/competitions/record";
import { addDays, startOfDayInZone, todayInZone } from "@/domain/scheduling/timezone";
import { teamRecordFrom, type MatchListItem } from "@/server/services/match-service";
import type { GenderCategory, MatchResultState } from "@/types/database";

/**
 * The parents' page for one team, reached by its share link.
 *
 * ## What this is allowed to say
 *
 * The audience is anybody holding the link — parents, grandparents, whoever a
 * WhatsApp group forwarded it to. So the page carries what a club would print
 * on a noticeboard and nothing that is about a person:
 *
 *   - the team, its season and the club's name
 *   - the squad, as first name and last initial, for athletes whose family
 *     has not opted out (`athletes.public_consent`)
 *   - fixtures: when, against whom, home or away, where, and the score
 *   - per match, the box score: shirt, name as above, makes, points, fouls —
 *     opted-out players are summed into one unnamed line
 *   - the team's own record
 *   - when and where it trains, for the next few weeks
 *
 * Deliberately absent: anything else about an athlete (surnames, dates of
 * birth, call-ups, attendance, minutes and advanced stats, evaluations —
 * these are children), coaches' names and contact details, and internal
 * notes on the team, the event or the result.
 *
 * ## Why the secret-key client
 *
 * There is no session here, and no `anon` policy opens these tables — on
 * purpose, so the token can unlock this page and nothing else. Authorization is
 * the token lookup itself. Every query below is then pinned to that team's
 * tenant, selects named columns rather than `*`, and the result is copied into
 * the shape below field by field: a column added to a table later cannot leak
 * here by accident.
 */

export interface PublicVenue {
  name: string;
  /** One line, or null when the hall has no address on file. */
  address: string | null;
}

export interface PublicMatch {
  /** For the link to the match's own page; only resolves with the team's token. */
  eventId: string;
  startsAt: string;
  opponent: string;
  isHome: boolean | null;
  competition: string | null;
  venue: PublicVenue | null;
  result: {
    state: MatchResultState;
    ourScore: number | null;
    theirScore: number | null;
    ourPeriods: number[] | null;
    theirPeriods: number[] | null;
    outcome: Outcome | null;
  } | null;
}

export interface PublicSession {
  startsAt: string;
  endsAt: string;
  venue: PublicVenue | null;
  cancelled: boolean;
}

export interface PublicTeamPage {
  clubName: string;
  /** Every time on the page is read on the club's clock, not the visitor's. */
  timeZone: string;
  team: {
    name: string;
    sport: string;
    category: string | null;
    ageGroup: string | null;
    gender: GenderCategory;
    color: string;
    season: string | null;
  };
  homeVenue: PublicVenue | null;
  /** "Marco R.", alphabetical. Only athletes with publication consent. */
  roster: { athleteId: string; name: string }[];
  record: {
    played: number;
    won: number;
    lost: number;
    drawn: number;
    pointsFor: number;
    pointsAgainst: number;
    pointDifference: number;
    perGame: { scored: number; conceded: number } | null;
    form: Outcome[];
  };
  /** Soonest first. */
  upcoming: PublicMatch[];
  /** Most recent first. */
  past: PublicMatch[];
  /** Soonest first, `TRAINING_DAYS` ahead. */
  training: PublicSession[];
}

/** How far ahead the training list looks. Two weeks covers "is it on Thursday?". */
const TRAINING_DAYS = 14;

/** What `setTeamPublicPage` issues: 24 random bytes, base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

/**
 * The page for a share token, or null for any token that does not open one.
 *
 * Null covers "never existed", "revoked", "team archived" and "club
 * suspended" alike: the page that renders it says the link no longer works,
 * and telling a stranger which of those it was would be telling them
 * something.
 */
/**
 * The team a token opens, or null. The one place a token is checked, so the
 * team page and the match page cannot disagree about which links still work.
 */
async function teamForToken(token: string) {
  if (!TOKEN_SHAPE.test(token)) return null;

  const { data: team, error } = await createAdminClient()
    .from("teams")
    .select(
      "id, tenant_id, season_id, name, sport, category, age_group, gender, color, home_gym_id, tracks_box_score, status, deleted_at",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "team" });
  if (!team || team.deleted_at !== null || team.status === "ARCHIVED") return null;
  return team;
}

type HallVenue = PublicVenue & { hasStreet: boolean };

/**
 * Where a match is played.
 *
 * A saved hall with a street address wins: picking it is the deliberate
 * choice, and correcting the hall corrects every match there. Text typed on
 * the match fills in when there is no hall, or the hall has no street on file
 * — an away game at a hall nobody saved, above all.
 */
function matchVenue(hall: HallVenue | null, typed: string | null): PublicVenue | null {
  const text = typed?.trim() || null;
  if (hall?.hasStreet) return { name: hall.name, address: hall.address };
  if (hall) return { name: hall.name, address: text ?? hall.address };
  return text ? { name: text, address: null } : null;
}

/** A hall's row as a venue, remembering whether it has a street on file. */
function hallVenue(gym: {
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
}): HallVenue {
  const place = [gym.postal_code, gym.city].filter(Boolean).join(" ");
  const address = [gym.address_line1, gym.address_line2, place].filter(Boolean).join(", ");
  return { name: gym.name, address: address || null, hasStreet: Boolean(gym.address_line1) };
}

/** "Marco R." — the only form an athlete's name takes on these pages. */
function publicName(athlete: { first_name: string; last_name: string }): string {
  const initial = athlete.last_name.trim().charAt(0).toLocaleUpperCase();
  return initial ? `${athlete.first_name.trim()} ${initial}.` : athlete.first_name.trim();
}

export async function getPublicTeamPage(token: string): Promise<PublicTeamPage | null> {
  const team = await teamForToken(token);
  if (!team) return null;

  const db = createAdminClient();

  const tenantId = team.tenant_id;

  const [{ data: tenant }, { data: season }, { data: links }, { data: squad }] = await Promise.all([
    db
      .from("tenants")
      .select("name, timezone, status, deleted_at")
      .eq("id", tenantId)
      .maybeSingle(),
    db
      .from("seasons")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("id", team.season_id)
      .maybeSingle(),
    db
      .from("calendar_event_teams")
      .select("event_id")
      .eq("tenant_id", tenantId)
      .eq("team_id", team.id),
    // Current members only: someone who left in January is not in the squad.
    db
      .from("athlete_teams")
      .select("athlete_id")
      .eq("tenant_id", tenantId)
      .eq("team_id", team.id)
      .is("left_at", null),
  ]);

  if (!tenant || tenant.status !== "ACTIVE" || tenant.deleted_at !== null) return null;

  const zone = tenant.timezone;
  const now = new Date();
  const today = todayInZone(zone);
  // Midnight on the club's clock, not UTC's.
  const trainingUntil = startOfDayInZone(addDays(today, TRAINING_DAYS), zone).toISOString();
  const eventIds = (links ?? []).map((link) => link.event_id);

  const athleteIds = (squad ?? []).map((row) => row.athlete_id);

  const [{ data: events }, { data: results }, { data: versions }, { data: athletes }] =
    await Promise.all([
      eventIds.length > 0
        ? db
            .from("calendar_events")
            .select("id, start_at, end_at, gym_id, location, opponent, is_home, competition")
            .eq("tenant_id", tenantId)
            .in("id", eventIds)
            // Same test as the app's match list: an opponent makes it a match.
            .not("opponent", "is", null)
            .neq("status", "CANCELLED")
        : Promise.resolve({ data: [] }),
      eventIds.length > 0
        ? db
            .from("match_results")
            .select("event_id, state, our_score, their_score, our_periods, their_periods")
            .eq("tenant_id", tenantId)
            .eq("team_id", team.id)
            .in("event_id", eventIds)
        : Promise.resolve({ data: [] }),
      // Only the published schedule: a draft is not what the club is doing.
      db
        .from("schedule_versions")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "PUBLISHED")
        .gte("applies_until", today),
      athleteIds.length > 0
        ? db
            .from("athletes")
            // Names only; the surname is cut to an initial below, before
            // anything reaches the page.
            .select("id, first_name, last_name")
            .eq("tenant_id", tenantId)
            .in("id", athleteIds)
            .eq("public_consent", true)
            .is("deleted_at", null)
            .neq("status", "ARCHIVED")
        : Promise.resolve({ data: [] }),
    ]);

  const versionIds = (versions ?? []).map((version) => version.id);
  const { data: sessions } =
    versionIds.length > 0
      ? await db
          .from("schedule_entries")
          .select("start_at, end_at, gym_id, status")
          .eq("tenant_id", tenantId)
          .eq("team_id", team.id)
          .in("schedule_version_id", versionIds)
          .gte("end_at", now.toISOString())
          .lt("start_at", trainingUntil)
          .order("start_at")
      : { data: [] };

  const gymIds = [
    ...new Set(
      [
        team.home_gym_id,
        ...(events ?? []).map((event) => event.gym_id),
        ...(sessions ?? []).map((session) => session.gym_id),
      ].filter((id): id is string => id !== null),
    ),
  ];
  const { data: gyms } =
    gymIds.length > 0
      ? await db
          .from("gyms")
          .select("id, name, address_line1, address_line2, postal_code, city")
          .eq("tenant_id", tenantId)
          .in("id", gymIds)
      : { data: [] };

  const venueById = new Map((gyms ?? []).map((gym) => [gym.id, hallVenue(gym)]));
  const venueOf = (gymId: string | null): HallVenue | null =>
    gymId ? (venueById.get(gymId) ?? null) : null;

  const resultByEvent = new Map((results ?? []).map((row) => [row.event_id, row]));

  const matches = (events ?? []).flatMap((event) => {
    if (event.opponent === null) return [];
    const row = resultByEvent.get(event.id);
    const outcome =
      row && row.our_score !== null && row.their_score !== null
        ? outcomeOf({ ourScore: row.our_score, theirScore: row.their_score })
        : null;

    const match: PublicMatch = {
      eventId: event.id,
      startsAt: event.start_at,
      opponent: event.opponent,
      isHome: event.is_home,
      competition: event.competition,
      venue: matchVenue(venueOf(event.gym_id), event.location),
      result: row
        ? {
            state: row.state,
            ourScore: row.our_score,
            theirScore: row.their_score,
            ourPeriods: row.our_periods,
            theirPeriods: row.their_periods,
            outcome,
          }
        : null,
    };
    return [{ match, endsAt: event.end_at }];
  });

  const nowIso = now.toISOString();
  const upcoming = matches
    // Still to come until it ends — or, if the score is in already, not even then.
    .filter(
      (entry) =>
        entry.endsAt >= nowIso && (!entry.match.result || entry.match.result.state === "PENDING"),
    )
    .map((entry) => entry.match)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcomingSet = new Set(upcoming);
  const past = matches
    .map((entry) => entry.match)
    .filter((match) => !upcomingSet.has(match))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  /*
    The record is the app's own arithmetic, so the parents' page and the
    coach's never disagree. It wants the app's match shape; only the fields it
    reads are meaningful here.
  */
  const record = teamRecordFrom(
    past.map((match): MatchListItem => ({
      eventId: match.startsAt,
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      startsAt: match.startsAt,
      endsAt: match.startsAt,
      opponent: match.opponent,
      isHome: match.isHome,
      competition: match.competition,
      gymName: null,
      location: null,
      registerId: null,
      tracksBoxScore: false,
      result: match.result ? { ...match.result, notes: null } : null,
    })),
  );

  return {
    clubName: tenant.name,
    timeZone: zone,
    team: {
      name: team.name,
      sport: team.sport,
      category: team.category,
      ageGroup: team.age_group,
      gender: team.gender,
      color: team.color,
      season: season?.name ?? null,
    },
    homeVenue: venueOf(team.home_gym_id),
    roster: (athletes ?? [])
      .map((athlete) => ({ athleteId: athlete.id, name: publicName(athlete) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    record: {
      played: record.played,
      won: record.won,
      lost: record.lost,
      drawn: record.drawn,
      pointsFor: record.pointsFor,
      pointsAgainst: record.pointsAgainst,
      pointDifference: record.pointDifference,
      perGame: record.perGame,
      form: record.form,
    },
    upcoming,
    past,
    training: (sessions ?? []).map((session) => ({
      startsAt: session.start_at,
      endsAt: session.end_at,
      venue: venueOf(session.gym_id),
      cancelled: session.status === "CANCELLED",
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* One match                                                                  */
/* -------------------------------------------------------------------------- */

export interface PublicBoxScoreLine {
  /** For the link to the player's page. Null on the folded line. */
  athleteId: string | null;
  /** "Marco R.", or null for the line that folds together opted-out players. */
  name: string | null;
  /** How many players a folded line stands for; 1 otherwise. */
  players: number;
  /** The shirt this team gives them. Null on the folded line, or when unset. */
  shirt: number | null;
  twos: number;
  threes: number;
  freeThrows: number;
  points: number;
  fouls: number;
}

export interface PublicMatchPage {
  clubName: string;
  teamName: string;
  teamColor: string;
  timeZone: string;
  match: PublicMatch;
  /**
   * Highest scorer first. Empty when the team keeps no scoresheet or none has
   * been entered. Players whose family opted out are summed into one unnamed
   * line, last, so the totals still match the score.
   */
  boxScore: PublicBoxScoreLine[];
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One match of the token's team, or null.
 *
 * The event id alone opens nothing: it must be one of this team's matches,
 * so a token for the U13 cannot be walked over to another team's games.
 */
export async function getPublicMatchPage(
  token: string,
  eventId: string,
): Promise<PublicMatchPage | null> {
  if (!UUID_SHAPE.test(eventId)) return null;
  const team = await teamForToken(token);
  if (!team) return null;

  const db = createAdminClient();
  const tenantId = team.tenant_id;

  const [{ data: tenant }, { data: link }, { data: event }, { data: result }, { data: register }] =
    await Promise.all([
      db
        .from("tenants")
        .select("name, timezone, status, deleted_at")
        .eq("id", tenantId)
        .maybeSingle(),
      db
        .from("calendar_event_teams")
        .select("event_id")
        .eq("tenant_id", tenantId)
        .eq("team_id", team.id)
        .eq("event_id", eventId)
        .maybeSingle(),
      db
        .from("calendar_events")
        .select("id, start_at, gym_id, location, opponent, is_home, competition, status")
        .eq("tenant_id", tenantId)
        .eq("id", eventId)
        .maybeSingle(),
      db
        .from("match_results")
        .select("state, our_score, their_score, our_periods, their_periods")
        .eq("tenant_id", tenantId)
        .eq("team_id", team.id)
        .eq("event_id", eventId)
        .maybeSingle(),
      db
        .from("attendance_registers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("team_id", team.id)
        .eq("event_id", eventId)
        .maybeSingle(),
    ]);

  if (!tenant || tenant.status !== "ACTIVE" || tenant.deleted_at !== null) return null;
  if (!link || !event || event.opponent === null || event.status === "CANCELLED") return null;

  const [{ data: gym }, { data: lines }] = await Promise.all([
    event.gym_id
      ? db
          .from("gyms")
          .select("name, address_line1, address_line2, postal_code, city")
          .eq("tenant_id", tenantId)
          .eq("id", event.gym_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    register && team.tracks_box_score
      ? db
          .from("match_box_scores")
          // The counting stats a scoresheet records. Minutes, plus-minus and
          // the rest stay with the coach.
          .select(
            "athlete_id, two_point_made, three_point_made, free_throw_made, points, fouls_committed",
          )
          .eq("tenant_id", tenantId)
          .eq("register_id", register.id)
      : Promise.resolve({ data: [] }),
  ]);

  const athleteIds = (lines ?? []).map((line) => line.athlete_id);
  const [{ data: athletes }, { data: memberships }] =
    athleteIds.length > 0
      ? await Promise.all([
          db
            .from("athletes")
            .select("id, first_name, last_name, public_consent")
            .eq("tenant_id", tenantId)
            .in("id", athleteIds),
          // A number belongs to the membership, not the person: this team's.
          db
            .from("athlete_teams")
            .select("athlete_id, jersey_number, left_at")
            .eq("tenant_id", tenantId)
            .eq("team_id", team.id)
            .in("athlete_id", athleteIds),
        ])
      : [{ data: [] }, { data: [] }];
  // A current membership's number wins over one from a stint that has ended.
  const shirtOf = new Map<string, number | null>();
  for (const row of [...(memberships ?? [])].sort(
    (a, b) => Number(a.left_at === null) - Number(b.left_at === null),
  )) {
    shirtOf.set(row.athlete_id, row.jersey_number);
  }
  const named = new Map(
    (athletes ?? [])
      .filter((athlete) => athlete.public_consent)
      .map((athlete) => [athlete.id, publicName(athlete)]),
  );

  const boxScore: PublicBoxScoreLine[] = [];
  const folded: PublicBoxScoreLine = {
    athleteId: null,
    name: null,
    players: 0,
    shirt: null,
    twos: 0,
    threes: 0,
    freeThrows: 0,
    points: 0,
    fouls: 0,
  };
  for (const line of lines ?? []) {
    const stats = {
      twos: line.two_point_made,
      threes: line.three_point_made,
      freeThrows: line.free_throw_made,
      points: line.points,
      fouls: line.fouls_committed,
    };
    const name = named.get(line.athlete_id);
    if (name) {
      boxScore.push({
        athleteId: line.athlete_id,
        name,
        players: 1,
        shirt: shirtOf.get(line.athlete_id) ?? null,
        ...stats,
      });
    } else {
      folded.players += 1;
      folded.twos += stats.twos;
      folded.threes += stats.threes;
      folded.freeThrows += stats.freeThrows;
      folded.points += stats.points;
      folded.fouls += stats.fouls;
    }
  }
  boxScore.sort((a, b) => b.points - a.points || (a.name ?? "").localeCompare(b.name ?? ""));
  if (folded.players > 0) boxScore.push(folded);


  return {
    clubName: tenant.name,
    teamName: team.name,
    teamColor: team.color,
    timeZone: tenant.timezone,
    match: {
      eventId: event.id,
      startsAt: event.start_at,
      opponent: event.opponent,
      isHome: event.is_home,
      competition: event.competition,
      venue: matchVenue(gym ? hallVenue(gym) : null, event.location),
      result: result
        ? {
            state: result.state,
            ourScore: result.our_score,
            theirScore: result.their_score,
            ourPeriods: result.our_periods,
            theirPeriods: result.their_periods,
            outcome:
              result.our_score !== null && result.their_score !== null
                ? outcomeOf({
                    ourScore: result.our_score,
                    theirScore: result.their_score,
                  })
                : null,
          }
        : null,
    },
    boxScore,
  };
}

/* -------------------------------------------------------------------------- */
/* One player                                                                 */
/* -------------------------------------------------------------------------- */

export interface PublicPlayerMatch {
  eventId: string;
  startsAt: string;
  opponent: string;
  isHome: boolean | null;
  result: { ourScore: number; theirScore: number; outcome: Outcome } | null;
  points: number;
  fouls: number;
  twos: number;
  threes: number;
  freeThrows: number;
}

export interface PublicPlayerPage {
  clubName: string;
  teamName: string;
  teamColor: string;
  timeZone: string;
  /** "Marco R." */
  name: string;
  shirt: number | null;
  /** Most recent first. This team's matches only: the link is the team's. */
  matches: PublicPlayerMatch[];
}

/**
 * A player's own stats on the parents' page, or null.
 *
 * Opens only for a current member of the token's team whose family has not
 * opted out — the same people the squad list names — and only with the
 * figures a scoresheet records, as on the match page. The athlete id alone
 * opens nothing: it has to be one of this team's.
 */
export async function getPublicPlayerPage(
  token: string,
  athleteId: string,
): Promise<PublicPlayerPage | null> {
  if (!UUID_SHAPE.test(athleteId)) return null;
  const team = await teamForToken(token);
  if (!team) return null;

  const db = createAdminClient();
  const tenantId = team.tenant_id;

  const [{ data: tenant }, { data: membership }, { data: athlete }, { data: registers }] =
    await Promise.all([
      db
        .from("tenants")
        .select("name, timezone, status, deleted_at")
        .eq("id", tenantId)
        .maybeSingle(),
      db
        .from("athlete_teams")
        .select("jersey_number")
        .eq("tenant_id", tenantId)
        .eq("team_id", team.id)
        .eq("athlete_id", athleteId)
        .is("left_at", null)
        .maybeSingle(),
      db
        .from("athletes")
        .select("first_name, last_name, public_consent, status, deleted_at")
        .eq("tenant_id", tenantId)
        .eq("id", athleteId)
        .maybeSingle(),
      // This team's match registers: a box score line hangs off one.
      db
        .from("attendance_registers")
        .select("id, event_id")
        .eq("tenant_id", tenantId)
        .eq("team_id", team.id)
        .not("event_id", "is", null),
    ]);

  if (!tenant || tenant.status !== "ACTIVE" || tenant.deleted_at !== null) return null;
  if (!membership || !athlete) return null;
  if (!athlete.public_consent || athlete.deleted_at !== null || athlete.status === "ARCHIVED") {
    return null;
  }

  const eventByRegister = new Map(
    (registers ?? [])
      .filter((row): row is typeof row & { event_id: string } => row.event_id !== null)
      .map((row) => [row.id, row.event_id]),
  );
  const registerIds = [...eventByRegister.keys()];

  const { data: lines } =
    registerIds.length > 0 && team.tracks_box_score
      ? await db
          .from("match_box_scores")
          .select(
            "register_id, two_point_made, three_point_made, free_throw_made, points, fouls_committed",
          )
          .eq("tenant_id", tenantId)
          .eq("athlete_id", athleteId)
          .in("register_id", registerIds)
      : { data: [] };

  const eventIds = [
    ...new Set((lines ?? []).map((line) => eventByRegister.get(line.register_id)!)),
  ];
  const [{ data: events }, { data: results }] =
    eventIds.length > 0
      ? await Promise.all([
          db
            .from("calendar_events")
            .select("id, start_at, opponent, is_home")
            .eq("tenant_id", tenantId)
            .in("id", eventIds)
            .not("opponent", "is", null)
            .neq("status", "CANCELLED"),
          db
            .from("match_results")
            .select("event_id, our_score, their_score")
            .eq("tenant_id", tenantId)
            .eq("team_id", team.id)
            .in("event_id", eventIds),
        ])
      : [{ data: [] }, { data: [] }];

  const eventById = new Map((events ?? []).map((event) => [event.id, event]));
  const resultByEvent = new Map((results ?? []).map((row) => [row.event_id, row]));

  const matches = (lines ?? [])
    .flatMap((line): PublicPlayerMatch[] => {
      const eventId = eventByRegister.get(line.register_id)!;
      const event = eventById.get(eventId);
      if (!event || event.opponent === null) return [];
      const result = resultByEvent.get(eventId);
      return [
        {
          eventId,
          startsAt: event.start_at,
          opponent: event.opponent,
          isHome: event.is_home,
          result:
            result && result.our_score !== null && result.their_score !== null
              ? {
                  ourScore: result.our_score,
                  theirScore: result.their_score,
                  outcome: outcomeOf({
                    ourScore: result.our_score,
                    theirScore: result.their_score,
                  }),
                }
              : null,
          points: line.points,
          fouls: line.fouls_committed,
          twos: line.two_point_made,
          threes: line.three_point_made,
          freeThrows: line.free_throw_made,
        },
      ];
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  return {
    clubName: tenant.name,
    teamName: team.name,
    teamColor: team.color,
    timeZone: tenant.timezone,
    name: publicName(athlete),
    shirt: membership.jersey_number,
    matches,
  };
}
