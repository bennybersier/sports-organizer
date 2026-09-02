import { z } from "zod";

import { isoDateSchema, optionalText, uuidSchema } from "./common";

/** `HH:MM`, plus `24:00` for a window that runs to end of day. */
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Enter a time as HH:MM.");

export const availabilityDomainSchema = z.enum(["gym", "trainer", "team"]);
export type AvailabilityDomain = z.infer<typeof availabilityDomainSchema>;

const window = z
  .object({
    domain: availabilityDomainSchema,
    ownerId: uuidSchema,
    isoWeekday: z.coerce.number().int().min(1).max(7),
    startTime: timeSchema,
    endTime: timeSchema,
    validFrom: isoDateSchema,
    validUntil: z
      .union([z.literal(""), isoDateSchema])
      .optional()
      .transform((v) => (v ? v : null)),
    note: optionalText(200),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "The end time must be after the start time.",
    path: ["endTime"],
  })
  .refine((v) => !v.validUntil || v.validUntil >= v.validFrom, {
    message: "The end date must be on or after the start date.",
    path: ["validUntil"],
  });

export const createAvailabilitySchema = window;
export const updateAvailabilitySchema = z.intersection(window, z.object({ id: uuidSchema }));

const exception = z
  .object({
    domain: availabilityDomainSchema,
    ownerId: uuidSchema,
    exceptionDate: isoDateSchema,
    // Both empty means the whole day.
    startTime: z.union([z.literal(""), timeSchema]).optional().transform((v) => (v ? v : null)),
    endTime: z.union([z.literal(""), timeSchema]).optional().transform((v) => (v ? v : null)),
    type: z.enum(["UNAVAILABLE", "AVAILABLE_OVERRIDE"]),
    reason: optionalText(200),
  })
  .refine((v) => (v.startTime === null) === (v.endTime === null), {
    message: "Give both a start and an end time, or leave both empty for the whole day.",
    path: ["endTime"],
  })
  .refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    message: "The end time must be after the start time.",
    path: ["endTime"],
  });

export const createExceptionSchema = exception;

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;
