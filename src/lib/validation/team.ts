import { z } from "zod";

import { genderSchema, hexColorSchema, nameSchema, optionalText, uuidSchema } from "./common";

const baseTeam = z.object({
  seasonId: uuidSchema,
  name: nameSchema(150),
  sport: nameSchema(80),
  category: optionalText(80),
  ageGroup: optionalText(40),
  gender: genderSchema.default("UNSPECIFIED"),
  /**
   * The hall this team hosts in. Empty is a real answer: a side may play every
   * fixture away, or not have settled a hall yet.
   */
  homeGymId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
  color: hexColorSchema.default("#2563eb"),
  notes: optionalText(2000),
  trainerIds: z.array(uuidSchema).default([]),
});

export const createTeamSchema = baseTeam;
export const updateTeamSchema = baseTeam.extend({ id: uuidSchema });

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
