"use server";

import { runAction, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { getTrainerTeamIds } from "@/server/services/trainer-service";

/**
 * Current team assignments for one trainer.
 *
 * Loaded when the edit dialog opens rather than for every row of the list —
 * most rows are never edited.
 */
export async function getTrainerTeamIdsAction(
  trainerId: string,
): Promise<ActionResult<string[]>> {
  return runAction(async () => {
    const context = await requirePermission("trainers.read");
    return getTrainerTeamIds(context, trainerId);
  });
}
