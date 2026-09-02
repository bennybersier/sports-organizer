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
  teamIds: z.array(uuidSchema).default([]),
});

export const createAthleteSchema = baseAthlete;
export const updateAthleteSchema = baseAthlete.extend({ id: uuidSchema });

export type CreateAthleteInput = z.infer<typeof createAthleteSchema>;
export type UpdateAthleteInput = z.infer<typeof updateAthleteSchema>;
