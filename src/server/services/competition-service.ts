import "server-only";

import { NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, diffFields, recordAudit } from "@/server/services/audit-service";
import { createEvent, deleteEvent, updateEvent } from "@/server/services/event-service";
import { getTeam } from "@/server/services/team-service";
import { planLeagueFixtures, type CompetitionEntry } from "@/domain/competitions/fixtures";
import { toInstant } from "@/domain/scheduling/timezone";
import { toMinutes } from "@/domain/availability";
import {
  buildListResult,
  paginationRange,
  searchAcross,
  type ListParams,
  type ListResult,
} from "@/server/services/list-query";
import type {
  CreateCompetitionInput,
  ScheduleFixtureInput,
  SetEntriesInput,
  UpdateCompetitionInput,
} from "@/lib/validation/competition";
import type {
  CompetitionEntryRow,
  CompetitionRow,
  FixtureRow,
} from "@/types/database";

const CONFLICTS = {
  competitions_team_name_uniq: "That team is already entered in a competition with this name.",
  competition_entries_name_uniq: "That club is already in this competition.",
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listCompetitions(
  context: AuthContext,
  params: ListParams,
  filters: { seasonId?: string; teamId?: string; status?: string } = {},
): Promise<ListResult<CompetitionRow & { team_name: string | null; entry_count: number }>> {
  assertPermission(context, "competitions.read");

  const { from, to } = paginationRange(params);
  let query = context.db
    .from("competitions")
    .select("*, teams(name), competition_entries(count)", { count: "exact" })
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  if (params.q) query = query.or(searchAcross(["name"], params.q));
  if (filters.seasonId) query = query.eq("season_id", filters.seasonId);
  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  if (filters.status) query = query.eq("status", filters.status as CompetitionRow["status"]);

  const { data, error, count } = await query.order("name").range(from, to);
  if (error) throw fromDatabaseError(error, { resource: "competition" });

  const rows = (data ?? []).map((row) => {
    const { teams, competition_entries: entries, ...rest } = row as typeof row & {
      teams: { name: string } | null;
      competition_entries: { count: number }[];
    };
    return {
      ...(rest as CompetitionRow),
      team_name: teams?.name ?? null,
      entry_count: entries?.[0]?.count ?? 0,
    };
  });

  return buildListResult(
    rows,
    count ?? 0,
    params,
    Boolean(params.q || filters.seasonId || filters.teamId || filters.status),
  );
}

export async function getCompetition(context: AuthContext, id: string): Promise<CompetitionRow> {
  assertPermission(context, "competitions.read");

  const { data, error } = await context.db
    .from("competitions")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "competition" });
  if (!data) throw new NotFoundError("competition");
  return data;
}

export async function listEntries(
  context: AuthContext,
  competitionId: string,
): Promise<CompetitionEntryRow[]> {
  assertPermission(context, "competitions.read");

  const { data, error } = await context.db
    .from("competition_entries")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("competition_id", competitionId)
    .order("club_name");

  if (error) throw fromDatabaseError(error, { resource: "competition" });
  return data ?? [];
}

export interface FixtureView extends FixtureRow {
  /** Everyone in it, ours included. */
  participants: { id: string; clubName: string; isUs: boolean }[];
  /** The other club, when there is exactly one. Null while the draw is unknown. */
  opponent: { id: string; clubName: string; town: string | null; venue: string | null } | null;
  isHome: boolean | null;
}

