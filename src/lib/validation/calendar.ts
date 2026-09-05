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

    /* --- Fixtures. Meaningless on anything but a MATCH or TOURNAMENT. ------ */
    opponent: optionalText(120),
    /**
     * Null is a real answer, not a missing one: a derby between two of our own
     * teams is both home and away, and nothing else is either.
     */
    isHome: z
      .union([z.literal(""), z.literal("home"), z.literal("away")])
      .optional()
      .transform((v) => (v === "home" ? true : v === "away" ? false : null)),
    competition: optionalText(120),

    /**
     * How long the hall is held either side. A match is not two hours of
     * basketball in an otherwise free room.
     */
    bufferBeforeMinutes: z.coerce.number().int().min(0).max(240).default(0),
    bufferAfterMinutes: z.coerce.number().int().min(0).max(240).default(0),
  })
  .refine((v) => v.endAt > v.startAt, {
    message: "The end must be after the start.",
    path: ["endAt"],
  })
  // Mirrors the database check, so a stray opponent on a holiday comes back as
  // a field error rather than a 500 from a constraint nobody can read.
  .superRefine((v, ctx) => {
    if (v.type === "MATCH" || v.type === "TOURNAMENT") return;
    for (const field of ["opponent", "competition"] as const) {
      if (v[field]) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Only a match or tournament has this.",
        });
      }
    }
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
