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
  /**
   * Which of them leads the side. Optional — a group can be between coaches,
   * and refusing to save a team until someone is named would be worse than
   * saying nobody is yet.
   */
  headCoachId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
});

/**
 * The head coach has to be one of the coaches.
 *
 * Stated here so the failure names the field, rather than surfacing later as a
 * row that quietly never got written.
 */
const HEAD_COACH_IS_A_COACH = {
  message: "The head coach must be one of this team's coaches.",
  path: ["headCoachId"],
};

const leadsTheTeam = (value: { trainerIds: string[]; headCoachId: string | null }) =>
  !value.headCoachId || value.trainerIds.includes(value.headCoachId);

export const createTeamSchema = baseTeam.refine(leadsTheTeam, HEAD_COACH_IS_A_COACH);
export const updateTeamSchema = baseTeam
  .extend({ id: uuidSchema })
  .refine(leadsTheTeam, HEAD_COACH_IS_A_COACH);

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
