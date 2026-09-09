"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { uuidSchema } from "@/lib/validation/common";
import { setAthleteTeams } from "@/server/services/athlete-service";
import { setTrainerTeams } from "@/server/services/trainer-service";
import { setTeamAthletes, setTeamTrainers } from "@/server/services/team-service";

/**
 * The links between records, changed from whichever page you are looking at.
 *
 * Four actions rather than one generic pair, because the permission differs by
 * where you stand: adding a coach to a team is a team decision, changing which
 * squads a player is in is the player's record. The same join sometimes gets
 * written from both sides, which is correct — a team manager and a registrar
 * both have a legitimate claim on it.
 */
const relationSchema = z.object({
  id: uuidSchema,
  relatedIds: z.array(uuidSchema).max(200),
});

/**
 * Coaching staff carries one extra fact: which of them leads the side.
 *
 * Sent with the list rather than as its own action, because "these are the
 * coaches and this one is head" is a single decision — splitting it would let
 * a team briefly have a head coach who is no longer on its staff.
 */
const coachingStaffSchema = relationSchema.extend({
  headCoachId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
});

export async function setTeamTrainersAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.update");
    const { id, relatedIds, headCoachId } = parseInput(coachingStaffSchema, input);
    await setTeamTrainers(context, id, relatedIds, headCoachId);
    revalidatePath(`/teams/${id}`);
    revalidatePath("/trainers");
    return { count: relatedIds.length };
  });
}

export async function setTeamAthletesAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.update");
    const { id, relatedIds } = parseInput(relationSchema, input);
    await setTeamAthletes(context, id, relatedIds);
    revalidatePath(`/teams/${id}`);
    revalidatePath("/athletes");
    return { count: relatedIds.length };
  });
}

export async function setAthleteTeamsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requirePermission("athletes.update");
    const { id, relatedIds } = parseInput(relationSchema, input);
    await setAthleteTeams(context, id, relatedIds);
    revalidatePath(`/athletes/${id}`);
    revalidatePath("/teams");
    return { count: relatedIds.length };
  });
}

export async function setTrainerTeamsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const context = await requirePermission("trainers.update");
    const { id, relatedIds } = parseInput(relationSchema, input);
    await setTrainerTeams(context, id, relatedIds);
    revalidatePath(`/trainers/${id}`);
    revalidatePath("/teams");
    return { count: relatedIds.length };
  });
}
