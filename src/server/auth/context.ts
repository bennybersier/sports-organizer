import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { AuthenticationError, AuthorizationError, fromDatabaseError } from "@/lib/errors";
import { createClient, type TypedSupabaseClient } from "@/lib/supabase/server";
import type { Permission } from "@/domain/permissions";
import { isPermission } from "@/domain/permissions";

export const ACTIVE_TENANT_COOKIE = "sco_active_tenant";

/** How a request reached the domain layer. Recorded on every audit entry. */
export type ActorType =
  | "WEB"
  | "PLATFORM_ADMIN"
  | "MCP"
  | "AI"
  | "JOB"
  | "INTEGRATION"
  | "SYSTEM";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  locale: string;
  timezone: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  weekStart: number;
}

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantTimezone: string;
  roleKey: string;
  roleName: string;
  roleRank: number;
}

/**
 * Everything the domain layer needs to authorize an operation.
 *
 * The web UI, MCP, background jobs and integrations all build one of these and
 * hand it to the same services — there is no privileged path that skips it.
 */
export interface AuthContext {
  user: AuthUser;
  tenant: TenantSummary;
  /** The caller's role in this tenant. Lower rank = more privileged. */
  role: { key: string; name: string; rank: number };
  /** Fully resolved: role permissions with per-user overrides already applied. */
  permissions: ReadonlySet<Permission>;
  actorType: ActorType;
  /** System staff, not a member of this club. See `isActingAsStaff`. */
  isPlatformAdmin: boolean;
  /**
   * True when a platform admin is operating inside a club they do not belong
   * to. Drives the banner in the app shell and the audit actor type — the
   * bypass is never silent.
   */
  isActingAsStaff: boolean;
  /** Tenant-scoped database client. Under RLS for WEB contexts. */
  db: TypedSupabaseClient;
}

/** Synthetic role for staff acting inside a club without a membership. */
export const PLATFORM_ADMIN_ROLE = {
  key: "PLATFORM_ADMIN",
  name: "Platform admin",
  // Outranks Owner (rank 0) so assertOutranks lets staff act on anyone.
  rank: -1,
} as const;

/**
 * The signed-in user, or null.
 *
 * Uses `getUser()`, which revalidates the JWT against the auth server, rather
 * than `getSession()`, which trusts whatever is in the cookie.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, locale, timezone")
    .eq("id", user.id)
    .maybeSingle();

  // The profile trigger normally guarantees a row; fall back to the JWT claims
  // rather than failing the request outright.
  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    locale: profile?.locale ?? "en",
    timezone: profile?.timezone ?? "UTC",
  };
});

/**
 * Whether the signed-in user is system staff.
 *
 * Resolved through a security-definer RPC: `platform_admins` has no grants for
 * `authenticated`, so the flag cannot be read — let alone written — directly.
 */
export const getIsPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("am_i_platform_admin");
  if (error) throw fromDatabaseError(error, { resource: "account" });

  return data === true;
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}

/**
 * Every active membership of the signed-in user, for the tenant switcher.
 * Resolved server-side on every request — the active-tenant cookie is a
 * convenience, never a grant.
 */
export const getMemberships = cache(async (): Promise<MembershipSummary[]> => {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_memberships");
  if (error) throw fromDatabaseError(error, { resource: "membership" });

  return (data ?? []).map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    tenantTimezone: row.tenant_timezone,
    roleKey: row.role_key,
    roleName: row.role_name,
    roleRank: row.role_rank,
  }));
});

/**
 * Resolves the active tenant.
 *
 * The cookie only *selects* among tenants the user already belongs to. A
 * forged or stale value resolves to nothing and the user is sent to the tenant
 * picker; it can never widen access.
 */
async function resolveActiveTenantId(
  memberships: MembershipSummary[],
  isPlatformAdmin: boolean,
): Promise<string | null> {
  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;

  if (requested && memberships.some((m) => m.tenantId === requested)) {
    return requested;
  }

  // Staff may enter any club. The cookie still only *names* one — the club is
  // then loaded through RLS, which is what actually authorises the access.
  if (isPlatformAdmin && requested) return requested;

  if (memberships.length === 1) return memberships[0].tenantId;
  return null;
}

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const [memberships, isPlatformAdmin] = await Promise.all([
    getMemberships(),
    getIsPlatformAdmin(),
  ]);

  const tenantId = await resolveActiveTenantId(memberships, isPlatformAdmin);
  if (!tenantId) return null;

  const membership = memberships.find((m) => m.tenantId === tenantId);
  // Staff without a membership here are acting on the club, not in it.
  if (!membership && !isPlatformAdmin) return null;

  const supabase = await createClient();

  // Both reads are RLS-scoped, so they double as a membership check.
  const [tenantResult, permissionResult] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, timezone, locale, week_start")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase.rpc("my_permissions", { p_tenant: tenantId }),
  ]);

  if (tenantResult.error) throw fromDatabaseError(tenantResult.error, { resource: "club" });
  if (permissionResult.error) {
    throw fromDatabaseError(permissionResult.error, { resource: "permission" });
  }
  if (!tenantResult.data) return null;

  const permissions = new Set<Permission>();
  for (const key of (permissionResult.data ?? []) as unknown as string[]) {
    // Guards against a permission existing in the database but not yet in the
    // TypeScript taxonomy — it is ignored rather than silently trusted.
    if (isPermission(key)) permissions.add(key);
  }

  return {
    user,
    tenant: {
      id: tenantResult.data.id,
      name: tenantResult.data.name,
      slug: tenantResult.data.slug,
      timezone: tenantResult.data.timezone,
      locale: tenantResult.data.locale,
      weekStart: tenantResult.data.week_start,
    },
    role: membership
      ? { key: membership.roleKey, name: membership.roleName, rank: membership.roleRank }
      : { ...PLATFORM_ADMIN_ROLE },
    permissions,
    actorType: membership ? "WEB" : "PLATFORM_ADMIN",
    isPlatformAdmin,
    isActingAsStaff: isPlatformAdmin && !membership,
    db: supabase,
  };
});

/**
 * The authenticated, tenant-resolved context. Throws rather than returning
 * null, so a caller can never forget to handle the unauthenticated case.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();

  const context = await getAuthContext();
  if (!context) {
    throw new AuthorizationError(
      "Select a club to continue, or ask an administrator to invite you to one.",
    );
  }
  return context;
}

/** Asserts the caller is system staff. Guards the /admin console. */
export async function requirePlatformAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (!(await getIsPlatformAdmin())) {
    throw new AuthorizationError("That area is restricted to platform administrators.");
  }
  return user;
}
