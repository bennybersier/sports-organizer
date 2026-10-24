import { z } from "zod";

import { optionalText, uuidSchema } from "./common";

/**
 * The shape a transcribed game sheet must have before anything is derived from
 * it.
 *
 * This schema is load-bearing twice over. It is what a model's JSON is parsed
 * through — a model returns text and nothing guarantees it is the text you
 * asked for — and it is also what the review screen submits when a human
 * corrects a digit. Because the arithmetic in `src/domain/referto` is pure, a
 * correction re-derives the whole sheet without a second model call: the
 * expensive step happens once per photograph, and every fix after that is free.
 *
 * The bounds are generous on purpose. A sheet with an impossible total should
 * fail a named check with the arithmetic shown, not a Zod message about a
 * number being too large — rejecting it here would lose the one thing the
 * secretary needs, which is *which* number is wrong.
 */

const shirtSchema = z.coerce.number().int().min(0).max(999);

/**
 * A foul mark: `P`, `P1`–`P3`, `T`, `U`, `D`.
 *
 * Deliberately *not* rejected when it is something else. A reader looking at
 * biro on a photocopy will occasionally return a glyph nobody expects, and the
 * cost of refusing it here is the whole sheet — twelve players and both scores
 * thrown away over one cell, with a Zod path for a message. The mark is kept
 * as written instead, and `reading.ts` counts only the ones it recognises, so
 * an unreadable one shows up as a foul count a human can check against the
 * paper rather than as a failed import.
 */
const foulMarkSchema = z.string().trim().toUpperCase().max(4);

export const transcribedPlayerSchema = z.object({
  shirt: shirtSchema,
  surname: z.string().trim().min(1).max(120),
  givenName: optionalText(120),
  /**
   * Four digits. The sheet prints two, so the reader is asked to expand them;
   * the range is wide enough for a veterans' league and narrow enough to catch
   * a year read out of the wrong column.
   */
  birthYear: z.coerce.number().int().min(1930).max(2030).nullish().transform((v) => v ?? null),
  played: z.coerce.boolean(),
  starter: z.coerce.boolean(),
  fouls: z.array(foulMarkSchema).max(8).default([]),
});

export const ladderEntrySchema = z.object({
  total: z.coerce.number().int().min(1).max(300),
  /** Null is a legitimate reading: an illegible number must not be guessed. */
  shirt: shirtSchema.nullish().transform((v) => v ?? null),
  circledScorer: z.coerce.boolean().default(false),
  periodEnd: z.coerce.boolean().default(false),
});

export const transcribedTeamSchema = z.object({
  clubName: optionalText(150),
  shirtColour: optionalText(60),
  players: z.array(transcribedPlayerSchema).max(30),
  periods: z.array(z.coerce.number().int().min(0).max(200)).max(8).default([]),
  finalScore: z.coerce.number().int().min(0).max(300).nullish().transform((v) => v ?? null),
  ladder: z.array(ladderEntrySchema).max(200).default([]),
});

export const refertoTranscriptionSchema = z.object({
  gameNumber: optionalText(40),
  /**
   * Loose rather than `z.iso.date()`: the date on the sheet is corroboration,
   * not an input. The register already knows when the match was, and refusing
   * a whole transcription over a smudged header would be perverse.
   */
  date: optionalText(40),
  time: optionalText(10),
  venue: optionalText(200),
  competition: optionalText(150),
  teams: z.object({ a: transcribedTeamSchema, b: transcribedTeamSchema }),
});

export const sheetSideSchema = z.enum(["a", "b"]);

/* -------------------------------------------------------------------------- */
/* Action inputs                                                              */
/* -------------------------------------------------------------------------- */

/** Asking for a sheet to be read. The photograph is already in storage. */
export const readSheetSchema = z.object({ sheetId: uuidSchema });

/**
 * Re-deriving a sheet from a corrected transcription.
 *
 * `side` is here rather than inferred because a cropped photograph may not show
 * which block is ours, and guessing wrong imports the opponent's statistics
 * into our athletes' seasons.
 */
export const reviseSheetSchema = z.object({
  sheetId: uuidSchema,
  side: sheetSideSchema,
  transcription: refertoTranscriptionSchema,
});

/**
 * Committing a reading to the box score.
 *
 * `assignments` maps a shirt number to one of our athletes. It is explicit
 * rather than resolved server-side from `athlete_teams.jersey_number` because
 * the number on the sheet is the number the player wore *that day*, which is
 * not always the number on file — a borrowed shirt is a normal Saturday. The
 * registered number is offered as a suggestion; a human confirms it. The
 * server still checks every athlete named is in the squad.
 */
export const importSheetSchema = z.object({
  sheetId: uuidSchema,
  side: sheetSideSchema,
  /*
    The transcription as the reviewer left it, which may differ from the one
    stored when the photograph was read: answering "who scored to reach 65?"
    writes a shirt number onto the ladder, and correcting a quarter rewrites the
    period box. Sending it with the import makes accepting a reviewed sheet one
    atomic write instead of a revise-then-import pair that can half-fail.

    It comes from the client, and that is correct rather than a hole: the person
    looking at the paper is the authority on what it says. Every hard check is
    re-run against it server-side before a single row is written.
  */
  transcription: refertoTranscriptionSchema.optional(),
  assignments: z
    .array(z.object({ shirt: shirtSchema, athleteId: uuidSchema }))
    .max(30)
    .default([]),
  /** Also write the final score as the match result. */
  withResult: z.coerce.boolean().default(true),
});

export type TranscribedPlayerInput = z.infer<typeof transcribedPlayerSchema>;
export type RefertoTranscriptionInput = z.infer<typeof refertoTranscriptionSchema>;
export type ReadSheetInput = z.infer<typeof readSheetSchema>;
export type ReviseSheetInput = z.infer<typeof reviseSheetSchema>;
export type ImportSheetInput = z.infer<typeof importSheetSchema>;
