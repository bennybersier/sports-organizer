import "server-only";

import { NotFoundError, fromDatabaseError } from "@/lib/errors";
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
  teams: { id: string; name: string; color: string }[];
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
  const teamsByAthlete = await teamsFor(context, athletes.map((a) => a.id));

  return buildListResult(
    athletes.map((athlete) => ({ ...athlete, teams: teamsByAthlete.get(athlete.id) ?? [] })),
    count ?? 0,
    params,
    Boolean(params.q || filters.teamId || filters.membershipStatus || filters.status),
  );
}

/**
 * Current team memberships for a page of athletes, in two queries.
 *
 * Fetches the links, then the teams they point at, and stitches them together —
 * rather than a query per athlete.
 */
async function teamsFor(context: AuthContext, athleteIds: string[]) {
  const result = new Map<string, { id: string; name: string; color: string }[]>();
  if (athleteIds.length === 0) return result;

  const { data: links } = await context.db
    .from("athlete_teams")
    .select("athlete_id, team_id")
    .eq("tenant_id", context.tenant.id)
    .in("athlete_id", athleteIds)
    .is("left_at", null);

  const teamIds = [...new Set((links ?? []).map((link) => link.team_id))];
  if (teamIds.length === 0) return result;

  const { data: teams } = await context.db
    .from("teams")
    .select("id, name, color")
    .eq("tenant_id", context.tenant.id)
    .in("id", teamIds);

  const byId = new Map((teams ?? []).map((team) => [team.id, team]));

  for (const link of links ?? []) {
    const team = byId.get(link.team_id);
    if (!team) continue;
    const list = result.get(link.athlete_id) ?? [];
    list.push(team);
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
  };
}

export async function createAthlete(
  context: AuthContext,
  input: CreateAthleteInput,
): Promise<AthleteRow> {
  assertPermission(context, "athletes.create");

  const { data, error } = await context.db
    .from("athletes")
    .insert({ tenant_id: context.tenant.id, ...toRow(input), created_by: context.user.id })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "athlete", conflictMessages: CONFLICTS });

  if (input.teamIds.length > 0) await syncTeams(context, data.id, input.teamIds);

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

  const { data, error } = await context.db
    .from("athletes")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "athlete", conflictMessages: CONFLICTS });

  const assignments = await syncTeams(context, input.id, input.teamIds);
  const diff = diffFields(before as unknown as Record<string, unknown>, changes);

  if (diff || assignments.added || assignments.removed) {
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