export async function listFixtures(
  context: AuthContext,
  competitionId: string,
): Promise<FixtureView[]> {
  assertPermission(context, "competitions.read");

  const [fixtures, entries, links] = await Promise.all([
    context.db
      .from("fixtures")
      .select("*")
      .eq("tenant_id", context.tenant.id)
      .eq("competition_id", competitionId)
      .order("matchday"),
    listEntries(context, competitionId),
    context.db
      .from("fixture_participants")
      .select("fixture_id, entry_id")
      .eq("tenant_id", context.tenant.id),
  ]);

  if (fixtures.error) throw fromDatabaseError(fixtures.error, { resource: "competition" });

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const participantsByFixture = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    participantsByFixture.set(link.fixture_id, [
      ...(participantsByFixture.get(link.fixture_id) ?? []),
      link.entry_id,
    ]);
  }

  return (fixtures.data ?? []).map((fixture) => {
    const ids = participantsByFixture.get(fixture.id) ?? [];
    const participants = ids
      .map((id) => byId.get(id))
      .filter((entry): entry is CompetitionEntryRow => entry !== undefined)
      .map((entry) => ({ id: entry.id, clubName: entry.club_name, isUs: entry.team_id !== null }));

    const others = participants.filter((entry) => !entry.isUs);
    const opponentEntry = others.length === 1 ? byId.get(others[0].id) : undefined;
    const ours = entries.find((entry) => entry.team_id !== null);

    return {
      ...fixture,
      participants,
      opponent: opponentEntry
        ? {
            id: opponentEntry.id,
            clubName: opponentEntry.club_name,
            town: opponentEntry.town,
            venue: opponentEntry.venue,
          }
        : null,
      // Null rather than false when nobody hosts yet — undecided is not away.
      isHome: fixture.host_entry_id === null ? null : fixture.host_entry_id === ours?.id,
    };
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function toRow(input: CreateCompetitionInput) {
  return {
    season_id: input.seasonId,
    team_id: input.teamId,
    name: input.name,
    format: input.format,
    phase: input.phase,
    parent_id: input.parentId,
    expected_clubs: input.expectedClubs,
    home_buffer_before_minutes: input.homeBufferBeforeMinutes,
    home_buffer_after_minutes: input.homeBufferAfterMinutes,
    notes: input.notes,
  };
}

export async function createCompetition(
  context: AuthContext,
  input: CreateCompetitionInput,
): Promise<CompetitionRow> {
  assertPermission(context, "competitions.create");

  const team = await getTeam(context, input.teamId);

  const { data, error } = await context.db
    .from("competitions")
    .insert({ tenant_id: context.tenant.id, ...toRow(input), created_by: context.user.id })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "competition", conflictMessages: CONFLICTS });

  /*
    Our own team is an entry from the start. Home and away are only computable
    once the club is one of the participants rather than an implicit outsider,
    and asking somebody to add their own team to their own competition would be
    a strange first instruction.
  */
  const { error: entryError } = await context.db.from("competition_entries").insert({
    tenant_id: context.tenant.id,
    competition_id: data.id,
    team_id: team.id,
    club_name: team.name,
    created_by: context.user.id,
  });
  if (entryError) throw fromDatabaseError(entryError, { resource: "competition" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.COMPETITION_CREATED,
    resourceType: "competition",
    resourceId: data.id,
    newValue: { name: data.name, team: team.name, format: data.format, phase: data.phase },
  });

  return data;
}

export async function updateCompetition(
  context: AuthContext,
  input: UpdateCompetitionInput,
): Promise<CompetitionRow> {
  assertPermission(context, "competitions.update");

  const before = await getCompetition(context, input.id);
  const changes = toRow(input);

  const { data, error } = await context.db
    .from("competitions")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "competition", conflictMessages: CONFLICTS });

  const diff = diffFields(before as unknown as Record<string, unknown>, changes);
  if (diff) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.COMPETITION_UPDATED,
      resourceType: "competition",
      resourceId: data.id,
      ...diff,
    });
  }

  return data;
}

export async function archiveCompetition(
  context: AuthContext,
  id: string,
): Promise<CompetitionRow> {
  assertPermission(context, "competitions.delete");

  const { data, error } = await context.db
    .from("competitions")
    .update({ status: "ARCHIVED" as const })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "competition" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.COMPETITION_UPDATED,
    resourceType: "competition",
    resourceId: id,
    oldValue: { status: "ACTIVE" },
    newValue: { status: "ARCHIVED" },
  });

  return data;
}

export async function restoreCompetition(
  context: AuthContext,
  id: string,
): Promise<CompetitionRow> {
  assertPermission(context, "competitions.update");

  const { data, error } = await context.db
    .from("competitions")
    .update({ status: "ACTIVE" as const })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "competition" });
  return data;
}

/**
 * Replaces the opposing clubs.
 *
 * Our own entry is never touched — it is not something the club types, and
 * removing it would make home and away meaningless. Clubs that survive the edit
 * keep their ids, so fixtures already pointing at them still point at them.
 */
