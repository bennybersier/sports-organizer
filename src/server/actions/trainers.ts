"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { createTrainerSchema, updateTrainerSchema } from "@/lib/validation/trainer";
import {
  archiveTrainer,
  createTrainer,
  restoreTrainer,
  updateTrainer,
} from "@/server/services/trainer-service";

const fullName = (t: { first_name: string; last_name: string }) =>
  `${t.first_name} ${t.last_name}`;

export async function createTrainerAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("trainers.create");
    const trainer = await createTrainer(context, parseInput(createTrainerSchema, input));
    revalidatePath("/trainers");
    return { id: trainer.id, name: fullName(trainer) };
  });
}

export async function updateTrainerAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("trainers.update");
    const trainer = await updateTrainer(context, parseInput(updateTrainerSchema, input));
    revalidatePath("/trainers");
    return { id: trainer.id, name: fullName(trainer) };
  });
}

export async function archiveTrainerAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("trainers.delete");
    const trainer = await archiveTrainer(context, id);
    revalidatePath("/trainers");
    return { name: fullName(trainer) };
  });
}

export async function restoreTrainerAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("trainers.update");
    const trainer = await restoreTrainer(context, id);
    revalidatePath("/trainers");
    return { name: fullName(trainer) };
  });
}
