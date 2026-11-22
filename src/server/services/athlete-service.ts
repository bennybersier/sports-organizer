import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, diffFields, recordAudit } from "@/server/services/audit-service";
import {
  buildListResult,
  paginationRange,
  searchAcross,
  type ListParams,
  type ListResult,
} from "@/server/services/list-query";
import type { CreateAthleteInput, UpdateAthleteInput } from "@/lib/validation/athlete";
import type { AthleteRow } from "@/types/database";

export interface AthleteListItem extends AthleteRow {
  /*
    The shirt comes with the team, not with the athlete: a player who trains up
    an age group wears one number for the U13s and another for the U15s, so
    there is no single number to hang on the person.
  */
  teams: { id: string; name: string; color: string; jerseyNumber: number | null }[];
}

const CONFLICTS = {
  athletes_tenant_email_uniq: "An athlete with that email address already exists.",
};

export async function listAthletes(
  context: AuthContext,
  params: ListParams,
  filters: { teamId?: string; membershipStatus?: string; status?: string } = {},
): Promise<ListResult<AthleteListItem>> {
  assertPermission(context, "athletes.read");
  const { from, to } = paginationRange(params);
  // A club has a few dozen teams: read them alongside the page rather than
  // after it, so the cards' team chips cost one round trip, not two.
  const teamsPromise = tenantTeams(context);

  let query = context.db
    .from("athletes")
    .select("*", { count: "exact" })
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  if (params.q) query = query.or(searchAcross(["first_name", "last_name", "email"], params.q));
  if (filters.membershipStatus) {
    query = query.eq("membership_status", filters.membershipStatus as AthleteRow["membership_status"]);
  }
  if (filters.status) query = query.eq("status", filters.status as AthleteRow["status"]);

  if (filters.teamId) {
    const { data: squad } = await context.db
      .from("athlete_teams")
      .select("athlete_id")
      .eq("tenant_id", context.tenant.id)
      .eq("team_id", filters.teamId)
      .is("left_at", null);

    const ids = (squad ?? []).map((row) => row.athlete_id);
    if (ids.length === 0) return buildListResult([], 0, params, true);
    query = query.in("id", ids);
  }

  const { data, error, count } = await query
    .order("last_name")
    .order("first_name")
    .range(from, to);

  if (error) throw fromDatabaseError(error, { resource: "athlete" });

  const athletes = data ?? [];
  const teamsByAthlete = await teamsFor(context, athletes.map((a) => a.id), teamsPromise);

  return buildListResult(
    athletes.map((athlete) => ({ ...athlete, teams: teamsByAthlete.get(athlete.id) ?? [] })),
    count ?? 0,
    params,
    Boolean(params.q || filters.teamId || filters.membershipStatus || filters.status),
  );
}

/** Every team in the club, by id — small enough to read whole. */
async function tenantTeams(
  context: AuthContext,
): Promise<Map<string, { id: string; name: string; color: string }>> {
  const { data } = await context.db
    .from("teams")
    .select("id, name, color")
    .eq("tenant_id", context.tenant.id);
  return new Map((data ?? []).map((team) => [team.id, team]));
}

/**
 * Current team memberships for a page of athletes.
 *
 * The links for this page, stitched to the club's teams (read in parallel by
 * the caller) — rather than a query per athlete.
 */
async function teamsFor(
  context: AuthContext,
  athleteIds: string[],
  teamsPromise: Promise<Map<string, { id: string; name: string; color: string }>>,
) {
  const result = new Map<string, AthleteListItem["teams"]>();
  if (athleteIds.length === 0) return result;

  const { data: links } = await context.db
    .from("athlete_teams")
    .select("athlete_id, team_id, jersey_number")
    .eq("tenant_id", context.tenant.id)
    .in("athlete_id", athleteIds)
    .is("left_at", null);

  const byId = await teamsPromise;

  for (const link of links ?? []) {
    const team = byId.get(link.team_id);
    if (!team) continue;
    const list = result.get(link.athlete_id) ?? [];
    list.push({ ...team, jerseyNumber: link.jersey_number });
    result.set(link.athlete_id, list);
  }

  return result;
}

export async function getAthlete(context: AuthContext, id: string): Promise<AthleteRow> {
  assertPermission(context, "athletes.read");

  const { data, error } = await context.db
    .from("athletes")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "athlete" });
  if (!data) throw new NotFoundError("athlete");
  return data;
}