export async function setEntries(context: AuthContext, input: SetEntriesInput): Promise<void> {
  assertPermission(context, "competitions.update");
  await getCompetition(context, input.competitionId);

  const existing = await listEntries(context, input.competitionId);
  const ours = existing.filter((entry) => entry.team_id !== null);
  const opponents = existing.filter((entry) => entry.team_id === null);

  const wanted = new Map(input.clubs.map((club) => [club.clubName.toLowerCase(), club]));
  const keep = opponents.filter((entry) => wanted.has(entry.club_name.toLowerCase()));
  const remove = opponents.filter((entry) => !wanted.has(entry.club_name.toLowerCase()));
  const have = new Set(keep.map((entry) => entry.club_name.toLowerCase()));

  if (remove.length > 0) {
    const { error } = await context.db
      .from("competition_entries")
      .delete()
      .eq("tenant_id", context.tenant.id)
      .in(
        "id",
        remove.map((entry) => entry.id),
      );
    if (error) throw fromDatabaseError(error, { resource: "competition" });
  }

  // Town and venue may have been filled in on a club that was already there.
  for (const entry of keep) {
    const club = wanted.get(entry.club_name.toLowerCase())!;
    if (club.town === entry.town && club.venue === entry.venue) continue;
    const { error } = await context.db
      .from("competition_entries")
      .update({ town: club.town, venue: club.venue })
      .eq("tenant_id", context.tenant.id)
      .eq("id", entry.id);
    if (error) throw fromDatabaseError(error, { resource: "competition" });
  }

  const added = input.clubs.filter((club) => !have.has(club.clubName.toLowerCase()));
  if (added.length > 0) {
    const { error } = await context.db.from("competition_entries").insert(
      added.map((club) => ({
        tenant_id: context.tenant.id,
        competition_id: input.competitionId,
        club_name: club.clubName,
        town: club.town,
        venue: club.venue,
        created_by: context.user.id,
      })),
    );
    if (error)
      throw fromDatabaseError(error, { resource: "competition", conflictMessages: CONFLICTS });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.COMPETITION_UPDATED,
    resourceType: "competition",
    resourceId: input.competitionId,
    newValue: { clubs: ours.length + input.clubs.length },
  });
}

/**
 * Plans every match our team owes in this competition.
 *
 * Refuses rather than duplicates when fixtures already exist: regenerating
 * would silently drop dates somebody has already agreed, and the club's own
 * word for that is not "regenerate".
 */
export async function generateFixtures(
  context: AuthContext,
  competitionId: string,
): Promise<number> {
  assertPermission(context, "competitions.create");

  const competition = await getCompetition(context, competitionId);
  const existing = await listFixtures(context, competitionId);
  if (existing.length > 0) return 0;

  const entries = await listEntries(context, competitionId);
  const planned = planLeagueFixtures(
    entries.map(
      (entry): CompetitionEntry => ({
        id: entry.id,
        clubName: entry.club_name,
        isUs: entry.team_id !== null,
      }),
    ),
  );
  if (planned.length === 0) return 0;

  const { data, error } = await context.db
    .from("fixtures")
    .insert(
      planned.map((fixture) => ({
        tenant_id: context.tenant.id,
        competition_id: competitionId,
        matchday: fixture.matchday,
        host_entry_id: fixture.hostEntryId,
        source: "AGREED" as const,
        created_by: context.user.id,
      })),
    )
    .select("id");
  if (error) throw fromDatabaseError(error, { resource: "competition" });

  const { error: linkError } = await context.db.from("fixture_participants").insert(
    data.flatMap((row, index) =>
      planned[index].participantIds.map((entryId) => ({
        tenant_id: context.tenant.id,
        fixture_id: row.id,
        entry_id: entryId,
      })),
    ),
  );
  if (linkError) throw fromDatabaseError(linkError, { resource: "competition" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.FIXTURES_GENERATED,
    resourceType: "competition",
    resourceId: competitionId,
    newValue: { competition: competition.name, fixtures: planned.length },
  });

  return planned.length;
}

