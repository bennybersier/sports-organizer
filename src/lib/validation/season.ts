import { z } from "zod";

import { isoDateSchema, nameSchema, optionalText, uuidSchema } from "./common";

const baseSeason = z.object({
  name: nameSchema(100),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  description: optionalText(1000),
});

/** A season must run forwards, and no longer than two years. */
const coherentDates = <T extends { startDate: string; endDate: string }>(schema: z.ZodType<T>) =>
  schema
    .refine((v) => v.endDate > v.startDate, {
      message: "The end date must be after the start date.",
      path: ["endDate"],
    })
    .refine(
      (v) =>
        (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <= 730,
      { message: "A season can't be longer than two years.", path: ["endDate"] },
    );

export const createSeasonSchema = coherentDates(baseSeason);
export const updateSeasonSchema = coherentDates(baseSeason.extend({ id: uuidSchema }));

export const duplicateSeasonSchema = coherentDates(
  baseSeason.extend({
    sourceSeasonId: uuidSchema,
    includeTeams: z.coerce.boolean().default(true),
    includeAvailability: z.coerce.boolean().default(true),
    includeAthletes: z.coerce.boolean().default(false),
  }),
);

export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;
export type DuplicateSeasonInput = z.infer<typeof duplicateSeasonSchema>;
