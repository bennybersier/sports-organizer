"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { env } from "@/env";
import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { fromDatabaseError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_TENANT_COOKIE, requirePlatformAdmin } from "@/server/auth/context";
import { recordAudit, AUDIT_ACTIONS } from "@/server/services/audit-service";

const TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.APP_ENV !== "development",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

const createTenantSchema = z.object({
  name: z.string().trim().min(2, "Give the club a name.").max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/,
      "Use 3–50 lowercase letters, numbers and hyphens.",
    ),
  ownerEmail: z.email("Enter the owner's email address.").toLowerCase(),
  timezone: z.string().min(1).default("Europe/Zurich"),
});

/**
 * Creates a club and assigns its first Owner.
 *
 * Staff-only, and the authorization is enforced twice: here, and again inside
 * `admin_create_tenant`, which re-checks `app.is_platform_admin()` in the same
 * transaction that writes the rows.
 */
export async function createTenant(input: unknown): Promise<ActionResult<{ tenantId: string }>> {
  return runAction(async () => {
    await requirePlatformAdmin();
    const values = parseInput(createTenantSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_create_tenant", {
      p_name: values.name,
      p_slug: values.slug,
      p_owner_email: values.ownerEmail,
      p_timezone: values.timezone,
    });

    if (error) {
      throw fromDatabaseError(error, {
        resource: "club",
        conflictMessages: {
          tenants_slug_key: "A club already uses that URL name. Pick another.",
        },
      });
    }

    revalidatePath("/admin");
    return { tenantId: data as unknown as string };
  });
}

/**
 * Enters a club as staff.
 *
 * Recorded in that club's audit log, so a club owner can always see when
 * platform staff looked at their data. The bypass is powerful; it should never
 * be invisible to the people it affects.
 */
export async function enterTenantAsStaff(
  tenantId: string,
  reason?: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePlatformAdmin();

    const supabase = await createClient();
    const { data: tenant, error } = await supabase
      .from("tenants")
      .select("id, name, slug, timezone, locale, week_start")
      .eq("id", tenantId)
      .maybeSingle();

    if (error) throw fromDatabaseError(error, { resource: "club" });
    if (!tenant) throw fromDatabaseError({ code: "PGRST116" }, { resource: "club" });

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, TENANT_COOKIE_OPTIONS);

    await recordAudit(
      {
        user,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          timezone: tenant.timezone,
          locale: tenant.locale,
          weekStart: tenant.week_start,
        },
        role: { key: "PLATFORM_ADMIN", name: "Platform admin", rank: -1 },
        permissions: new Set(),
        actorType: "PLATFORM_ADMIN",
        isPlatformAdmin: true,
        isActingAsStaff: true,
        db: supabase,
      },
      {
        action: AUDIT_ACTIONS.PLATFORM_ADMIN_ENTERED_TENANT,
        resourceType: "tenant",
        resourceId: tenantId,
        reason: reason ?? null,
      },
    );

    return null;
  });
}

/** Leaves the club context and returns to the system console. */
export async function leaveTenantAsStaff(): Promise<ActionResult<null>> {
  return runAction(async () => {
    await requirePlatformAdmin();
    const cookieStore = await cookies();
    cookieStore.delete(ACTIVE_TENANT_COOKIE);
    return null;
  });
}
