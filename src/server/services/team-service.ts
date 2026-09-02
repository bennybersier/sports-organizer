import "server-only";

import { NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, diffFields, recordAudit } from "@/server/services/audit-service";
import {
  buildListResult,
  paginationRange,
  searchAcross,
  tally,
  type ListParams,
  type ListResult,
} from "@/server/services/list-query";
import type { CreateTeamInput, UpdateTeamInput } from "@/lib/validation/team";
import type { TeamRow } from "@/types/database";

export interface TeamListItem extends TeamRow {
  athlete_count: number;
  trainer_count: number;
  season_name: string;
}

const CONFLICTS = {
  teams_season_name_uniq: "A team with that name already exists in this season.",
};

export async function listTeams(
  context: AuthContext,
  params: ListParams,
  filters: { seasonId?: string; sport?: string; status?: string } = {},
): Promise<ListResult<TeamListItem>> {
  assertPermission(context, "teams.read");
  const { from, to } = paginationRange(params);

  let query = context.db
    .from("teams")
    .select("*", { count: "exact" })
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  if (params.q) query = query.or(searchAcross(["name", "sport", "category", "age_group"], params.q));
  if (filters.seasonId) query = query.eq("season_id", filters.seasonId);
  if (filters.sport) query = query.eq("sport", filters.sport);
  if (filters.status) query = query.eq("status", filters.status as TeamRow["status"]);

  const { data, error, count } = await query.order("name").range(from, to);
  if (error) throw fromDatabaseError(error, { resource: "team" });

  const teams = data ?? [];
  const ids = teams.map((team) => team.id);
  const seasonIds = [...new Set(teams.map((team) => team.season_id))];

  const [athletes, trainers, seasons] = await Promise.all([
    ids.length
      ? context.db
          .from("athlete_teams")
          .select("team_id")
          .eq("tenant_id", context.tenant.id)
          .in("team_id", ids)
          .is("left_at", null)
      : Promise.resolve({ data: [] }),
    ids.length
      ? context.db
          .from("trainer_teams")
          .select("team_id")
          .eq("tenant_id", context.tenant.id)
          .in("team_id", ids)
          .is("unassigned_at", null)
      : Promise.resolve({ data: [] }),
    seasonIds.length
      ? context.db
          .from("seasons")
          .select("id, name")
          .eq("tenant_id", context.tenant.id)
          .in("id", seasonIds)
      : Promise.resolve({ data: [] }),
  ]);

  const athleteCounts = tally(athletes.data ?? [], "team_id");
  const trainerCounts = tally(trainers.data ?? [], "team_id");
  const seasonNames = new Map((seasons.data ?? []).map((s) => [s.id, s.name]));

  return buildListResult(
    teams.map((team) => ({
      ...team,
      athlete_count: athleteCounts.get(team.id) ?? 0,
      trainer_count: trainerCounts.get(team.id) ?? 0,
      season_name: seasonNames.get(team.season_id) ?? "",
    })),
    count ?? 0,
    params,
    Boolean(params.q || filters.seasonId || filters.sport || filters.status),
  );
}

export async function getTeam(context: AuthContext, id: string): Promise<TeamRow> {
  assertPermission(context, "teams.read");

  const { data, error } = await context.db
    .from("teams")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "team" });
  if (!data) throw new NotFoundError("team");
  return data;
}

