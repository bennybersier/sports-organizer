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
import type { CreateTrainerInput, UpdateTrainerInput } from "@/lib/validation/trainer";
import type { TrainerRow } from "@/types/database";

export interface TrainerListItem extends TrainerRow {
  team_count: number;
  teams: { id: string; name: string; color: string }[];
}

const CONFLICTS = {
  trainers_tenant_email_uniq: "A trainer with that email address already exists.",
};

export async function listTrainers(
  context: AuthContext,
  params: ListParams,
  filters: { status?: string; teamId?: string } = {},
): Promise<ListResult<TrainerListItem>> {
  assertPermission(context, "trainers.read");
  const { from, to } = paginationRange(params);

  let query = context.db
    .from("trainers")
    .select("*", { count: "exact" })
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  if (params.q) {
    query = query.or(searchAcross(["first_name", "last_name", "email"], params.q));
  }
  if (filters.status) query = query.eq("status", filters.status as TrainerRow["status"]);

  if (filters.teamId) {
    const { data: assignments } = await context.db
      .from("trainer_teams")
      .select("trainer_id")
      .eq("tenant_id", context.tenant.id)
      .eq("team_id", filters.teamId)
      .is("unassigned_at", null);

    const ids = (assignments ?? []).map((row) => row.trainer_id);
    // No assignments means no trainers match — not "no filter".
    if (ids.length === 0) return buildListResult([], 0, params, true);
    query = query.in("id", ids);
  }

  const { data, error, count } = await query
    .order("last_name")
    .order("first_name")
    .range(from, to);

  if (error) throw fromDatabaseError(error, { resource: "trainer" });

  const trainers = data ?? [];
  const teamsByTrainer = await teamsFor(context, trainers.map((t) => t.id));

  return buildListResult(
    trainers.map((trainer) => ({
      ...trainer,
      teams: teamsByTrainer.get(trainer.id) ?? [],
      team_count: (teamsByTrainer.get(trainer.id) ?? []).length,
    })),
    count ?? 0,
    params,
    Boolean(params.q || filters.status || filters.teamId),
  );
}

/**
 * Current team assignments for a page of trainers, in two queries rather than
 * one per trainer.
 */
async function teamsFor(context: AuthContext, trainerIds: string[]) {
  const result = new Map<string, { id: string; name: string; color: string }[]>();
  if (trainerIds.length === 0) return result;

  const { data: links } = await context.db
    .from("trainer_teams")
    .select("trainer_id, team_id")
    .eq("tenant_id", context.tenant.id)
    .in("trainer_id", trainerIds)
    .is("unassigned_at", null);

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
    result.set(link.trainer_id, [...(result.get(link.trainer_id) ?? []), team]);
  }
  return result;
}

/** Current team ids for one trainer, for the edit form. */
export async function getTrainerTeamIds(
  context: AuthContext,
  trainerId: string,
): Promise<string[]> {
  assertPermission(context, "trainers.read");

  const { data } = await context.db
    .from("trainer_teams")
    .select("team_id")
    .eq("tenant_id", context.tenant.id)
    .eq("trainer_id", trainerId)
    .is("unassigned_at", null);

  return (data ?? []).map((row) => row.team_id);
}

/**
 * Reconciles a trainer's team assignments.
 *
 * Removals end the assignment rather than deleting it, so the record of who
 * coached what through a season survives a roster change — the same rule the
 * team side follows.
 */
async function syncTeams(context: AuthContext, trainerId: string, teamIds: string[]) {
  const current = await getTrainerTeamIds(context, trainerId);
  const desired = new Set(teamIds);

  const removed = current.filter((id) => !desired.has(id));
  const added = teamIds.filter((id) => !current.includes(id));

  if (removed.length > 0) {
    await context.db
      .from("trainer_teams")
      .update({ unassigned_at: new Date().toISOString().slice(0, 10) })
      .eq("tenant_id", context.tenant.id)
      .eq("trainer_id", trainerId)
      .in("team_id", removed)
      .is("unassigned_at", null);
  }

  for (const teamId of added) {
    await context.db.from("trainer_teams").insert({
      tenant_id: context.tenant.id,
      trainer_id: trainerId,
      team_id: teamId,
      created_by: context.user.id,
    });
  }

  return { added: added.length, removed: removed.length };
}

