import { z } from "zod";

import {
  hexColorSchema,
  nameSchema,
  optionalText,
  stringArray,
  uuidSchema,
} from "./common";

const baseGym = z.object({
  name: nameSchema(150),
  description: optionalText(1000),
  addressLine1: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(120),
  country: optionalText(120),
  capacity: z
    .union([z.literal(""), z.coerce.number().int().positive().max(100_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  /**
   * Whether this hall can hold two teams at the changeover, and for how long.
   *
   * Exposed as a switch plus a short list rather than a free number, because a
   * club typing 90 here does not mean a changeover — it means two sessions at
   * once, which is a different decision about a different hall.
   */
  sharesHall: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional()
    .transform((v) => v === true || v === "on"),
  sharedOverlapMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(15).max(45)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? 30 : v)),
  sportTypes: stringArray,
  equipment: stringArray,
  color: z.union([z.literal(""), hexColorSchema]).optional().transform((v) => v || null),
  notes: optionalText(2000),
});

export const createGymSchema = baseGym;
export const updateGymSchema = baseGym.extend({ id: uuidSchema });

export type CreateGymInput = z.infer<typeof createGymSchema>;
export type UpdateGymInput = z.infer<typeof updateGymSchema>;