export async function getAthleteTeamIds(context: AuthContext, athleteId: string) {
  const { data } = await context.db
    .from("athlete_teams")
    .select("team_id")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId)
    .is("left_at", null);

  return (data ?? []).map((row) => row.team_id);
}

/**
 * Reconciles squad membership.
 *
 * Leaving a team sets `left_at` rather than deleting the row: which squads
 * someone played in, and when, is history worth keeping.
 */
async function syncTeams(context: AuthContext, athleteId: string, teamIds: string[]) {
  const current = await getAthleteTeamIds(context, athleteId);
  const desired = new Set(teamIds);

  const removed = current.filter((id) => !desired.has(id));
  const added = teamIds.filter((id) => !current.includes(id));

  if (removed.length > 0) {
    await context.db
      .from("athlete_teams")
      .update({ left_at: new Date().toISOString().slice(0, 10) })
      .eq("tenant_id", context.tenant.id)
      .eq("athlete_id", athleteId)
      .in("team_id", removed)
      .is("left_at", null);
  }

  for (const teamId of added) {
    await context.db.from("athlete_teams").insert({
      tenant_id: context.tenant.id,
      athlete_id: athleteId,
      team_id: teamId,
      created_by: context.user.id,
    });
  }

  return { added: added.length, removed: removed.length };
}

export interface ShirtEntry {
  teamId: string;
  jerseyNumber: number | null;
}

/**
 * Refuses a shirt a teammate already wears.
 *
 * Checked before anything is written, so a clash on a new athlete does not
 * leave the athlete saved and the number silently dropped. `athleteId` is null
 * for an athlete not yet created — nobody to exclude.
 */
export async function assertShirtsFree(
  context: AuthContext,
  athleteId: string | null,
  numbers: ShirtEntry[],
) {
  const claimed = numbers.filter(
    (entry): entry is { teamId: string; jerseyNumber: number } => entry.jerseyNumber !== null,
  );
  if (claimed.length === 0) return;

  let query = context.db
    .from("athlete_teams")
    .select("team_id, jersey_number")
    .eq("tenant_id", context.tenant.id)
    .in("team_id", claimed.map((entry) => entry.teamId))
    .is("left_at", null)
    .not("jersey_number", "is", null);
  if (athleteId) query = query.neq("athlete_id", athleteId);
  const { data: taken, error } = await query;
  if (error) throw fromDatabaseError(error, { resource: "team" });

  for (const entry of claimed) {
    const clash = taken?.find(
      (row) => row.team_id === entry.teamId && row.jersey_number === entry.jerseyNumber,
    );
    if (clash) {
      const { data: team } = await context.db
        .from("teams")
        .select("name")
        .eq("tenant_id", context.tenant.id)
        .eq("id", entry.teamId)
        .maybeSingle();
      const teamName = team?.name ?? "this team";
      throw new ConflictError(`${entry.jerseyNumber} is already worn by a teammate in ${teamName}.`);
    }
  }
}

/**
 * Writes the numbers that moved, for squads the athlete is currently in.
 * Callers check permission and clashes first.
 */
export async function writeAthleteNumbers(
  context: AuthContext,
  athleteId: string,
  numbers: ShirtEntry[],
): Promise<ShirtEntry[]> {
  const { data: currentRows, error } = await context.db
    .from("athlete_teams")
    .select("team_id, jersey_number")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId)
    .is("left_at", null);
  if (error) throw fromDatabaseError(error, { resource: "team" });

  const current = new Map((currentRows ?? []).map((row) => [row.team_id, row.jersey_number]));
  const changes = numbers.filter(
    (entry) => current.has(entry.teamId) && current.get(entry.teamId) !== entry.jerseyNumber,
  );

  const results = await Promise.all(
    changes.map((entry) =>
      context.db
        .from("athlete_teams")
        .update({ jersey_number: entry.jerseyNumber })
        .eq("tenant_id", context.tenant.id)
        .eq("team_id", entry.teamId)
        .eq("athlete_id", athleteId)
        .is("left_at", null),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw fromDatabaseError(failed.error, { resource: "team" });

  return changes;
}

function toRow(input: CreateAthleteInput) {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    email: input.email,
    phone: input.phone,
    address_line1: input.addressLine1,
    postal_code: input.postalCode,
    city: input.city,
    emergency_contact_name: input.emergencyContactName,
    emergency_contact_phone: input.emergencyContactPhone,
    emergency_contact_relation: input.emergencyContactRelation,
    membership_status: input.membershipStatus,
    notes: input.notes,
    ...(input.publicConsent === undefined ? {} : { public_consent: input.publicConsent }),
  };
}

