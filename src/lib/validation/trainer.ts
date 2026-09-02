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
  /*
    A trainer with no team is invisible to the scheduler: candidate generation
    only offers a coach for teams they actually coach. Requiring the assignment
    here means "I added a trainer but the schedule ignores them" cannot happen
    silently.
  */
  teamIds: z.array(uuidSchema).min(1, "Assign this trainer to at least one team."),
});

export const createTrainerSchema = baseTrainer;
export const updateTrainerSchema = baseTrainer.extend({ id: uuidSchema });

export type CreateTrainerInput = z.infer<typeof createTrainerSchema>;
export type UpdateTrainerInput = z.infer<typeof updateTrainerSchema>;
