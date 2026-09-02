"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { createTeamSchema, updateTeamSchema } from "@/lib/validation/team";
import {
  archiveTeam,
  createTeam,
  restoreTeam,
  updateTeam,
} from "@/server/services/team-service";

export async function createTeamAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.create");
    const team = await createTeam(context, parseInput(createTeamSchema, input));
    revalidatePath("/teams");
    return { id: team.id, name: team.name };
  });
}

export async function updateTeamAction(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.update");
    const team = await updateTeam(context, parseInput(updateTeamSchema, input));
    revalidatePath("/teams");
    return { id: team.id, name: team.name };
  });
}

export async function archiveTeamAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.delete");
    const team = await archiveTeam(context, id);
    revalidatePath("/teams");
    return { name: team.name };
  });
}

export async function restoreTeamAction(id: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("teams.update");
    const team = await restoreTeam(context, id);
    revalidatePath("/teams");
    return { name: team.name };
  });
}
