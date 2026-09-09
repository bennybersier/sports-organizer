"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  declareAbsenceSchema,
  saveBoxScoresSchema,
  saveEvaluationSchema,
  saveRegisterSchema,
} from "@/lib/validation/attendance";
import {
  cancelRegister,
  declareAbsence,
  deleteAbsence,
  openMatchRegister,
  openTrainingRegister,
  reopenRegister,
  saveRegister,
} from "@/server/services/attendance-service";
import { saveBoxScores, saveEvaluation } from "@/server/services/performance-service";

/**
 * The register's public surface.
 *
 * A whole sheet goes back in `saveRegisterAction` — one call, not one per
 * player. Next.js dispatches Server Actions one at a time per client, so a
 * tap-per-request register would queue sixteen deep; and a coach marking a
 * sheet in a gym with two bars needs the network touched once, when they press
 * save, rather than after every name.
 *
 * Every action re-checks its permission. An action is a public HTTP endpoint,
 * and the fact that the button was only rendered for a coach is not a control.
 */

export async function openTrainingRegisterAction(
  scheduleEntryId: string,
): Promise<ActionResult<{ registerId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const registerId = await openTrainingRegister(context, scheduleEntryId);
    revalidatePath("/attendance");
    return { registerId };
  });
}

export async function openMatchRegisterAction(
  eventId: string,
  teamId: string,
): Promise<ActionResult<{ registerId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const registerId = await openMatchRegister(context, eventId, teamId);
    revalidatePath("/attendance");
    return { registerId };
  });
}

export async function saveRegisterAction(
  input: unknown,
): Promise<ActionResult<{ registerId: string; marked: number }>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const result = await saveRegister(context, parseInput(saveRegisterSchema, input));
    revalidatePath("/attendance");
    revalidatePath(`/attendance/${result.registerId}`);
    return result;
  });
}

export async function cancelRegisterAction(
  registerId: string,
  reason: string | null,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    await cancelRegister(context, registerId, reason);
    revalidatePath("/attendance");
    revalidatePath(`/attendance/${registerId}`);
  });
}

export async function reopenRegisterAction(registerId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.manage");
    await reopenRegister(context, registerId);
    revalidatePath("/attendance");
    revalidatePath(`/attendance/${registerId}`);
  });
}

export async function declareAbsenceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const result = await declareAbsence(context, parseInput(declareAbsenceSchema, input));
    revalidatePath("/attendance");
    revalidatePath("/athletes");
    return result;
  });
}

export async function deleteAbsenceAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    await deleteAbsence(context, id);
    revalidatePath("/attendance");
    revalidatePath("/athletes");
  });
}

export async function saveBoxScoresAction(
  input: unknown,
): Promise<ActionResult<{ saved: number }>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const parsed = parseInput(saveBoxScoresSchema, input);
    const result = await saveBoxScores(context, parsed);
    revalidatePath(`/attendance/${parsed.registerId}`);
    return result;
  });
}

export async function saveEvaluationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const context = await requirePermission("evaluations.write");
    const parsed = parseInput(saveEvaluationSchema, input);
    const result = await saveEvaluation(context, parsed);
    revalidatePath(`/athletes/${parsed.athleteId}`);
    return result;
  });
}
