import "server-only";

import { fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import {
  buildListResult,
  paginationRange,
  type ListParams,
  type ListResult,
} from "@/server/services/list-query";
import type { Json } from "@/types/json";

export interface AuditEntryView {
  id: string;
  createdAt: string;
  actorName: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  oldValue: Json | null;
  newValue: Json | null;
  reason: string | null;
}

/**
 * Reads the audit log.
 *
 * Read-only by construction: `audit_logs` has no INSERT, UPDATE or DELETE grant
 * for `authenticated`, and an immutability trigger refuses changes even to the
 * table owner. This service can only ever select.
 */
export async function listAuditEntries(
  context: AuthContext,
  params: ListParams,
  filters: { action?: string; actorId?: string } = {},
): Promise<ListResult<AuditEntryView>> {
  assertPermission(context, "audit_logs.read");
  const { from, to } = paginationRange(params);

  let query = context.db
    .from("audit_logs")
    .select("id, created_at, actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, reason", {
      count: "exact",
    })
    .eq("tenant_id", context.tenant.id);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (params.q) query = query.or(`action.ilike.*${params.q}*,resource_type.ilike.*${params.q}*`);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw fromDatabaseError(error, { resource: "audit entry" });

  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))] as string[];

  const { data: profiles } = actorIds.length
    ? await context.db.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };

  const names = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name ?? profile.email]),
  );

  return buildListResult(
    rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      actorType: row.actor_type,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      oldValue: row.old_value,
      newValue: row.new_value,
      reason: row.reason,
    })),
    count ?? 0,
    params,
    Boolean(params.q || filters.action || filters.actorId),
  );
}

/** Distinct actions present, for the filter dropdown. */
export async function listAuditActions(context: AuthContext): Promise<string[]> {
  assertPermission(context, "audit_logs.read");

  const { data } = await context.db
    .from("audit_logs")
    .select("action")
    .eq("tenant_id", context.tenant.id)
    .limit(1000);

  return [...new Set((data ?? []).map((row) => row.action))].sort();
}
