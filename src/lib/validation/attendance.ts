import { z } from "zod";

import { isoDateSchema, optionalText, uuidSchema } from "./common";

/**
 * What a coach may send back from a register.
 *
 * A Server Action is a public HTTP endpoint, so the sheet arrives untrusted:
 * the shape is checked here and the rules that need to see the whole sheet at
 * once — the call-up cap, five starters — are checked in the service, where the
 * register's own limit is known.
 */

export const attendanceStateSchema = z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]);
export const absenceReasonSchema = z.enum([
  "INJURY", "ILLNESS", "SCHOOL", "FAMILY", "HOLIDAY", "TRANSPORT", "OTHER",
]);
export const benchReasonSchema = z.enum([
  "COACH_DECISION", "ROTATION", "INJURY", "DISCIPLINARY", "OTHER",
]);
export const registerStateSchema = z.enum(["OPEN", "RECORDED", "CANCELLED"]);

const registerLineSchema = z.object({
  athleteId: uuidSchema,
  state: attendanceStateSchema,
  reason: absenceReasonSchema.nullish(),
  minutesLate: z.number().int().min(0).max(240).nullish(),
  calledUp: z.boolean().nullish(),
  started: z.boolean().nullish(),
  benchReason: benchReasonSchema.nullish(),
  note: optionalText(500),
});

export const saveRegisterSchema = z.object({
  registerId: uuidSchema,
  // A sheet is saved whole, in one call — Next.js dispatches Server Actions one
  // at a time per client, so a tap-per-request register would queue.
  lines: z.array(registerLineSchema).max(60),
  state: registerStateSchema.exclude(["CANCELLED"]),
  notes: optionalText(2000),
});

export const declareAbsenceSchema = z
  .object({
    athleteId: uuidSchema,
    /** Null means every squad the athlete plays for. */
    teamId: uuidSchema.nullish(),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    reason: absenceReasonSchema,
    note: optionalText(500),
    reportedBy: optionalText(120),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    message: "The absence cannot end before it starts.",
    path: ["endsOn"],
  });

const countSchema = z.number().int().min(0).max(200);

/**
 * One player's line on the scoresheet.
 *
 * The made-versus-attempted checks are here as well as on the table, because
 * "made 4 of 2" is a typo a scorer makes at ten at night and deserves a
 * sentence naming the field rather than a constraint name.
 */
const boxScoreLineSchema = z
  .object({
    athleteId: uuidSchema,
    secondsPlayed: z.number().int().min(0).max(5400).default(0),
    twoPointMade: countSchema.default(0),
    twoPointAttempted: countSchema.default(0),
    threePointMade: countSchema.default(0),
    threePointAttempted: countSchema.default(0),
    freeThrowMade: countSchema.default(0),
    freeThrowAttempted: countSchema.default(0),
    offensiveRebounds: countSchema.default(0),
    defensiveRebounds: countSchema.default(0),
    assists: countSchema.default(0),
    steals: countSchema.default(0),
    blocks: countSchema.default(0),
    turnovers: countSchema.default(0),
    foulsCommitted: z.number().int().min(0).max(10).default(0),
    foulsDrawn: countSchema.default(0),
    plusMinus: z.number().int().min(-200).max(200).nullish(),
  })
  .refine((v) => v.twoPointMade <= v.twoPointAttempted, {
    message: "More two-pointers made than attempted.",
    path: ["twoPointMade"],
  })
  .refine((v) => v.threePointMade <= v.threePointAttempted, {
    message: "More three-pointers made than attempted.",
    path: ["threePointMade"],
  })
  .refine((v) => v.freeThrowMade <= v.freeThrowAttempted, {
    message: "More free throws made than attempted.",
    path: ["freeThrowMade"],
  });

/**
 * A whole scoresheet at once, for the same reason a register is saved whole:
 * Next.js dispatches Server Actions one at a time per client, so twelve
 * players saved individually would queue twelve deep.
 */
export const saveBoxScoresSchema = z.object({
  registerId: uuidSchema,
  lines: z.array(boxScoreLineSchema).max(30),
});

const ratingSchema = z.number().int().min(1).max(5).nullish();

export const saveEvaluationSchema = z
  .object({
    id: uuidSchema.optional(),
    athleteId: uuidSchema,
    teamId: uuidSchema,
    trainerId: uuidSchema.nullish(),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    technique: ratingSchema,
    tactical: ratingSchema,
    physical: ratingSchema,
    attitude: ratingSchema,
    strengths: optionalText(1000),
    development: optionalText(1000),
    note: optionalText(2000),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "The period cannot end before it starts.",
    path: ["periodEnd"],
  })
  // Mirrors evaluations_not_empty: a row that scores nothing and says nothing
  // is not an assessment.
  .refine(
    (value) =>
      value.technique != null || value.tactical != null || value.physical != null ||
      value.attitude != null || value.strengths || value.development,
    { message: "Score at least one area, or write something.", path: ["technique"] },
  );

export type SaveRegisterInput = z.infer<typeof saveRegisterSchema>;
export type DeclareAbsenceInput = z.infer<typeof declareAbsenceSchema>;
export type SaveBoxScoresInput = z.infer<typeof saveBoxScoresSchema>;
export type BoxScoreLineInput = z.infer<typeof boxScoreLineSchema>;
export type SaveEvaluationInput = z.infer<typeof saveEvaluationSchema>;