export async function createAthlete(
  context: AuthContext,
  input: CreateAthleteInput,
): Promise<AthleteRow> {
  assertPermission(context, "athletes.create");
  const numbers = input.numbers.filter((entry) => input.teamIds.includes(entry.teamId));
  await assertShirtsFree(context, null, numbers);

  const { data, error } = await context.db
    .from("athletes")
    .insert({ tenant_id: context.tenant.id, ...toRow(input), created_by: context.user.id })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "athlete", conflictMessages: CONFLICTS });

  if (input.teamIds.length > 0) {
    await syncTeams(context, data.id, input.teamIds);
    await writeAthleteNumbers(context, data.id, numbers);
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.ATHLETE_CREATED,
    resourceType: "athlete",
    resourceId: data.id,
    newValue: { name: `${data.first_name} ${data.last_name}`, teams: input.teamIds.length },
  });

  return data;
}

export async function updateAthlete(
  context: AuthContext,
  input: UpdateAthleteInput,
): Promise<AthleteRow> {
  assertPermission(context, "athletes.update");
  const before = await getAthlete(context, input.id);
  const changes = toRow(input);
  const numbers = input.numbers.filter((entry) => input.teamIds.includes(entry.teamId));
  await assertShirtsFree(context, input.id, numbers);

  const { data, error } = await context.db
    .from("athletes")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "athlete", conflictMessages: CONFLICTS });

  const teamChanges = await syncTeams(context, input.id, input.teamIds);
  const shirts = await writeAthleteNumbers(context, input.id, numbers);
  const assignments = { ...teamChanges, shirts: shirts.length };
  const diff = diffFields(before as unknown as Record<string, unknown>, changes);

  if (diff || assignments.added || assignments.removed || assignments.shirts) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.ATHLETE_UPDATED,
      resourceType: "athlete",
      resourceId: data.id,
      oldValue: diff?.oldValue ?? null,
      newValue: diff?.newValue ?? null,
      metadata: assignments,
    });
  }

  return data;
}

export async function archiveAthlete(context: AuthContext, id: string): Promise<AthleteRow> {
  assertPermission(context, "athletes.delete");
  const before = await getAthlete(context, id);

  const { data, error } = await context.db
    .from("athletes")
    .update({ status: "ARCHIVED", membership_status: "INACTIVE" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "athlete" });

  await context.db
    .from("athlete_teams")
    .update({ left_at: new Date().toISOString().slice(0, 10) })
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", id)
    .is("left_at", null);

  await recordAudit(context, {
    action: AUDIT_ACTIONS.ATHLETE_DELETED,
    resourceType: "athlete",
    resourceId: id,
    oldValue: { status: before.status },
    newValue: { status: "ARCHIVED" },
  });

  return data;
}

export async function restoreAthlete(context: AuthContext, id: string): Promise<AthleteRow> {
  assertPermission(context, "athletes.update");

  const { data, error } = await context.db
    .from("athletes")
    .update({ status: "ACTIVE", membership_status: "ACTIVE" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "athlete" });
  return data;
}

/** Active athletes, for a picker. */
export async function listAthleteOptions(context: AuthContext) {
  assertPermission(context, "athletes.read");

  const { data, error } = await context.db
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .order("last_name");

  if (error) throw fromDatabaseError(error, { resource: "athlete" });
  return data ?? [];
}

/**
 * Which squads an athlete plays for, set from their own page.
 *
 * An athlete plays up an age group as often as not, so this is a list rather
 * than a field, and it is the same join the team's roster writes — from the
 * other side, and under the athlete's permission rather than the team's.
 */
export async function setAthleteTeams(
  context: AuthContext,
  athleteId: string,
  teamIds: string[],
): Promise<{ added: number; removed: number }> {
  assertPermission(context, "athletes.update");

  const athlete = await getAthlete(context, athleteId);
  const result = await syncTeams(context, athleteId, teamIds);

  if (result.added || result.removed) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.ATHLETE_UPDATED,
      resourceType: "athlete",
      resourceId: athleteId,
      newValue: { athlete: `${athlete.first_name} ${athlete.last_name}`, teams: teamIds.length },
    });
  }

  return result;
}
