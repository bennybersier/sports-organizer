"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { createGymSchema, updateGymSchema } from "@/lib/validation/gym";
import {
  archiveGym,
  createGym,
  restoreGym,
  updateGym,
} from "@/server/services/gym-service";

export async function createGymAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("gyms.create");
    const gym = await createGym(context, parseInput(createGymSchema, input));
    revalidatePath("/gyms");
    return { id: gym.id, name: gym.name };
  });
}

export async function updateGymAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("gyms.update");
    const gym = await updateGym(context, parseInput(updateGymSchema, input));
    revalidatePath("/gyms");
    return { id: gym.id, name: gym.name };
  });
}

export async function archiveGymAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("gyms.delete");
    const gym = await archiveGym(context, id);
    revalidatePath("/gyms");
    return { name: gym.name };
  });
}

export async function restoreGymAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("gyms.update");
    const gym = await restoreGym(context, id);
    revalidatePath("/gyms");
    return { name: gym.name };
  });
}
