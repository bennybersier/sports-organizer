"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { ConflictError, fromDatabaseError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/authorization";
import { generateAndStore } from "@/server/services/schedule-generation-service";
import { publishScheduleVersion } from "@/server/services/schedule-publish-service";
import type { GenerationResult } from "@/domain/scheduling/types";

const generateSchema = z.object({
  seasonId: z.uuid(),
  teamIds: z.array(z.uuid()).default([]),
  gymIds: z.array(z.uuid()).default([]),
  name: z.string().trim().max(100).optional(),
});

export async function generateScheduleAction(
  input: unknown,
): Promise<ActionResult<{ versionId: string; result: GenerationResult }>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.generate");
    const values = parseInput(generateSchema, input);

    const { versionId, result } = await generateAndStore(context, {
      seasonId: values.seasonId,
      teamIds: values.teamIds,
      gymIds: values.gymIds,
      name: values.name,
    });

    revalidatePath("/organizer");
    revalidatePath("/calendar");
    return { versionId, result };
  });
}

/**
 * Publishes a draft.
 *
 * The promotion itself happens in `publish_schedule_version`, in one
 * transaction: the previous published version is archived and this one takes
 * its place. Nothing is ever edited in place on a live schedule.
 */
export async function publishScheduleAction(versionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.publish");
    await publishScheduleVersion(context, versionId);

    revalidatePath("/organizer");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return null;
  });
}

export async function discardVersionAction(versionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.review");

    const { data: version } = await context.db
      .from("schedule_versions")
      .select("status")
      .eq("tenant_id", context.tenant.id)
      .eq("id", versionId)
      .maybeSingle();

    if (version?.status === "PUBLISHED") {
      throw new ConflictError("A published schedule can't be discarded. Publish another instead.");
    }

    // Entries cascade with the version.
    const { error } = await context.db
      .from("schedule_versions")
      .delete()
      .eq("tenant_id", context.tenant.id)
      .eq("id", versionId);

    if (error) throw fromDatabaseError(error, { resource: "schedule" });

    revalidatePath("/organizer");
    return null;
  });
}
