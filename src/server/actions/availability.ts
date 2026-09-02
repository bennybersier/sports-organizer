"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  availabilityDomainSchema,
  createAvailabilitySchema,
  createExceptionSchema,
  updateAvailabilitySchema,
  type AvailabilityDomain,
} from "@/lib/validation/availability";
import { trainingRequirementSchema } from "@/lib/validation/training-requirement";
import {
  createAvailability,
  createException,
  deleteAvailability,
  deleteException,
  updateAvailability,
} from "@/server/services/availability-service";
import { saveTrainingRequirement } from "@/server/services/training-requirement-service";

/** Where to revalidate after a change, by domain. */
const PATHS: Record<AvailabilityDomain, string> = {
  gym: "/gyms",
  trainer: "/trainers",
  team: "/teams",
};

export async function createAvailabilityAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("availability.create");
    const values = parseInput(createAvailabilitySchema, input);
    await createAvailability(context, values);
    revalidatePath(`${PATHS[values.domain]}/${values.ownerId}`);
    return null;
  });
}

export async function updateAvailabilityAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("availability.update");
    const values = parseInput(updateAvailabilitySchema, input);
    await updateAvailability(context, values);
    revalidatePath(`${PATHS[values.domain]}/${values.ownerId}`);
    return null;
  });
}

export async function deleteAvailabilityAction(
  domain: string,
  id: string,
  ownerId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("availability.delete");
    const parsed = parseInput(availabilityDomainSchema, domain);
    await deleteAvailability(context, parsed, id);
    revalidatePath(`${PATHS[parsed]}/${ownerId}`);
    return null;
  });
}

export async function createExceptionAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("availability.create");
    const values = parseInput(createExceptionSchema, input);
    await createException(context, values);
    revalidatePath(`${PATHS[values.domain]}/${values.ownerId}`);
    return null;
  });
}

export async function deleteExceptionAction(
  domain: string,
  id: string,
  ownerId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("availability.delete");
    const parsed = parseInput(availabilityDomainSchema, domain);
    await deleteException(context, parsed, id);
    revalidatePath(`${PATHS[parsed]}/${ownerId}`);
    return null;
  });
}

export async function saveTrainingRequirementAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("teams.update");
    const values = parseInput(trainingRequirementSchema, input);
    await saveTrainingRequirement(context, values);
    revalidatePath(`/teams/${values.teamId}`);
    return null;
  });
}
