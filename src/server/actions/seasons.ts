"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  createSeasonSchema,
  duplicateSeasonSchema,
  updateSeasonSchema,
} from "@/lib/validation/season";
import {
  activateSeason,
  archiveSeason,
  createSeason,
  duplicateSeason,
  updateSeason,
} from "@/server/services/season-service";

/**
 * Server actions are the transport layer only: resolve the caller, validate the
 * input, delegate to the service. The business rules live in the service so MCP
 * and background jobs reach them the same way.
 */

export async function createSeasonAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("seasons.create");
    const season = await createSeason(context, parseInput(createSeasonSchema, input));
    revalidatePath("/seasons");
    return { id: season.id, name: season.name };
  });
}

export async function updateSeasonAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("seasons.update");
    const season = await updateSeason(context, parseInput(updateSeasonSchema, input));
    revalidatePath("/seasons");
    return { id: season.id, name: season.name };
  });
}

export async function activateSeasonAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("seasons.update");
    const season = await activateSeason(context, id);
    revalidatePath("/seasons");
    revalidatePath("/dashboard");
    return { name: season.name };
  });
}

export async function archiveSeasonAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("seasons.archive");
    const season = await archiveSeason(context, id);
    revalidatePath("/seasons");
    revalidatePath("/dashboard");
    return { name: season.name };
  });
}

export async function duplicateSeasonAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; copied: Record<string, number> }>> {
  return runAction(async () => {
    const context = await requirePermission("seasons.create");
    const { season, copied } = await duplicateSeason(
      context,
      parseInput(duplicateSeasonSchema, input),
    );
    revalidatePath("/seasons");
    return { id: season.id, name: season.name, copied };
  });
}
