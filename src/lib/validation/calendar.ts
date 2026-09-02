import { z } from "zod";

import { hexColorSchema, nameSchema, optionalText, uuidSchema } from "./common";

const EVENT_TYPES = [
  "MATCH",
  "TOURNAMENT",
  "HOLIDAY",
  "BLACKOUT",
  "SPECIAL_EVENT",
  "MEETING",
  "TRAINING",
] as const;

const baseEvent = z
  .object({
    seasonId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
    type: z.enum(EVENT_TYPES),
    title: nameSchema(200),
    description: optionalText(2000),
    location: optionalText(200),
    gymId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
    trainerId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
    startAt: z.iso.datetime({ offset: true, error: "Enter a valid start." }),
    endAt: z.iso.datetime({ offset: true, error: "Enter a valid end." }),
    allDay: z.coerce.boolean().default(false),
    color: z.union([z.literal(""), hexColorSchema]).optional().transform((v) => v || null),
    /**
     * The one case several teams may share a hall: an in-house match or
     * tournament. Never set by the optimizer.
     */
    allowsGymSharing: z.coerce.boolean().default(false),
    /** Holidays and closures remove time from the scheduler's view. */
    blocksScheduling: z.coerce.boolean().default(false),
    teamIds: z.array(uuidSchema).default([]),
  })
  .refine((v) => v.endAt > v.startAt, {
    message: "The end must be after the start.",
    path: ["endAt"],
  });

export const createEventSchema = baseEvent;
export const updateEventSchema = z.intersection(baseEvent, z.object({ id: uuidSchema }));

/** Moving or resizing an entry from the calendar. */
export const moveEntrySchema = z.object({
  id: uuidSchema,
  source: z.enum(["SCHEDULE", "EVENT"]),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  gymId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
  /** Recorded in the audit log when a soft constraint is knowingly overridden. */
  reason: optionalText(500),
});

export const cancelEventSchema = z.object({
  id: uuidSchema,
  reason: optionalText(500),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type MoveEntryInput = z.infer<typeof moveEntrySchema>;
