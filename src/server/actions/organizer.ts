"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { ConflictError, fromDatabaseError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/authorization";
import { generateAndStore } from "@/server/services/schedule-generation-service";
import {
  cancelScheduleEntry,
  cancelScheduleSeries,
  restoreScheduleSeries,
  publishScheduleVersion,
  restoreScheduleEntry,
  withdrawSchedule,
} from "@/server/services/schedule-publish-service";
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

/**
 * Takes a published schedule off the calendar without destroying it.
 *
 * To remove one entirely: withdraw, then discard. Two steps, so the
 * destructive one is deliberate.
 */
export async function withdrawScheduleAction(versionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.publish");
    await withdrawSchedule(context, versionId);
    revalidatePath("/organizer");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return null;
  });
}

export async function cancelScheduleEntryAction(
  entryId: string,
  reason?: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.review");
    await cancelScheduleEntry(context, entryId, reason ?? null);
    revalidatePath("/calendar");
    return null;
  });
}

/**
 * Cancels this occurrence and every later one in the same recurring slot.
 * Returns how many, because "12 sessions cancelled" is the confirmation a user
 * needs to know they hit the right thing.
 */
export async function cancelScheduleSeriesAction(
  entryId: string,
  reason?: string,
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.review");
    const count = await cancelScheduleSeries(context, entryId, reason ?? null);
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return { count };
  });
}

export async function restoreScheduleSeriesAction(
  entryId: string,
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.review");
    const count = await restoreScheduleSeries(context, entryId);
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return { count };
  });
}

export async function restoreScheduleEntryAction(entryId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("schedule.review");
    await restoreScheduleEntry(context, entryId);
    revalidatePath("/calendar");
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
      throw new ConflictError(
        "Withdraw this schedule first — that takes it off the calendar. It can then be discarded.",
      );
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
