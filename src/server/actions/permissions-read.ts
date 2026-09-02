"use server";

import { runAction, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { getMemberPermissions } from "@/server/services/membership-service";

export interface PermissionMatrixRow {
  key: string;
  category: string;
  description: string;
  sortOrder: number;
  fromRole: boolean;
  override: "ALLOW" | "DENY" | null;
  effective: boolean;
}

/**
 * The permission matrix for one member.
 *
 * Loaded on demand when the sheet opens rather than for every row of the
 * members table — most members are never inspected.
 */
export async function getPermissionMatrixAction(
  userId: string,
): Promise<ActionResult<PermissionMatrixRow[]>> {
  return runAction(async () => {
    const context = await requirePermission("roles.read");
    const { effective, overrides, roleDefaults } = await getMemberPermissions(context, userId);

    const { data } = await context.db
      .from("permissions")
      .select("key, category, description, sort_order")
      .order("category")
      .order("sort_order");

    return (data ?? []).map((permission) => ({
      key: permission.key,
      category: permission.category,
      description: permission.description,
      sortOrder: permission.sort_order,
      fromRole: roleDefaults.has(permission.key),
      override: overrides.get(permission.key) ?? null,
      effective: effective.has(permission.key as never),
    }));
  });
}
