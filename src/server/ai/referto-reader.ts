import "server-only";

import { ConflictError } from "@/lib/errors";
import type { ReadableImageType } from "@/domain/ai";
import type { RefertoTranscription } from "@/domain/referto/transcription";
import { refertoTranscriptionSchema } from "@/lib/validation/referto";
import { assertPermission } from "@/server/auth/authorization";
import type { AuthContext } from "@/server/auth/context";
import { getProvider } from "@/server/ai/registry";
import { READ_TIMEOUT_MS, describeProviderError } from "@/server/ai/provider";
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
the scorer's shirt number beside it.

WHICH COLUMN IS WHICH. The two teams' ladders are printed against each other,
and the single most damaging error you can make is to file one team's basket
under the other. A's shirt numbers are written to the LEFT of the A column;
B's are written to the RIGHT of the B column. So a number sitting between the
A and B totals belongs to A, and a number to the right of everything belongs
to B. Before reporting a rung, check the strike is in that team's own total
column and not in the one touching it. A row where only B's total is struck
produces a rung for B and NOTHING for A — do not report an empty row as a
rung with an unreadable scorer, report nothing at all.

So report, for each struck total:
- total: the number struck through
- shirt: the number written beside it, or null if you cannot read it
- circledScorer: true if the SHIRT NUMBER is circled (the scorer's mark for a
  three-pointer)
- periodEnd: true if the TOTAL is circled AND underlined (end of a period)

Do not confuse those two circles. One is in the scorer column, one in the
total column, and only the period marker is underlined. Report the rungs in
ascending order. Do NOT work out what any basket was worth.

WHERE THINGS ARE

Also report where the blocks sit on the photograph, so a person can be shown
the part of the paper a question is about. Each region is
[yMin, xMin, yMax, xMax] in thousandths of the image, top-left origin:
- rosterA / rosterB: the twelve-row ATLETA block of each team, from the
  ANNO NASC heading to the last player row, including the N. and FALLI
  columns.
- ladder: the four printed blocks of PUNTEGGIO PROGRESSIVO, left to right —
  totals 1-40, then 41-80, 81-120, 121-160. Each block spans its A column,
  its B column and the two scorer columns beside them.
Give a region only for what you can actually see; use null otherwise.

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
  },
  "regions": {
    "rosterA": [y,x,y,x]|null, "rosterB": [y,x,y,x]|null,
    "ladder": [[y,x,y,x]|null, [y,x,y,x]|null, [y,x,y,x]|null, [y,x,y,x]|null]
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

  /*
    One deadline for the whole read, shared by every attempt. A per-attempt
    timeout would let three slow tries add up past the route's own limit, and
    then the platform decides how this ends instead of us.
  */
  const deadline = AbortSignal.timeout(READ_TIMEOUT_MS);

  let text: string;
  let model: string;
  try {
    const provider = await getProvider(context);
    const response = await withRetry(() => provider.generate({
      system: SYSTEM,
      messages: [{ role: "user", content: INSTRUCTION, images: [image] }],
      /*
        A full sheet is two ladders of up to 160 rungs each plus two rosters,
        and every rung is its own object — several hundred tokens per ten
        rungs. 8k did not cover one side of a junior game, let alone both, and
        on a model that thinks before it answers the thinking is spent from
        this same budget: the reply came back empty or cut off mid-object, and
        a truncated reply is a failed parse, which reads as "it got the players
        and none of the scores".
      */
      maxTokens: 32_768,
      // A decoder constraint, not a polite request. The prompt has always
      // asked for bare JSON; this is what makes it so on providers that can.
      json: true,
      /*
        Transcription is perception, not deduction, and the model's own
        reasoning is where the time went: on this sheet the default spent
        16,573 thinking tokens over 138 seconds — longer than any serverless
        platform will hold a request open — against 3,327 tokens of actual
        answer. At "low" it produced the same two ladders, the same rosters
        and the same period ends in 20 seconds and thought nothing at all.
      */
      thinking: "low",
      // Without a deadline a slow read runs until the platform kills the
      // request, which tells the person nothing. See READ_TIMEOUT_MS.
      signal: deadline,
    }));
    text = response.text;
    model = response.model;
  } catch (error) {
    throw new ConflictError(describeProviderError(error));
  }

  return { transcription: parseTranscription(text), model };
}

