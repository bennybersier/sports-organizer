"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  createCompetitionSchema,
  generateFixturesSchema,
  scheduleFixtureSchema,
  setEntriesSchema,
  updateCompetitionSchema,
} from "@/lib/validation/competition";
import {
  archiveCompetition,
  createCompetition,
  generateFixtures,
  restoreCompetition,
  scheduleFixture,
  setEntries,
  updateCompetition,
} from "@/server/services/competition-service";

export async function createCompetitionAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.create");
    const competition = await createCompetition(context, parseInput(createCompetitionSchema, input));
    revalidatePath("/competitions");
    return { id: competition.id, name: competition.name };
  });
}

export async function updateCompetitionAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.update");
    const competition = await updateCompetition(context, parseInput(updateCompetitionSchema, input));
    revalidatePath("/competitions");
    revalidatePath(`/competitions/${competition.id}`);
    return { id: competition.id, name: competition.name };
  });
}

export async function archiveCompetitionAction(
  id: string,
): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.delete");
    const competition = await archiveCompetition(context, id);
    revalidatePath("/competitions");
    return { name: competition.name };
  });
}

export async function restoreCompetitionAction(
  id: string,
): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.update");
    const competition = await restoreCompetition(context, id);
    revalidatePath("/competitions");
    return { name: competition.name };
  });
}

export async function setEntriesAction(input: unknown): Promise<ActionResult<{ clubs: number }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.update");
    const values = parseInput(setEntriesSchema, input);
    await setEntries(context, values);
    revalidatePath(`/competitions/${values.competitionId}`);
    return { clubs: values.clubs.length };
  });
}

export async function generateFixturesAction(
  input: unknown,
): Promise<ActionResult<{ fixtures: number }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.create");
    const values = parseInput(generateFixturesSchema, input);
    const fixtures = await generateFixtures(context, values.competitionId);
    revalidatePath(`/competitions/${values.competitionId}`);
    revalidatePath("/calendar");
    return { fixtures };
  });
}

export async function scheduleFixtureAction(
  input: unknown,
): Promise<ActionResult<{ dated: boolean }>> {
  return runAction(async () => {
    const context = await requirePermission("competitions.update");
    const fixture = await scheduleFixture(context, parseInput(scheduleFixtureSchema, input));
    revalidatePath(`/competitions/${fixture.competition_id}`);
    // A dated fixture is on the calendar and in the team's week from now on.
    revalidatePath("/calendar");
    revalidatePath("/teams");
    return { dated: fixture.starts_at !== null };
  });
}
