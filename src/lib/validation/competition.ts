import { z } from "zod";

import { nameSchema, optionalText, uuidSchema } from "./common";

const FORMATS = ["LEAGUE", "CONCENTRATION"] as const;
const PHASES = ["SINGLE", "GROUP", "GOLD", "SILVER", "BRONZE", "PLAYOFF"] as const;

const baseCompetition = z.object({
  seasonId: uuidSchema,
  /** The side of ours that plays in it. A competition is always one team's. */
  teamId: uuidSchema,
  name: nameSchema(150),
  format: z.enum(FORMATS).default("LEAGUE"),
  phase: z.enum(PHASES).default("SINGLE"),
  /** Set when this is the Gold, Silver or Bronze that came out of a group. */
  parentId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
  /** How many clubs a phase will hold, entered before its draw is known. */
  expectedClubs: z
    .union([z.literal(""), z.coerce.number().int().min(2).max(40)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  /**
   * Hall held either side of a home fixture here. Stated once per competition
   * because it follows the level: a senior game needs an hour and a half of
   * setup, a minibasket concentration far less.
   */
  homeBufferBeforeMinutes: z.coerce.number().int().min(0).max(240).default(60),
  homeBufferAfterMinutes: z.coerce.number().int().min(0).max(240).default(30),
  notes: optionalText(2000),
});

export const createCompetitionSchema = baseCompetition;
export const updateCompetitionSchema = baseCompetition.extend({ id: uuidSchema });

/**
 * The clubs, as typed.
 *
 * One per line, because that is how a fixture list arrives — pasted out of an
 * email. `Club — Town` splits on an en or em dash so a town can be given
 * without a second field to tab into.
 */
export const setEntriesSchema = z.object({
  competitionId: uuidSchema,
  clubs: z
    .array(
      z.object({
        clubName: nameSchema(120),
        town: optionalText(120),
        venue: optionalText(200),
      }),
    )
    .max(40),
});

export const generateFixturesSchema = z.object({ competitionId: uuidSchema });

/**
 * Dating a fixture, or clearing the date again.
 *
 * Empty means "not yet agreed", which is a real state rather than a missing
 * value — most of a season looks like that in September.
 */
export const scheduleFixtureSchema = z
  .object({
    id: uuidSchema,
    date: z.union([z.literal(""), z.iso.date()]).optional().transform((v) => v || null),
    startTime: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).optional()
      .transform((v) => v || null),
    durationMinutes: z.coerce.number().int().min(15).max(480).default(120),
    hostEntryId: z.union([z.literal(""), uuidSchema]).optional().transform((v) => v || null),
  })
  .refine((v) => v.date === null || v.startTime !== null, {
    message: "A dated fixture needs a start time.",
    path: ["startTime"],
  });

export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;
export type UpdateCompetitionInput = z.infer<typeof updateCompetitionSchema>;
export type SetEntriesInput = z.infer<typeof setEntriesSchema>;
export type ScheduleFixtureInput = z.infer<typeof scheduleFixtureSchema>;
