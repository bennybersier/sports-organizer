import "server-only";

import { ConflictError } from "@/lib/errors";
import type { ReadableImageType } from "@/domain/ai";
import type { RefertoTranscription } from "@/domain/referto/transcription";
import { refertoTranscriptionSchema } from "@/lib/validation/referto";
import { assertPermission } from "@/server/auth/authorization";
import type { AuthContext } from "@/server/auth/context";
import { getProvider } from "@/server/ai/registry";
import { describeProviderError } from "@/server/ai/provider";
import { log } from "@/lib/observability";

/**
 * Reading a photographed FIP referto with a vision model.
 *
 * The model's entire job is **transcription**: which totals are struck through,
 * which numbers are beside them, which are circled. It is told, repeatedly and
 * in the prompt below, not to add anything up. Every number a player's season
 * depends on is then derived by `src/domain/referto/reading.ts`, which is pure,
 * tested against a real sheet, and cannot be talked out of its answer.
 *
 * That split is the same rule the scheduling assistant follows — AI explains
 * and transcribes, deterministic code decides — and here it buys something
 * specific. A model asked to total a column will produce a plausible total, and
 * a plausible wrong total is indistinguishable from a right one. A model asked
 * only what it can see produces claims that our arithmetic can *check against
 * each other*, which is why an import can be refused with the sum shown rather
 * than accepted on faith.
 */

const SYSTEM = `You transcribe Italian basketball score sheets (referto ufficiale di gara).

You report only what is physically on the paper. You never calculate, total,
sum, or infer anything. If you cannot read a mark, you say null. A guess is
worse than a null, because a guess cannot be detected downstream and a null can.

THE DOCUMENT

Header: GARA N. (game number), Denominazione Sociale for squadra A then
squadra B, Campionato and Girone, Data, Ore, Campo. Squadra A is always the
home side. COLORE MAGLIA gives each side's shirt colour.

Bottom right: the period scores (1º/2º/3º/4º Quarto, per quarter, NOT
cumulative) and RISULTATO FINALE for each side.

Roster blocks, one per team, twelve rows, columns:
  ANNO NASC | Cognome | Nome | N. | E/N. | FALLI 1 2 3 4 5
- ANNO NASC is a two-digit registration year. Expand it: 14 means 2014.
- Nome is often an initial only ("E.", "K.D."). Report exactly what is written.
- N. is the shirt number.
- E/N. holds an X for each player who took part. An X that is CIRCLED or
  STRUCK THROUGH marks a starter. There should be exactly five.
- FALLI holds the fouls in sequence: P, P1, P2, P3, T, U, D. Report each mark
  you see as a separate entry, in order. Do not count them.

PUNTEGGIO PROGRESSIVO — read this carefully, it is the hard part.

It is a pre-printed ladder of running totals from 1 upward, in four blocks of
forty, each block four columns:
  [ A scorer ] [ A total ] [ B total ] [ B scorer ]

The scorer strikes through the running total the team has REACHED and writes
the scorer's shirt number beside it. So report, for each struck total:
- total: the number struck through
- shirt: the number written beside it, or null if you cannot read it
- circledScorer: true if the SHIRT NUMBER is circled (the scorer's mark for a
  three-pointer)
- periodEnd: true if the TOTAL is circled AND underlined (end of a period)

Do not confuse those two circles. One is in the scorer column, one in the
total column, and only the period marker is underlined. Report the rungs in
ascending order. Do NOT work out what any basket was worth.

OUTPUT

Reply with JSON only — no prose, no markdown fence — of exactly this shape:

{
  "gameNumber": string|null, "date": string|null, "time": string|null,
  "venue": string|null, "competition": string|null,
  "teams": {
    "a": {
      "clubName": string|null, "shirtColour": string|null,
      "players": [{ "shirt": number, "surname": string, "givenName": string|null,
                    "birthYear": number|null, "played": boolean,
                    "starter": boolean, "fouls": string[] }],
      "periods": number[], "finalScore": number|null,
      "ladder": [{ "total": number, "shirt": number|null,
                   "circledScorer": boolean, "periodEnd": boolean }]
    },
    "b": { ...same shape... }
  }
}`;

const INSTRUCTION = `Transcribe this referto. Report every roster row and every
struck rung for both sides. Remember: no arithmetic, and null for anything you
cannot read.`;

export interface RefertoReadResult {
  transcription: RefertoTranscription;
  /** Which model produced it — needed if the reading is ever disputed. */
  model: string;
}

/**
 * Sends one photograph to the tenant's configured provider and parses the reply.
 *
 * Throws rather than returning an error union, because every caller is a
 * mutation that must not half-succeed: a sheet that could not be read stays in
 * UPLOADED with the reason recorded, and that bookkeeping belongs to the
 * service, not here.
 */
export async function readReferto(
  context: AuthContext,
  image: { data: string; mediaType: ReadableImageType },
): Promise<RefertoReadResult> {
  assertPermission(context, "ai.read");

  let text: string;
  let model: string;
  try {
    const provider = await getProvider(context);
    const response = await provider.generate({
      system: SYSTEM,
      messages: [{ role: "user", content: INSTRUCTION, images: [image] }],
      /*
        A full ladder is around 120 rungs plus two rosters, and every rung is
        its own object. 8k leaves room for a high-scoring senior game; a
        truncated reply fails the parse below rather than importing half a sheet.
      */
      maxTokens: 8192,
    });
    text = response.text;
    model = response.model;
  } catch (error) {
    throw new ConflictError(describeProviderError(error));
  }

  return { transcription: parseTranscription(text), model };
}

/**
 * Pulls the JSON object out of a model reply and validates it.
 *
 * Models fence JSON in markdown however often you ask them not to, so the
 * first and last brace are taken rather than trusting the reply to be bare.
 * Exported for the tests, which is the only way to pin this behaviour without
 * a provider.
 */
export function parseTranscription(text: string): RefertoTranscription {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ConflictError("The sheet could not be read: the reply was not a transcription.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ConflictError("The sheet could not be read: the transcription was not valid JSON.");
  }

  const parsed = refertoTranscriptionSchema.safeParse(raw);
  if (!parsed.success) {
    // The issue paths name the field, which is what makes a bad reading
    // diagnosable; the values themselves may be half a club's roster, so they
    // are not logged.
    log.warn("referto.transcription_invalid", {
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join(".")),
    });
    throw new ConflictError(
      "The sheet was read but the transcription did not have the expected shape. Try a straighter, better-lit photograph.",
    );
  }

  return parsed.data;
}
