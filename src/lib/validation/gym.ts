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
  sportTypes: stringArray,
  equipment: stringArray,
  color: z.union([z.literal(""), hexColorSchema]).optional().transform((v) => v || null),
  notes: optionalText(2000),
});

export const createGymSchema = baseGym;
export const updateGymSchema = baseGym.extend({ id: uuidSchema });

export type CreateGymInput = z.infer<typeof createGymSchema>;
export type UpdateGymInput = z.infer<typeof updateGymSchema>;
