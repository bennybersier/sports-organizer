import "server-only";

import { AuthorizationError } from "@/lib/errors";
import type { Permission } from "@/domain/permissions";

import { requireAuthContext, type AuthContext } from "./context";

/**
 * The central authorization service.
 *
 * Every interface — Server Components, Server Actions, Route Handlers, MCP
 * tools, background jobs, AI-initiated actions — calls through these helpers.
 * Permission logic lives here and nowhere else; components never re-derive it.
 *
 * These checks are the *first* line of defence. RLS in Postgres is the second:
 * a mistake here still cannot read another tenant's rows through a user-scoped
 * client.
 */

export function hasPermission(context: AuthContext, permission: Permission): boolean {
  return context.permissions.has(permission);
}

/** True when the caller holds every one of the listed permissions. */
export function hasAllPermissions(context: AuthContext, permissions: Permission[]): boolean {
  return permissions.every((permission) => context.permissions.has(permission));
}

/** True when the caller holds at least one of the listed permissions. */
export function hasAnyPermission(context: AuthContext, permissions: Permission[]): boolean {
  return permissions.some((permission) => context.permissions.has(permission));
}

/**
 * Resolves the context and asserts a permission in one step — the form most
 * call sites want:
 *
 *     const context = await requirePermission("teams.create");
 */
export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const context = await requireAuthContext();
  assertPermission(context, permission);
  return context;
}

export async function requireAnyPermission(permissions: Permission[]): Promise<AuthContext> {
  const context = await requireAuthContext();
  if (!hasAnyPermission(context, permissions)) {
    throw new AuthorizationError(undefined, {
      context: { required: permissions, role: context.role.key },
    });
  }
  return context;
}

/** Asserts against a context that has already been resolved. */
export function assertPermission(context: AuthContext, permission: Permission): void {
  if (!context.permissions.has(permission)) {
    throw new AuthorizationError(undefined, {
      context: { required: permission, role: context.role.key, tenantId: context.tenant.id },
    });
  }
}

/** Membership alone, with no particular permission attached. */
export async function requireTenantMembership(): Promise<AuthContext> {
  return requireAuthContext();
}

/**
 * Asserts the caller holds one of the given roles.
 *
 * Prefer `requirePermission` — permissions are the real authorization model and
 * survive role changes and per-user overrides. Use this only where the rule is
 * genuinely about identity rather than capability.
 */
export async function requireRole(roleKeys: string[]): Promise<AuthContext> {
  const context = await requireAuthContext();
  if (!roleKeys.includes(context.role.key)) {
    throw new AuthorizationError(undefined, {
      context: { required: roleKeys, role: context.role.key },
    });
  }
  return context;
}

/**
 * Guards actions taken *on another member*.
 *
 * A user may only act on someone strictly less privileged than themselves, so
 * an Admin cannot demote an Owner and nobody can escalate their own role. Owners
 * are allowed to act on other Owners so co-ownership stays manageable; the
 * database's last-owner trigger still prevents the club losing its last one.
 */
export function assertOutranks(context: AuthContext, targetRoleRank: number): void {
  const isOwner = context.role.rank === 0;
  const outranks = isOwner ? targetRoleRank >= context.role.rank : targetRoleRank > context.role.rank;

  if (!outranks) {
    throw new AuthorizationError(
      "You can't change a member with the same or higher level of access than your own.",
      { context: { actorRank: context.role.rank, targetRank: targetRoleRank } },
    );
  }
}

/**
 * Guards *granting* a role: you can never hand out access above your own level.
 */
export function assertCanGrantRole(context: AuthContext, roleRank: number): void {
  if (roleRank < context.role.rank) {
    throw new AuthorizationError(
      "You can't grant a role with more access than your own.",
      { context: { actorRank: context.role.rank, grantedRank: roleRank } },
    );
  }
}

/**
 * Filters a list of items by permission — the helper the navigation and any
 * conditional UI uses, so "hide it" and "deny it" always agree.
 *
 * Hiding UI is never authorization on its own; the server check still runs.
 */
export function filterByPermission<T extends { permission?: Permission }>(
  context: AuthContext,
  items: T[],
): T[] {
  return items.filter((item) => !item.permission || context.permissions.has(item.permission));
}
