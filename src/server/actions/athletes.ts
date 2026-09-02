"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { createAthleteSchema, updateAthleteSchema } from "@/lib/validation/athlete";
import {
  archiveAthlete,
  createAthlete,
  restoreAthlete,
  updateAthlete,
} from "@/server/services/athlete-service";

const fullName = (a: { first_name: string; last_name: string }) =>
  `${a.first_name} ${a.last_name}`;

export async function createAthleteAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("athletes.create");
    const athlete = await createAthlete(context, parseInput(createAthleteSchema, input));
    revalidatePath("/athletes");
    return { id: athlete.id, name: fullName(athlete) };
  });
}

export async function updateAthleteAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("athletes.update");
    const athlete = await updateAthlete(context, parseInput(updateAthleteSchema, input));
    revalidatePath("/athletes");
    return { id: athlete.id, name: fullName(athlete) };
  });
}

export async function archiveAthleteAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("athletes.delete");
    const athlete = await archiveAthlete(context, id);
    revalidatePath("/athletes");
    return { name: fullName(athlete) };
  });
}

export async function restoreAthleteAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("athletes.update");
    const athlete = await restoreAthlete(context, id);
    revalidatePath("/athletes");
    return { name: fullName(athlete) };
  });
}
