"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { fromDatabaseError } from "@/lib/errors";
import { requireAuthContext } from "@/server/auth/context";
import { requirePermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, diffFields, recordAudit } from "@/server/services/audit-service";
import { LOCALES } from "@/i18n/config";

const clubSchema = z.object({
  name: z.string().trim().min(2).max(200),
  timezone: z.string().trim().min(1).max(64),
  locale: z.enum(LOCALES),
  weekStart: z.coerce.number().int().min(1).max(7),
});

const profileSchema = z.object({
  fullName: z.string().trim().max(120).optional().transform((v) => v || null),
  timezone: z.string().trim().min(1).max(64),
});

export async function updateClubAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("tenant.update");
    const values = parseInput(clubSchema, input);

    const changes = {
      name: values.name,
      timezone: values.timezone,
      locale: values.locale,
      week_start: values.weekStart,
    };

    const { error } = await context.db
      .from("tenants")
      .update(changes)
      .eq("id", context.tenant.id);

    if (error) throw fromDatabaseError(error, { resource: "club" });

    const diff = diffFields(
      {
        name: context.tenant.name,
        timezone: context.tenant.timezone,
        locale: context.tenant.locale,
        week_start: context.tenant.weekStart,
      },
      changes,
    );

    if (diff) {
      await recordAudit(context, {
        action: AUDIT_ACTIONS.TENANT_UPDATED,
        resourceType: "tenant",
        resourceId: context.tenant.id,
        ...diff,
      });
    }

    // The timezone governs how every stored instant is displayed, so anything
    // showing a time has to be rebuilt.
    revalidatePath("/", "layout");
    return null;
  });
}

export async function updateProfileAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requireAuthContext();
    const values = parseInput(profileSchema, input);

    const { error } = await context.db
      .from("profiles")
      .update({ full_name: values.fullName, timezone: values.timezone })
      .eq("id", context.user.id);

    if (error) throw fromDatabaseError(error, { resource: "profile" });

    revalidatePath("/", "layout");
    return null;
  });
}
