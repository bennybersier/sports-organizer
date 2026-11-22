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
 *   - fixtures: when, against whom, home or away, where, and the score
 *   - the team's own record
 *   - when and where it trains, for the next few weeks
 *
 * Deliberately absent: every athlete (names, numbers, call-ups, attendance,
 * box scores, evaluations — these are children), coaches' names and contact
 * details, internal notes on the team, the event or the result, and ids that
 * would mean something to the rest of the app.
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
  record: {
    played: number;
    won: number;
    lost: number;
    drawn: number;
    pointsFor: number;
    pointsAgainst: number;
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
export async function getPublicTeamPage(token: string): Promise<PublicTeamPage | null> {
  if (!TOKEN_SHAPE.test(token)) return null;

  const db = createAdminClient();

  const { data: team, error } = await db
    .from("teams")
    .select(
      "id, tenant_id, season_id, name, sport, category, age_group, gender, color, home_gym_id, status, deleted_at",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "team" });
  if (!team || team.deleted_at !== null || team.status === "ARCHIVED") return null;

  const tenantId = team.tenant_id;

  const [{ data: tenant }, { data: season }, { data: links }] = await Promise.all([
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
  ]);

  if (!tenant || tenant.status !== "ACTIVE" || tenant.deleted_at !== null) return null;

  const zone = tenant.timezone;
  const now = new Date();
  const today = todayInZone(zone);
  // Midnight on the club's clock, not UTC's.
  const trainingUntil = startOfDayInZone(addDays(today, TRAINING_DAYS), zone).toISOString();
  const eventIds = (links ?? []).map((link) => link.event_id);

  const [{ data: events }, { data: results }, { data: versions }] = await Promise.all([
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

  const venueById = new Map(
    (gyms ?? []).map((gym) => {
      const place = [gym.postal_code, gym.city].filter(Boolean).join(" ");
      const address = [gym.address_line1, gym.address_line2, place].filter(Boolean).join(", ");
      return [gym.id, { name: gym.name, address: address || null }];
    }),
  );
  const venueOf = (gymId: string | null): PublicVenue | null =>
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
      startsAt: event.start_at,
      opponent: event.opponent,
      isHome: event.is_home,
      competition: event.competition,
      // An away hall is rarely one of ours; the event's free-text location is
      // where the coach wrote it down.
      venue:
        venueOf(event.gym_id) ??
        (event.location ? { name: event.location, address: null } : null),
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
    past.map(
      (match): MatchListItem => ({
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
      }),
    ),
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
    record: {
      played: record.played,
      won: record.won,
      lost: record.lost,
      drawn: record.drawn,
      pointsFor: record.pointsFor,
      pointsAgainst: record.pointsAgainst,
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