export async function getTrainer(context: AuthContext, id: string): Promise<TrainerRow> {
  assertPermission(context, "trainers.read");

  const { data, error } = await context.db
    .from("trainers")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "trainer" });
  if (!data) throw new NotFoundError("trainer");
  return data;
}

export async function listTrainerOptions(context: AuthContext) {
  assertPermission(context, "trainers.read");

  const { data, error } = await context.db
    .from("trainers")
    .select("id, first_name, last_name")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .order("last_name");

  if (error) throw fromDatabaseError(error, { resource: "trainer" });
  return data ?? [];
}

function toRow(input: CreateTrainerInput) {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    qualifications: input.qualifications,
    color: input.color,
    notes: input.notes,
  };
}

export async function createTrainer(
  context: AuthContext,
  input: CreateTrainerInput,
): Promise<TrainerRow> {
  assertPermission(context, "trainers.create");

  const { data, error } = await context.db
    .from("trainers")
    .insert({ tenant_id: context.tenant.id, ...toRow(input), created_by: context.user.id })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "trainer", conflictMessages: CONFLICTS });

  await syncTeams(context, data.id, input.teamIds);

  await recordAudit(context, {
    action: AUDIT_ACTIONS.TRAINER_CREATED,
    resourceType: "trainer",
    resourceId: data.id,
    newValue: { name: `${data.first_name} ${data.last_name}`, teams: input.teamIds.length },
  });

  return data;
}

export async function updateTrainer(
  context: AuthContext,
  input: UpdateTrainerInput,
): Promise<TrainerRow> {
  assertPermission(context, "trainers.update");
  const before = await getTrainer(context, input.id);
  const changes = toRow(input);

  const { data, error } = await context.db
    .from("trainers")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "trainer", conflictMessages: CONFLICTS });

  const assignments = await syncTeams(context, input.id, input.teamIds);
  const diff = diffFields(before as unknown as Record<string, unknown>, changes);

  if (diff || assignments.added || assignments.removed) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.TRAINER_UPDATED,
      resourceType: "trainer",
      resourceId: data.id,
      oldValue: diff?.oldValue ?? null,
      newValue: diff?.newValue ?? null,
      metadata: assignments,
    });
  }

  return data;
}

/**
 * Archives a trainer and ends their current team assignments.
 *
 * Ending the assignments (rather than deleting them) keeps the record of who
 * coached what, which the schedule history depends on.
 */
export async function archiveTrainer(context: AuthContext, id: string): Promise<TrainerRow> {
  assertPermission(context, "trainers.delete");
  const before = await getTrainer(context, id);

  const { data, error } = await context.db
    .from("trainers")
    .update({ status: "ARCHIVED" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "trainer" });

  await context.db
    .from("trainer_teams")
    .update({ unassigned_at: new Date().toISOString().slice(0, 10) })
    .eq("tenant_id", context.tenant.id)
    .eq("trainer_id", id)
    .is("unassigned_at", null);

  await recordAudit(context, {
    action: AUDIT_ACTIONS.TRAINER_UPDATED,
    resourceType: "trainer",
    resourceId: id,
    oldValue: { status: before.status },
    newValue: { status: "ARCHIVED" },
  });

  return data;
}

export async function restoreTrainer(context: AuthContext, id: string): Promise<TrainerRow> {
  assertPermission(context, "trainers.update");

  const { data, error } = await context.db
    .from("trainers")
    .update({ status: "ACTIVE" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "trainer" });
  return data;
}
