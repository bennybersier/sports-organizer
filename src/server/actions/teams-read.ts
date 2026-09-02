"use server";

import { runAction, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { getTeamTrainerIds } from "@/server/services/team-service";

/**
 * Reads the current coaching assignments for one team.
 *
 * Loaded on demand when the edit dialog opens, rather than fetched for every
 * row of the list — most rows are never edited.
 */
export async function getTeamTrainerIdsAction(teamId: string): Promise<ActionResult<string[]>> {
  return runAction(async () => {
    const context = await requirePermission("teams.read");
    return getTeamTrainerIds(context, teamId);
  });
}
