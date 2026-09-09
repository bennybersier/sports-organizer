"use server";

import { runAction, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { getTeamCoachingStaff } from "@/server/services/team-service";

/**
 * Reads the current coaching staff for one team, and which of them leads it.
 *
 * Loaded on demand when the edit dialog opens, rather than fetched for every
 * row of the list — most rows are never edited.
 *
 * The head coach travels with the list because the form sends both back on
 * save. Without it, opening the edit dialog and pressing save would quietly
 * demote whoever was leading the side.
 */
export async function getTeamCoachingStaffAction(
  teamId: string,
): Promise<ActionResult<{ trainerIds: string[]; headCoachId: string | null }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.read");
    return getTeamCoachingStaff(context, teamId);
  });
}
