import "server-only";

import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { hashSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPermission, type Permission } from "@/domain/permissions";
import type { AuthContext } from "@/server/auth/context";

/**
 * MCP authentication.
 *
 * An MCP request carries an API key instead of a session cookie, so this is the
 * one place that turns a key into an AuthContext. Everything downstream — every
 * tool — then goes through the same services, the same `assertPermission`, and
 * the same audit trail as the web UI. There is no privileged MCP path.
 *
 * The resolution chain the spec asks for, in order:
 *
 *     credential -> user -> tenant -> scopes -> permissions -> operation
 *
 * The critical property is the direction of the scope step: **scopes can only
 * narrow.** A key cannot outlive its owner's authority — demote the person and
 * every key they issued weakens with them; suspend their membership and their
 * keys stop working entirely.
 *
 * Scopes narrow at the *tool* level, not by masking permissions. That
 * distinction matters and was got wrong first: generating a schedule reads
 * seasons, teams, gyms and availability along the way, so a key scoped to
 * `schedule.generate` with those reads masked away could be offered the tool
 * and then fail inside it. Instead, scopes decide which tools the key may
 * invoke at all, and a permitted tool runs with its owner's real permissions.
 * The guarantee is unchanged and the failure mode is gone: a scoped key can
 * reach fewer capabilities, never more.
 */

export interface McpIdentity {
  keyId: string;
  keyName: string;
  context: AuthContext;
  /** What the key was granted, before intersection. For diagnostics only. */
  requestedScopes: string[];
}

/**
 * Resolves a raw API key.
 *
 * Uses the secret-key client because `mcp_api_keys` has no grants for any
 * client role, and because the caller has no session to scope a query with yet.
 * Every read after this point goes through `context.db`, which is *also* the
 * admin client — MCP has no JWT to present — so the permission checks in the
 * services are what enforce authorization here, exactly as designed.
 */
export async function resolveMcpIdentity(rawKey: string): Promise<McpIdentity> {
  if (!rawKey || rawKey.length < 20) {
    throw new AuthenticationError("Missing or malformed API key.");
  }

  const admin = createAdminClient();

  // Looked up by hash: the raw key is never stored, so a leaked table gives an
  // attacker nothing to present.
  const { data: key } = await admin
    .from("mcp_api_keys")
    .select("id, tenant_id, user_id, name, scopes, expires_at, revoked_at")
    .eq("secret_hash", hashSecret(rawKey))
    .maybeSingle();

  if (!key) throw new AuthenticationError("That API key is not valid.");
  if (key.revoked_at) throw new AuthenticationError("That API key has been revoked.");
  if (key.expires_at && new Date(key.expires_at) <= new Date()) {
    throw new AuthenticationError("That API key has expired.");
  }

  const [{ data: membership }, { data: profile }, { data: tenant }] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("role_id, status")
      .eq("tenant_id", key.tenant_id)
      .eq("user_id", key.user_id)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id, email, full_name, avatar_url, locale, timezone")
      .eq("id", key.user_id)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("id, name, slug, timezone, locale, week_start, status, deleted_at")
      .eq("id", key.tenant_id)
      .maybeSingle(),
  ]);

  // The key belongs to a person in a club. If either has gone away, so has the
  // key's authority — this is why keys are not standalone credentials.
  if (!membership || membership.status !== "ACTIVE" || !profile) {
    throw new AuthorizationError("The account this key belongs to no longer has access.");
  }
  if (!tenant || tenant.status !== "ACTIVE" || tenant.deleted_at) {
    throw new AuthorizationError("That club is no longer active.");
  }

  const [role, effective] = await Promise.all([
    admin.from("roles").select("key, name, rank").eq("id", membership.role_id).single(),
    effectivePermissionsFor(key.tenant_id, key.user_id),
  ]);

  /*
    The key carries its owner's real permissions; `requestedScopes` decides
    which tools it may invoke (see `toolsFor`). Intersecting here instead would
    break any tool that legitimately reads more than its headline permission.
  */
  const granted = new Set<Permission>(effective);
  const requested = key.scopes.filter(isPermission);

  void admin
    .from("mcp_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(() => undefined);

  return {
    keyId: key.id,
    keyName: key.name,
    requestedScopes: requested,
    context: {
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        avatarUrl: profile.avatar_url,
        locale: profile.locale,
        timezone: profile.timezone,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        timezone: tenant.timezone,
        locale: tenant.locale,
        weekStart: tenant.week_start,
      },
      role: { key: role.data!.key, name: role.data!.name, rank: role.data!.rank },
      permissions: granted,
      // Distinguishes MCP activity in the audit log from a person clicking.
      actorType: "MCP",
      isPlatformAdmin: false,
      isActingAsStaff: false,
      db: admin,
    },
  };
}

/**
 * The user's effective permissions, resolved the same way as everywhere else:
 * explicit override, then role default, then deny.
 */
async function effectivePermissionsFor(
  tenantId: string,
  userId: string,
): Promise<Permission[]> {
  const admin = createAdminClient();

  const [{ data: membership }, { data: overrides }] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("role_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("user_permission_overrides")
      .select("permission_key, effect")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId),
  ]);

  const roleDefaults = new Set<string>();
  if (membership) {
    const { data } = await admin
      .from("role_permissions")
      .select("permission_key")
      .eq("role_id", membership.role_id);
    for (const row of data ?? []) roleDefaults.add(row.permission_key);
  }

  const overrideMap = new Map((overrides ?? []).map((row) => [row.permission_key, row.effect]));
  const { data: all } = await admin.from("permissions").select("key");

  const effective: Permission[] = [];
  for (const row of all ?? []) {
    if (!isPermission(row.key)) continue;
    const override = overrideMap.get(row.key);
    const granted = override ? override === "ALLOW" : roleDefaults.has(row.key);
    if (granted) effective.push(row.key);
  }
  return effective;
}

/** Reads the key from the request, accepting either header convention. */
export function extractApiKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return request.headers.get("x-api-key");
}
