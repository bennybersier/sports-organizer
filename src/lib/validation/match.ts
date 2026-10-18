import { z } from "zod";

import { optionalText, uuidSchema } from "./common";

/**
 * Recording what a match finished.
 *
 * `state` leads because it decides whether the rest means anything: PENDING is
 * a match with no score yet, which is not the same as a 0–0 and is the state
 * every match is in until somebody types one. The refinement below is the same
 * rule the database enforces, stated here so the form can show it on the field
 * rather than as a failed save.
 */

const scoreSchema = z.coerce.number().int().min(0).max(300);

/**
 * Per-quarter scores, not cumulative.
 *
 * Optional: a coach reporting Sunday's result from the car park knows 67–59 and
 * not the quarters. Imported sheets always carry them, because they are what a
 * referto's circled rungs are checked against.
 */
const periodsSchema = z
  .array(z.coerce.number().int().min(0).max(200))
  .max(8)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

export const saveResultSchema = z
  .object({
    eventId: uuidSchema,
    teamId: uuidSchema,
    state: z.enum(["PENDING", "PLAYED", "FORFEIT", "ABANDONED"]).default("PLAYED"),
    ourScore: scoreSchema.optional(),
    theirScore: scoreSchema.optional(),
    ourPeriods: periodsSchema,
    theirPeriods: periodsSchema,
    notes: optionalText(1000),
  })
  .refine(
    (value) =>
      value.state === "PENDING" ||
      (value.ourScore !== undefined && value.theirScore !== undefined),
    { message: "Enter both scores.", path: ["ourScore"] },
  )
  .refine(
    (value) =>
      value.ourPeriods === null ||
      value.theirPeriods === null ||
      value.ourPeriods.length === value.theirPeriods.length,
    { message: "Both sides need the same number of quarters.", path: ["ourPeriods"] },
  )
  .refine(
    // The quarters must add up to the score they are quarters of; a sheet whose
    // periods disagree with its total is a misreading, not a result.
    (value) =>
      value.state === "PENDING" ||
      value.ourPeriods === null ||
      value.ourPeriods.reduce((sum, period) => sum + period, 0) === value.ourScore,
    { message: "The quarters do not add up to our score.", path: ["ourPeriods"] },
  )
  .refine(
    (value) =>
      value.state === "PENDING" ||
      value.theirPeriods === null ||
      value.theirPeriods.reduce((sum, period) => sum + period, 0) === value.theirScore,
    { message: "The quarters do not add up to their score.", path: ["theirPeriods"] },
  );

export type SaveResultInput = z.infer<typeof saveResultSchema>;
