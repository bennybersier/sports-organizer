import "server-only";

import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/auth/context";
import type { Json } from "@/types/json";

/**
 * Audit logging.
 *
 * Writes go through the secret-key client because `audit_logs` has no INSERT
 * grant for `authenticated` — an audit trail that a client could write is not
 * an audit trail. Rows are immutable at the database level too.
 *
 * A failed audit write must never take down the operation it was recording, so
 * failures are logged and swallowed. The one thing that would be worse than a
 * missing audit row is a user losing work because of one.
 */

export const AUDIT_ACTIONS = {
  TENANT_CREATED: "TENANT_CREATED",
  TENANT_UPDATED: "TENANT_UPDATED",
  TENANT_DELETED: "TENANT_DELETED",

  MEMBER_INVITED: "MEMBER_INVITED",
  MEMBER_INVITATION_REVOKED: "MEMBER_INVITATION_REVOKED",
  MEMBER_INVITATION_RESENT: "MEMBER_INVITATION_RESENT",
  MEMBER_JOINED: "MEMBER_JOINED",
  MEMBER_REMOVED: "MEMBER_REMOVED",
  MEMBER_ROLE_CHANGED: "MEMBER_ROLE_CHANGED",
  PERMISSION_CHANGED: "PERMISSION_CHANGED",

  SEASON_CREATED: "SEASON_CREATED",
  SEASON_UPDATED: "SEASON_UPDATED",
  SEASON_ARCHIVED: "SEASON_ARCHIVED",
  SEASON_DUPLICATED: "SEASON_DUPLICATED",

  TEAM_CREATED: "TEAM_CREATED",
  TEAM_UPDATED: "TEAM_UPDATED",
  TEAM_DELETED: "TEAM_DELETED",
  ATHLETE_CREATED: "ATHLETE_CREATED",
  ATHLETE_UPDATED: "ATHLETE_UPDATED",
  ATHLETE_DELETED: "ATHLETE_DELETED",
  ATHLETE_ASSIGNED: "ATHLETE_ASSIGNED",
  ATHLETE_UNASSIGNED: "ATHLETE_UNASSIGNED",
  TRAINER_CREATED: "TRAINER_CREATED",
  TRAINER_UPDATED: "TRAINER_UPDATED",
  TRAINER_DELETED: "TRAINER_DELETED",
  TRAINER_ASSIGNED: "TRAINER_ASSIGNED",
  TRAINER_UNASSIGNED: "TRAINER_UNASSIGNED",
  GYM_CREATED: "GYM_CREATED",
  GYM_UPDATED: "GYM_UPDATED",
  GYM_DELETED: "GYM_DELETED",

  AVAILABILITY_CHANGED: "AVAILABILITY_CHANGED",
  TRAINING_REQUIREMENTS_CHANGED: "TRAINING_REQUIREMENTS_CHANGED",

  SCHEDULE_GENERATED: "SCHEDULE_GENERATED",
  SCHEDULE_PUBLISHED: "SCHEDULE_PUBLISHED",
  SCHEDULE_ENTRY_MOVED: "SCHEDULE_ENTRY_MOVED",
  SCHEDULE_ENTRY_CREATED: "SCHEDULE_ENTRY_CREATED",
  SCHEDULE_ENTRY_CANCELLED: "SCHEDULE_ENTRY_CANCELLED",
  SCHEDULE_CONSTRAINT_OVERRIDDEN: "SCHEDULE_CONSTRAINT_OVERRIDDEN",

  CALENDAR_EVENT_CREATED: "CALENDAR_EVENT_CREATED",
  CALENDAR_EVENT_UPDATED: "CALENDAR_EVENT_UPDATED",
  CALENDAR_EVENT_CANCELLED: "CALENDAR_EVENT_CANCELLED",

  AI_CONFIGURATION_CHANGED: "AI_CONFIGURATION_CHANGED",
  GOOGLE_INTEGRATION_CONNECTED: "GOOGLE_INTEGRATION_CONNECTED",
  GOOGLE_INTEGRATION_DISCONNECTED: "GOOGLE_INTEGRATION_DISCONNECTED",
  MCP_KEY_CREATED: "MCP_KEY_CREATED",
  MCP_KEY_REVOKED: "MCP_KEY_REVOKED",

  // Platform staff entering a club is itself an event: club owners can always
  // see when someone outside their club looked at their data.
  PLATFORM_ADMIN_ENTERED_TENANT: "PLATFORM_ADMIN_ENTERED_TENANT",
  PLATFORM_ADMIN_CREATED_TENANT: "PLATFORM_ADMIN_CREATED_TENANT",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: Json | null;
  newValue?: Json | null;
  /** Why a user knowingly overrode a soft constraint. Surfaced in the UI. */
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Keys whose values are stripped before anything is written.
 *
 * Belt and braces: services should never hand secrets to the audit log in the
 * first place, but a diff built from `Object.entries(row)` can pick one up by
 * accident, so the boundary scrubs them unconditionally.
 */
const REDACTED_KEYS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "secret",
  "secret_hash",
  "token_hash",
  "ciphertext",
  "authorization",
];

function scrub(value: unknown, depth = 0): Json {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, Json> = {};
    for (const [key, entry] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      result[key] = REDACTED_KEYS.some((needle) => lowered.includes(needle))
        ? "[redacted]"
        : scrub(entry, depth + 1);
    }
    return result;
  }
  return String(value);
}

async function requestMetadata(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    return {
      ip: forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip"),
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    // No request scope — a background job, for instance.
    return { ip: null, userAgent: null };
  }
}

export async function recordAudit(context: AuthContext, entry: AuditEntry): Promise<void> {
  try {
    const { ip, userAgent } = await requestMetadata();

    const { error } = await createAdminClient()
      .from("audit_logs")
      .insert({
        tenant_id: context.tenant.id,
        actor_id: context.user.id,
        actor_type: context.actorType,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId ?? null,
        old_value: entry.oldValue === undefined ? null : scrub(entry.oldValue),
        new_value: entry.newValue === undefined ? null : scrub(entry.newValue),
        reason: entry.reason ?? null,
        metadata: scrub(entry.metadata ?? {}),
        ip_address: ip,
        user_agent: userAgent,
      });

    if (error) {
      console.error("[audit] failed to record entry", {
        action: entry.action,
        tenantId: context.tenant.id,
        code: error.code,
      });
    }
  } catch (error) {
    console.error("[audit] unexpected failure", {
      action: entry.action,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Builds a minimal before/after pair containing only the fields that actually
 * changed, so the audit UI can render a readable diff.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { oldValue: Json; newValue: Json } | null {
  const oldValue: Record<string, Json> = {};
  const newValue: Record<string, Json> = {};
  let changed = false;

  for (const [key, next] of Object.entries(after)) {
    const previous = before[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    oldValue[key] = scrub(previous);
    newValue[key] = scrub(next);
    changed = true;
  }

  return changed ? { oldValue, newValue } : null;
}