export async function listTeamOptions(context: AuthContext, seasonId?: string) {
  assertPermission(context, "teams.read");

  let query = context.db
    .from("teams")
    .select("id, name, season_id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "ACTIVE")
    .is("deleted_at", null);

  if (seasonId) query = query.eq("season_id", seasonId);

  const { data, error } = await query.order("name");
  if (error) throw fromDatabaseError(error, { resource: "team" });
  return data ?? [];
}

export async function listTeamSports(context: AuthContext): Promise<string[]> {
  assertPermission(context, "teams.read");

  const { data } = await context.db
    .from("teams")
    .select("sport")
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  return [...new Set((data ?? []).map((row) => row.sport))].sort();
}

/** Current coaching assignments for a team. */
export async function getTeamTrainerIds(context: AuthContext, teamId: string): Promise<string[]> {
  const { data } = await context.db
    .from("trainer_teams")
    .select("trainer_id")
    .eq("tenant_id", context.tenant.id)
    .eq("team_id", teamId)
    .is("unassigned_at", null);

  return (data ?? []).map((row) => row.trainer_id);
}

/**
 * Reconciles coaching assignments.
 *
 * Removals end the assignment (`unassigned_at`) rather than deleting the row,
 * so the history of who coached a team through a season stays intact — the
 * schedule depends on it.
 */
async function syncTrainers(context: AuthContext, teamId: string, trainerIds: string[]) {
  const current = await getTeamTrainerIds(context, teamId);
  const desired = new Set(trainerIds);

  const removed = current.filter((id) => !desired.has(id));
  const added = trainerIds.filter((id) => !current.includes(id));

  if (removed.length > 0) {
    await context.db
      .from("trainer_teams")
      .update({ unassigned_at: new Date().toISOString().slice(0, 10) })
      .eq("tenant_id", context.tenant.id)
      .eq("team_id", teamId)
      .in("trainer_id", removed)
      .is("unassigned_at", null);
  }

  for (const trainerId of added) {
    await context.db.from("trainer_teams").insert({
      tenant_id: context.tenant.id,
      team_id: teamId,
      trainer_id: trainerId,
      created_by: context.user.id,
    });
  }

  return { added: added.length, removed: removed.length };
}

function toRow(input: CreateTeamInput) {
  return {
    season_id: input.seasonId,
    name: input.name,
    sport: input.sport,
    category: input.category,
    age_group: input.ageGroup,
    gender: input.gender,
    color: input.color,
    notes: input.notes,
  };
}

export async function createTeam(context: AuthContext, input: CreateTeamInput): Promise<TeamRow> {
  assertPermission(context, "teams.create");

  const { data, error } = await context.db
    .from("teams")
    .insert({ tenant_id: context.tenant.id, ...toRow(input), created_by: context.user.id })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "team", conflictMessages: CONFLICTS });

  if (input.trainerIds.length > 0) {
    await syncTrainers(context, data.id, input.trainerIds);
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.TEAM_CREATED,
    resourceType: "team",
    resourceId: data.id,
    newValue: { name: data.name, sport: data.sport, trainers: input.trainerIds.length },
  });

  return data;
}

export async function updateTeam(context: AuthContext, input: UpdateTeamInput): Promise<TeamRow> {
  assertPermission(context, "teams.update");
  const before = await getTeam(context, input.id);
  const changes = toRow(input);

  const { data, error } = await context.db
    .from("teams")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "team", conflictMessages: CONFLICTS });

  const assignments = await syncTrainers(context, input.id, input.trainerIds);
  const diff = diffFields(before as unknown as Record<string, unknown>, changes);

  if (diff || assignments.added || assignments.removed) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.TEAM_UPDATED,
      resourceType: "team",
      resourceId: data.id,
      oldValue: diff?.oldValue ?? null,
      newValue: diff?.newValue ?? null,
      metadata: assignments,
    });
  }

  return data;
}

export async function archiveTeam(context: AuthContext, id: string): Promise<TeamRow> {
  assertPermission(context, "teams.delete");
  const before = await getTeam(context, id);

  const { data, error } = await context.db
    .from("teams")
    .update({ status: "ARCHIVED" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "team" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.TEAM_DELETED,
    resourceType: "team",
    resourceId: id,
    oldValue: { status: before.status },
    newValue: { status: "ARCHIVED" },
  });

  return data;
}

export async function restoreTeam(context: AuthContext, id: string): Promise<TeamRow> {
  assertPermission(context, "teams.update");

  const { data, error } = await context.db
    .from("teams")
    .update({ status: "ACTIVE" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "team" });
  return data;
}
