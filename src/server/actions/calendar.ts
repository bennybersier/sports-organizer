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
  deleteEvent,
  getEvent,
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

/**
 * Removes an event permanently.
 *
 * For a mistake. To record that a real event is not happening, cancel it
 * instead — that keeps it visible to everyone who was told about it.
 */
export async function deleteEventAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.delete");
    await deleteEvent(context, id);
    revalidatePath("/calendar");
    return null;
  });
}

/** Loads one event for the edit form, on demand. */
export async function getEventAction(id: string): Promise<ActionResult<{
  id: string;
  seasonId: string | null;
  type: string;
  title: string;
  gymId: string | null;
  trainerId: string | null;
  teamIds: string[];
  startAt: string;
  endAt: string;
  allDay: boolean;
  allowsGymSharing: boolean;
  blocksScheduling: boolean;
}>> {
  return runAction(async () => {
    const context = await requirePermission("calendar.read");
    const event = await getEvent(context, id);
    return {
      id: event.id,
      seasonId: event.season_id,
      type: event.type,
      title: event.title,
      gymId: event.gym_id,
      trainerId: event.trainer_id,
      teamIds: event.teamIds,
      startAt: event.start_at,
      endAt: event.end_at,
      allDay: event.all_day,
      allowsGymSharing: event.allows_gym_sharing,
      blocksScheduling: event.blocks_scheduling,
    };
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
