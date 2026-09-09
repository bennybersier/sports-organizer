"use server";

import { runAction, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { listGymOptions } from "@/server/services/gym-service";
import { getTrainingRequirement } from "@/server/services/training-requirement-service";
import type { TrainingRequirement } from "@/server/services/training-requirement-service";

/**
 * One team's requirements, and the halls it could use.
 *
 * Fetched when the organizer's shortfall list is asked to open a team, rather
 * than loaded for every side in a run that may name a dozen of them. A club
 * reads that list far more often than it acts on any one line of it.
 */
export async function getTeamRequirementAction(
  teamId: string,
  seasonId: string,
): Promise<ActionResult<{ requirement: TrainingRequirement; gyms: { value: string; label: string }[] }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.read");
    const [requirement, gyms] = await Promise.all([
      getTrainingRequirement(context, teamId, seasonId),
      listGymOptions(context),
    ]);
    return {
      requirement,
      gyms: gyms.map((gym) => ({ value: gym.id, label: gym.name })),
    };
  });
}