/**
 * Gives a fixture a date, or takes it away again.
 *
 * A dated fixture is a commitment, so it appears on the calendar the moment it
 * has one — which is what makes it block the team and hold the hall. Clearing
 * the date removes the event again: an obligation with no date is not something
 * the club's week should be planned around.
 */
export async function scheduleFixture(
  context: AuthContext,
  input: ScheduleFixtureInput,
): Promise<FixtureRow> {
  assertPermission(context, "competitions.update");

  const { data: fixture, error } = await context.db
    .from("fixtures")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "competition" });
  if (!fixture) throw new NotFoundError("fixture");

  const competition = await getCompetition(context, fixture.competition_id);
  const zone = context.tenant.timezone;

  const startsAt =
    input.date && input.startTime
      ? toInstant(input.date, toMinutes(input.startTime), zone).toISOString()
      : null;
  const endsAt =
    input.date && input.startTime
      ? toInstant(input.date, toMinutes(input.startTime) + input.durationMinutes, zone).toISOString()
      : null;

  const hostEntryId = input.hostEntryId ?? fixture.host_entry_id;
  const eventId = await materialise(context, {
    fixture: { ...fixture, host_entry_id: hostEntryId },
    competition,
    startsAt,
    endsAt,
  });

  const { data: updated, error: updateError } = await context.db
    .from("fixtures")
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
      host_entry_id: hostEntryId,
      calendar_event_id: eventId,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();
  if (updateError) throw fromDatabaseError(updateError, { resource: "competition" });

  return updated;
}

/**
 * Writes the fixture onto the calendar, or removes it from it.
 *
 * Goes through the event service rather than the table, so the audit trail, the
 * fixture-field checks and the buffer rules all apply exactly as they do to an
 * event somebody typed by hand.
 */
async function materialise(
  context: AuthContext,
  args: {
    fixture: FixtureRow;
    competition: CompetitionRow;
    startsAt: string | null;
    endsAt: string | null;
  },
): Promise<string | null> {
  const { fixture, competition, startsAt, endsAt } = args;

  if (!startsAt || !endsAt) {
    if (fixture.calendar_event_id) await deleteEvent(context, fixture.calendar_event_id);
    return null;
  }

  const entries = await listEntries(context, competition.id);
  const ours = entries.find((entry) => entry.team_id !== null);
  const host = entries.find((entry) => entry.id === fixture.host_entry_id);

  const { data: links } = await context.db
    .from("fixture_participants")
    .select("entry_id")
    .eq("tenant_id", context.tenant.id)
    .eq("fixture_id", fixture.id);

  const participantIds = new Set((links ?? []).map((link) => link.entry_id));
  const others = entries.filter((entry) => participantIds.has(entry.id) && entry.team_id === null);
  const isHome = host ? host.team_id !== null : null;

  const team = ours?.team_id ? await getTeam(context, ours.team_id) : null;

  const payload = {
    seasonId: competition.season_id,
    type: (competition.format === "CONCENTRATION" ? "TOURNAMENT" : "MATCH") as
      | "TOURNAMENT"
      | "MATCH",
    // "U19 v Virtus" reads the way a fixture list does; an unknown opponent is
    // still worth putting on the calendar, because the hall is still gone.
    title: others.length === 1 ? `${ours?.club_name} v ${others[0].club_name}` : competition.name,
    description: null,
    location: isHome === false ? (host?.venue ?? host?.town ?? null) : null,
    gymId: isHome ? (team?.home_gym_id ?? null) : null,
    trainerId: null,
    startAt: startsAt,
    endAt: endsAt,
    allDay: false,
    color: null,
    allowsGymSharing: false,
    blocksScheduling: false,
    teamIds: ours?.team_id ? [ours.team_id] : [],
    opponent: others.length === 1 ? others[0].club_name : null,
    isHome,
    competition: competition.name,
    // Only our own hall needs holding, and only when we are the ones hosting.
    bufferBeforeMinutes: isHome ? competition.home_buffer_before_minutes : 0,
    bufferAfterMinutes: isHome ? competition.home_buffer_after_minutes : 0,
  };

  if (fixture.calendar_event_id) {
    const event = await updateEvent(context, { ...payload, id: fixture.calendar_event_id });
    return event.id;
  }

  const event = await createEvent(context, payload);
  return event.id;
}
