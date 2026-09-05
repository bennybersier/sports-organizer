import { z } from "zod";

import { optionalText, uuidSchema } from "./common";
import { timeSchema } from "./availability";

const weekdays = z
  .union([z.array(z.coerce.number().int().min(1).max(7)), z.string(), z.undefined()])
  .transform((value) => {
    if (Array.isArray(value)) return [...new Set(value)].sort();
    if (typeof value === "string" && value) return [Number(value)];
    return [] as number[];
  });

/**
 * What a team needs from the schedule.
 *
 * Hard constraints (sessions, duration, allowed days/times/gyms) must hold.
 * Soft ones (preferred days, times, gyms) steer the optimizer and may be
 * traded away — that distinction is the whole design of the scheduler, so the
 * two groups stay separate here rather than being flattened into one blob.
 */
export const trainingRequirementSchema = z
  .object({
    teamId: uuidSchema,
    seasonId: uuidSchema,

    sessionsPerWeek: z.coerce.number().int().min(0).max(14),
    durationMinutes: z.coerce.number().int().min(15).max(480),
    // 1 (highest) to 5 (lowest), matching the database constraint.
    priority: z.coerce.number().int().min(1).max(5).default(3),
    // Empty means "start with the schedule", which is not the same as a date.
    startsOn: z
      .union([z.literal(""), z.iso.date()])
      .optional()
      .transform((value) => value || null),
    // The match day is always blocked; this is the buffer either side of it.
    matchRestDays: z.coerce.number().int().min(0).max(3).default(0),
    allowedWeekdays: weekdays,
    earliestStart: timeSchema,
    latestEnd: timeSchema,
    minDaysBetween: z.coerce.number().int().min(0).max(7),
    maxDaysBetween: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(14)])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    allowedGymIds: z.array(uuidSchema).default([]),

    preferredWeekdays: weekdays,
    preferredStart: z.union([z.literal(""), timeSchema]).optional().transform((v) => v || null),
    preferredEnd: z.union([z.literal(""), timeSchema]).optional().transform((v) => v || null),
    preferredGymIds: z.array(uuidSchema).default([]),

    notes: optionalText(1000),
  })
  .refine((v) => v.latestEnd > v.earliestStart, {
    message: "The latest end must be after the earliest start.",
    path: ["latestEnd"],
  })
  .refine(
    (v) => {
      const [sh, sm] = v.earliestStart.split(":").map(Number);
      const [eh, em] = v.latestEnd.split(":").map(Number);
      return v.durationMinutes <= eh * 60 + em - (sh * 60 + sm);
    },
    {
      message: "A session this long doesn't fit inside the allowed hours.",
      path: ["durationMinutes"],
    },
  )
  .refine((v) => v.maxDaysBetween === null || v.maxDaysBetween >= v.minDaysBetween, {
    message: "The maximum gap can't be smaller than the minimum.",
    path: ["maxDaysBetween"],
  })
  .refine(
    (v) => v.allowedWeekdays.length === 0 || v.sessionsPerWeek <= v.allowedWeekdays.length * 2,
    {
      message: "That's more sessions than the allowed weekdays can hold.",
      path: ["sessionsPerWeek"],
    },
  )
  .refine(
    (v) =>
      v.preferredWeekdays.length === 0 ||
      v.allowedWeekdays.length === 0 ||
      v.preferredWeekdays.every((day) => v.allowedWeekdays.includes(day)),
    {
      message: "Preferred days have to be among the allowed days.",
      path: ["preferredWeekdays"],
    },
  )
  .refine(
    (v) =>
      v.preferredGymIds.length === 0 ||
      v.allowedGymIds.length === 0 ||
      v.preferredGymIds.every((id) => v.allowedGymIds.includes(id)),
    {
      message: "Preferred gyms have to be among the allowed gyms.",
      path: ["preferredGymIds"],
    },
  );

export type TrainingRequirementInput = z.infer<typeof trainingRequirementSchema>;
