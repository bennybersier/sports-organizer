"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  cancelEventSchema,
  createEventSchema,
  moveEntrySchema,
  updateEventSchema,
} from "@/lib/validation/calendar";
import { checkPlacement } from "@/server/services/calendar-service";
import {
  cancelEvent,
  createEvent,
  moveCalendarItem,
  updateEvent,
} from "@/server/services/event-service";
import type { PlacementResult } from "@/domain/scheduling/conflicts";

export async function createEventAction(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string }>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.create");
    const event = await createEvent(context, parseInput(createEventSchema, input));
    revalidatePath("/calendar");
    return { id: event.id, title: event.title };
  });
}

export async function updateEventAction(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string }>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.update");
    const event = await updateEvent(context, parseInput(updateEventSchema, input));
    revalidatePath("/calendar");
    return { id: event.id, title: event.title };
  });
}

export async function cancelEventAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.delete");
    const values = parseInput(cancelEventSchema, input);
    await cancelEvent(context, values.id, values.reason);
    revalidatePath("/calendar");
    return null;
  });
}

/** Drag-and-drop and resize both land here. */
export async function moveCalendarItemAction(
  input: unknown,
): Promise<ActionResult<{ severity: string; findings: unknown[] }>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.update");
    const result = await moveCalendarItem(context, parseInput(moveEntrySchema, input));
    revalidatePath("/calendar");
    return result;
  });
}

/**
 * Dry run for the drag preview: validates without saving, so the UI can warn
 * before a drop rather than after.
 */
export async function checkPlacementAction(input: {
  entryId?: string;
  teamId: string;
  trainerId: string | null;
  gymId: string;
  startAt: string;
  endAt: string;
  seasonId: string;
}): Promise<ActionResult<PlacementResult>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.read");
    return checkPlacement(context, input);
  });
}
