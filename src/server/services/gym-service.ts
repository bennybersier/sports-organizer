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
import type { CreateGymInput, UpdateGymInput } from "@/lib/validation/gym";
import type { GymRow } from "@/types/database";

const CONFLICTS = { gyms_tenant_name_uniq: "A gym with that name already exists." };

export async function listGyms(
  context: AuthContext,
  params: ListParams,
  filters: { status?: string; sport?: string } = {},
): Promise<ListResult<GymRow>> {
  assertPermission(context, "gyms.read");
  const { from, to } = paginationRange(params);

  let query = context.db
    .from("gyms")
    .select("*", { count: "exact" })
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  if (params.q) query = query.or(searchAcross(["name", "city", "description"], params.q));
  if (filters.status) query = query.eq("status", filters.status as GymRow["status"]);
  if (filters.sport) query = query.contains("sport_types", [filters.sport]);

  const { data, error, count } = await query.order("name").range(from, to);
  if (error) throw fromDatabaseError(error, { resource: "gym" });

  return buildListResult(
    data ?? [],
    count ?? 0,
    params,
    Boolean(params.q || filters.status || filters.sport),
  );
}

export async function getGym(context: AuthContext, id: string): Promise<GymRow> {
  assertPermission(context, "gyms.read");

  const { data, error } = await context.db
    .from("gyms")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "gym" });
  if (!data) throw new NotFoundError("gym");
  return data;
}

/** Active gyms for pickers. */
export async function listGymOptions(context: AuthContext) {
  assertPermission(context, "gyms.read");

  const { data, error } = await context.db
    .from("gyms")
    .select("id, name, sport_types")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .order("name");

  if (error) throw fromDatabaseError(error, { resource: "gym" });
  return data ?? [];
}

/** Distinct sports across the club's gyms, for the filter dropdown. */
export async function listGymSports(context: AuthContext): Promise<string[]> {
  assertPermission(context, "gyms.read");

  const { data } = await context.db
    .from("gyms")
    .select("sport_types")
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null);

  return [...new Set((data ?? []).flatMap((row) => row.sport_types))].sort();
}

function toRow(input: CreateGymInput) {
  return {
    name: input.name,
    description: input.description,
    address_line1: input.addressLine1,
    postal_code: input.postalCode,
    city: input.city,
    country: input.country,
    capacity: input.capacity,
    sport_types: input.sportTypes,
    equipment: input.equipment,
    color: input.color,
    notes: input.notes,
  };
}

export async function createGym(context: AuthContext, input: CreateGymInput): Promise<GymRow> {
  assertPermission(context, "gyms.create");

  const { data, error } = await context.db
    .from("gyms")
    .insert({ tenant_id: context.tenant.id, ...toRow(input), created_by: context.user.id })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "gym", conflictMessages: CONFLICTS });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.GYM_CREATED,
    resourceType: "gym",
    resourceId: data.id,
    newValue: { name: data.name },
  });

  return data;
}

export async function updateGym(context: AuthContext, input: UpdateGymInput): Promise<GymRow> {
  assertPermission(context, "gyms.update");
  const before = await getGym(context, input.id);
  const changes = toRow(input);

  const { data, error } = await context.db
    .from("gyms")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "gym", conflictMessages: CONFLICTS });

  const diff = diffFields(before as unknown as Record<string, unknown>, changes);
  if (diff) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.GYM_UPDATED,
      resourceType: "gym",
      resourceId: data.id,
      ...diff,
    });
  }

  return data;
}

/**
 * Archives rather than deletes.
 *
 * Past training sessions reference the gym, and the spec is explicit that
 * historical scheduling data is not destroyed to tidy up a roster. An archived
 * gym stays readable and stops being offered for new schedules.
 */
export async function archiveGym(context: AuthContext, id: string): Promise<GymRow> {
  assertPermission(context, "gyms.delete");
  const before = await getGym(context, id);

  const { data, error } = await context.db
    .from("gyms")
    .update({ status: "ARCHIVED" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "gym" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.GYM_UPDATED,
    resourceType: "gym",
    resourceId: id,
    oldValue: { status: before.status },
    newValue: { status: "ARCHIVED" },
  });

  return data;
}

export async function restoreGym(context: AuthContext, id: string): Promise<GymRow> {
  assertPermission(context, "gyms.update");

  const { data, error } = await context.db
    .from("gyms")
    .update({ status: "ACTIVE" })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "gym" });
  return data;
}
