import { z } from "zod";

import {
  genderSchema,
  isoDateSchema,
  membershipStateSchema,
  nameSchema,
  optionalEmail,
  optionalPhone,
  optionalText,
  uuidSchema,
} from "./common";

const baseAthlete = z.object({
  firstName: nameSchema(100),
  lastName: nameSchema(100),
  dateOfBirth: z
    .union([z.literal(""), isoDateSchema])
    .optional()
    .transform((v) => (v ? v : null)),
  gender: genderSchema.default("UNSPECIFIED"),
  email: optionalEmail,
  phone: optionalPhone,
  addressLine1: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(120),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalPhone,
  emergencyContactRelation: optionalText(60),
  membershipStatus: membershipStateSchema.default("ACTIVE"),
  notes: optionalText(2000),
  /*
    Optional with no default on purpose: a caller that does not send it — an
    MCP tool, an import — must leave a family's "no" alone rather than reset
    it. The database default covers a new athlete.
  */
  publicConsent: z.boolean().optional(),
  teamIds: z.array(uuidSchema).default([]),
  // Shirt per selected team. A number belongs to the membership, not the person.
  numbers: z
    .array(
      z.object({
        teamId: uuidSchema,
        jerseyNumber: z.number().int().min(0).max(999).nullable(),
      }),
    )
    .max(50)
    .default([]),
});

export const createAthleteSchema = baseAthlete;
export const updateAthleteSchema = baseAthlete.extend({ id: uuidSchema });

export type CreateAthleteInput = z.infer<typeof createAthleteSchema>;
export type UpdateAthleteInput = z.infer<typeof updateAthleteSchema>;
