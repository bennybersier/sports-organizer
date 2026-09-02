import "server-only";

import { fromDatabaseError } from "@/lib/errors";
import { generateApiKey } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { isPermission, type Permission } from "@/domain/permissions";

/**
 * MCP API keys.
 *
 * Only the SHA-256 of a key is stored; the raw value is returned exactly once,
 * at creation, and cannot be recovered afterwards. `mcp_api_keys` has no grants
 * for any client role, so every operation here runs through the secret-key
 * client after checking the caller's permission.
 */

export interface McpKeyView {
  id: string;
  name: string;
  /** The non-secret identifying prefix, safe to show and to log. */
  prefix: string;
  scopes: string[];
  ownerEmail: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export async function listMcpKeys(context: AuthContext): Promise<McpKeyView[]> {
  assertPermission(context, "mcp.manage");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("mcp_api_keys")
    .select("id, name, key_prefix, scopes, user_id, created_at, last_used_at, expires_at, revoked_at")
    .eq("tenant_id", context.tenant.id)
    .order("created_at", { ascending: false });

  if (error) throw fromDatabaseError(error, { resource: "API key" });

  const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("id, email").in("id", userIds)
    : { data: [] };
  const emails = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes,
    ownerEmail: emails.get(row.user_id) ?? "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

export interface CreateMcpKeyInput {
  name: string;
  /** Empty means "everything the owner can do" — still bounded by their role. */
  scopes: string[];
  expiresInDays?: number | null;
}

export async function createMcpKey(
  context: AuthContext,
  input: CreateMcpKeyInput,
): Promise<{ key: McpKeyView; secret: string }> {
  assertPermission(context, "mcp.manage");

  /*
    A key can never be scoped beyond what its owner holds. Silently dropping
    the excess would be surprising, but so would refusing — so the intersection
    is taken and the stored scopes reflect what the key can actually do.
  */
  const scopes = input.scopes
    .filter(isPermission)
    .filter((permission: Permission) => context.permissions.has(permission));

  const { raw, prefix, hash } = generateApiKey();
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null;

  const { data, error } = await createAdminClient()
    .from("mcp_api_keys")
    .insert({
      tenant_id: context.tenant.id,
      // The key acts as its creator; permissions resolve through them.
      user_id: context.user.id,
      name: input.name,
      secret_hash: hash,
      key_prefix: prefix,
      scopes,
      expires_at: expiresAt,
      created_by: context.user.id,
    })
    .select("id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "API key" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MCP_KEY_CREATED,
    resourceType: "mcp_api_key",
    resourceId: data.id,
    // Prefix and scopes only. The secret and its hash are never audited.
    newValue: { name: input.name, prefix, scopes, expires_at: expiresAt },
  });

  return {
    secret: raw,
    key: {
      id: data.id,
      name: data.name,
      prefix: data.key_prefix,
      scopes: data.scopes,
      ownerEmail: context.user.email,
      createdAt: data.created_at,
      lastUsedAt: data.last_used_at,
      expiresAt: data.expires_at,
      revokedAt: data.revoked_at,
    },
  };
}

/**
 * Revokes a key.
 *
 * Marked rather than deleted, so the audit trail still explains what a key did
 * before it was withdrawn. Revocation takes effect on the next request — there
 * is no session to invalidate, because MCP holds none.
 */
export async function revokeMcpKey(context: AuthContext, id: string): Promise<void> {
  assertPermission(context, "mcp.manage");

  const { error } = await createAdminClient()
    .from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: context.user.id })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .is("revoked_at", null);

  if (error) throw fromDatabaseError(error, { resource: "API key" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MCP_KEY_REVOKED,
    resourceType: "mcp_api_key",
    resourceId: id,
  });
}

/** Revokes a key and issues a replacement with the same name and scopes. */
export async function rotateMcpKey(
  context: AuthContext,
  id: string,
): Promise<{ key: McpKeyView; secret: string }> {
  assertPermission(context, "mcp.manage");

  const { data: existing } = await createAdminClient()
    .from("mcp_api_keys")
    .select("name, scopes, expires_at")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .maybeSingle();

  await revokeMcpKey(context, id);

  return createMcpKey(context, {
    name: existing?.name ?? "Rotated key",
    scopes: existing?.scopes ?? [],
    expiresInDays: existing?.expires_at
      ? Math.max(1, Math.ceil((new Date(existing.expires_at).getTime() - Date.now()) / 86_400_000))
      : null,
  });
}
