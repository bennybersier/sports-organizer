"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/authorization";
import { saveResultSchema } from "@/lib/validation/match";
import {
  importSheetSchema,
  readSheetSchema,
  reviseSheetSchema,
} from "@/lib/validation/referto";
import { saveResult, type MatchResultSummary } from "@/server/services/match-service";
import { openMatchRegister } from "@/server/services/attendance-service";
import {
  deleteSheet,
  importSheet,
  readSheet,
  reviseSheet,
  uploadSheet,
  type ImportOutcome,
  type SheetView,
} from "@/server/services/match-sheet-service";

/**
 * Every path that changes a match.
 *
 * The revalidations are wide on purpose: a score typed on the match page shows
 * up in the team's record, in the competition's fixture list, on the matches
 * index and on the register — and a result that appears in one place and not
 * another reads as a bug long before anybody suspects a cache.
 */
function revalidateMatch(eventId: string, teamId: string) {
  revalidatePath("/matches");
  revalidatePath(`/matches/${eventId}/${teamId}`);
  revalidatePath("/competitions");
  revalidatePath("/teams");
}

export async function saveResultAction(
  input: unknown,
): Promise<ActionResult<MatchResultSummary>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const values = parseInput(saveResultSchema, input);
    const result = await saveResult(context, values);
    revalidateMatch(values.eventId, values.teamId);
    return result;
  });
}

/**
 * Takes the photograph itself, as multipart form data.
 *
 * A Server Action's body is capped at 1 MB by default and a phone photograph is
 * several; `serverActions.bodySizeLimit` in next.config.ts raises it. The file
 * is read into memory here because it goes straight back out to storage and
 * never touches disk.
 */
export async function uploadSheetAction(formData: FormData): Promise<ActionResult<SheetView>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError("Choose a photograph of the game sheet.", {
        fieldErrors: { file: ["Choose a photograph of the game sheet."] },
      });
    }

    /*
      A sheet belongs to a register, but a club that photographs the referto
      rather than picking a squad in the app has not opened one — and being
      told to go and do that first, on the page where the photograph is in
      your hand, is how a feature stops being used. So the register is opened
      here when it is missing.

      `openMatchRegister` is idempotent, so this is safe against two people
      uploading from two phones at the same time, and it is the same call the
      attendance page makes.
    */
    const given = formData.get("registerId");
    const eventId = formData.get("eventId");
    const teamId = formData.get("teamId");

    let registerId: string;
    if (typeof given === "string" && given !== "") {
      registerId = given;
    } else if (typeof eventId === "string" && typeof teamId === "string") {
      registerId = await openMatchRegister(context, eventId, teamId);
    } else {
      throw new ValidationError("That sheet has no match to belong to.");
    }

    const sheet = await uploadSheet(context, {
      registerId,
      fileName: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
    });

    revalidatePath("/matches");
    if (typeof eventId === "string" && typeof teamId === "string") {
      // The match page shows the register it now has.
      revalidatePath(`/matches/${eventId}/${teamId}`);
    }
    return sheet;
  });
}

/**
 * Asks a model to read a stored sheet.
 *
 * Requires `ai.read` as well as `attendance.record`: this is the one action
 * here that spends the club's own API key, and a club that has not configured
 * a provider should be told that rather than shown a failure.
 */
export async function readSheetAction(input: unknown): Promise<ActionResult<SheetView>> {
  return runAction(async () => {
    const context = await requirePermission("ai.read");
    const values = parseInput(readSheetSchema, input);
    const sheet = await readSheet(context, values.sheetId);
    revalidatePath("/matches/[eventId]/[teamId]", "page");
    return sheet;
  });
}

/** Re-derives a sheet from a corrected transcription. No model call, no charge. */
export async function reviseSheetAction(input: unknown): Promise<ActionResult<SheetView>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const values = parseInput(reviseSheetSchema, input);
    const sheet = await reviseSheet(context, values);
    revalidatePath("/matches/[eventId]/[teamId]", "page");
    return sheet;
  });
}

export async function importSheetAction(input: unknown): Promise<ActionResult<ImportOutcome>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.record");
    const values = parseInput(importSheetSchema, input);
    const outcome = await importSheet(context, values);
    // An import writes attendance, a box score and a result at once, so
    // everything that reads any of them is now stale.
    revalidatePath("/matches");
    revalidatePath("/athletes");
    revalidatePath("/competitions");
    revalidatePath("/teams");
    return outcome;
  });
}

export async function deleteSheetAction(sheetId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const context = await requirePermission("attendance.manage");
    await deleteSheet(context, sheetId);
    revalidatePath("/matches");
  });
}