/**
 * Statuses worth trying again: the provider is busy, not wrong.
 *
 * 429 is deliberately not here. On a free-tier key it means the day's
 * allowance is gone — Google's own answer was "please retry in 11h22m" — and
 * retrying spends two more of the twenty requests the club gets, which cannot
 * succeed and are taken from tomorrow's reads. A burst limit does clear in a
 * minute, but that minute is not ours to wait inside a request.
 */
const RETRYABLE = new Set([500, 502, 503, 504]);

/**
 * Retries a provider call while it is merely overloaded.
 *
 * Gemini answers 503 "experiencing high demand" readily — often for minutes at
 * a time, and for every model on a key. One of those used to end the read and
 * mark the sheet FAILED, which puts a capacity blip on the club's side of the
 * screen as though their photograph were at fault.
 *
 * The retries are deliberately few and quick. They cost nothing when the
 * provider is up, and when it is down for real nothing here will fix it — the
 * honest answer arrives a few seconds later either way.
 */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  const backoffMs = [1_000, 3_000];

  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: unknown }).status)
          : undefined;

      if (attempt >= backoffMs.length || !status || !RETRYABLE.has(status)) throw error;

      log.warn("referto.read.retry", { attempt: attempt + 1, status });
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
    }
  }
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
    /*
      Say which kind of broken it is. A reply that stops mid-object means the
      model ran out of output budget — the club can do nothing about that, and
      telling them the JSON was invalid sends them off photographing the sheet
      again. A reply that is malformed in the middle is a different fault and
      a re-read may well fix it.
    */
    throw new ConflictError(
      text.trimEnd().endsWith("}")
        ? "The sheet could not be read: the transcription came back malformed. Try reading it again."
        : "The sheet could not be read: the transcription was cut off before it finished.",
    );
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

/**
 * Answers a question about the photograph, in words.
 *
 * The review screen asks the reader things like "who scored to reach 6?" and
 * the reader, reasonably, sometimes wants to ask something back — what does
 * this say, why do you think there is a basket here, is that a 1 or a 7. This
 * is that conversation: the same photograph, a free-text question, a short
 * answer.
 *
 * It is advice and nothing else. Nothing it says is written anywhere, no
 * transcription is revised by it, and the person still answers the question
 * themselves. That is the same rule the rest of this file follows — the model
 * describes what it sees, people and arithmetic decide what is true — and here
 * it is the whole point: a reader who can interrogate a reading is far more
 * likely to catch it being wrong than one who can only accept or skip it.
 */
export async function askAboutReferto(
  context: AuthContext,
  image: { data: string; mediaType: ReadableImageType },
  input: { situation: string; question: string },
): Promise<{ answer: string; model: string }> {
  assertPermission(context, "ai.read");

  try {
    const provider = await getProvider(context);
    const response = await withRetry(() =>
      provider.generate({
        system: ASK_SYSTEM,
        messages: [
          {
            role: "user",
            content: `What the app is unsure about:\n${input.situation}\n\nThe question:\n${input.question}`,
            images: [image],
          },
        ],
        maxTokens: 2_048,
        thinking: "low",
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      }),
    );
    return { answer: response.text.trim(), model: response.model };
  } catch (error) {
    throw new ConflictError(describeProviderError(error));
  }
}

const ASK_SYSTEM = `You are looking at a photograph of an Italian basketball
score sheet (referto ufficiale di gara) with somebody from the club, who is
checking an automatic transcription of it against the paper.

Answer their question about what is on the sheet. Be short — a few sentences,
no preamble, no markdown. Answer in the language they wrote in.

Rules that matter more than being helpful:
- Report what you can see, and say plainly when you cannot see it. "I can't
  make that out" is a useful answer; a guess dressed as a reading is not.
- If they are asking why the transcription says something, consider that the
  transcription may simply be wrong, and say so if that is what the paper
  shows. You are not defending it.
- The PUNTEGGIO PROGRESSIVO has two teams side by side, in the order
  [A scorer] [A total] [B total] [B scorer]. A mark in one team's columns is
  easily taken for the other's. Check which column you are describing before
  you answer.
- Never total, sum or calculate anything. The app does the arithmetic.`;
