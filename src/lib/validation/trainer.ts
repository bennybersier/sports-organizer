import { z } from "zod";

import {
  hexColorSchema,
  nameSchema,
  optionalEmail,
  optionalPhone,
  optionalText,
  stringArray,
  uuidSchema,
} from "./common";

const baseTrainer = z.object({
  firstName: nameSchema(100),
  lastName: nameSchema(100),
  email: optionalEmail,
  phone: optionalPhone,
  qualifications: stringArray,
  color: z.union([z.literal(""), hexColorSchema]).optional().transform((v) => v || null),
  notes: optionalText(2000),
});

export const createTrainerSchema = baseTrainer;
export const updateTrainerSchema = baseTrainer.extend({ id: uuidSchema });

export type CreateTrainerInput = z.infer<typeof createTrainerSchema>;
export type UpdateTrainerInput = z.infer<typeof updateTrainerSchema>;
