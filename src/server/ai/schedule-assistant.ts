import "server-only";

import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { getProvider } from "@/server/ai/registry";
import { recordVerification } from "@/server/services/ai-config-service";
import { describeProviderError } from "@/server/ai/provider";
import type { GenerationResult } from "@/domain/scheduling/types";

/**
 * The AI use cases that touch scheduling.
 *
 * Every one of them takes the deterministic engine's output as input and turns
 * it into prose. None of them decides anything: the model is handed facts the
 * engine established and asked to explain them. If the model disagrees with the
 * engine, the engine is right — which is why the engine's findings are also
 * rendered structurally next to any AI text, never replaced by it.
 *
 * The prompt says so too, but the architecture is what enforces it: there is no
 * code path from a model's output to a schedule change.
 */

const GUARDRAIL = `You help a sports club understand its training schedule.

You are given facts already established by a deterministic scheduling engine.
Your job is to explain them clearly to a club organizer — never to re-decide
them. Rules:

- Treat the supplied facts as true. Do not contradict them, and do not
  speculate about causes that are not in the data.
- If the data does not answer the question, say so plainly.
- Never claim a schedule is valid or invalid; that is the engine's judgement,
  and it is shown to the user separately.
- Be brief and concrete. An organizer wants to know what to change.
- Do not invent team, trainer or gym names. Use only the ones given.`;

/**
 * Explains, in prose, why a generation run fell short.
 *
 * The structured findings are already shown; this adds the sentence a person
 * would actually say — "Dawn Squad can't train because nobody's free at 6am" —
 * which the codes alone don't convey.
 */
export async function explainShortfalls(
  context: AuthContext,
  result: GenerationResult,
): Promise<{ text: string } | { error: string }> {
  assertPermission(context, "ai.read");

  if (result.unmet.length === 0) {
    return { text: "" };
  }

  // Only the facts, and only about this run. No club data beyond what the
  // organizer is already looking at on screen.
  const facts = {
    scheduled: result.stats.sessionsScheduled,
    requested: result.stats.sessionsRequested,
    unmet: result.unmet.map((shortfall) => ({
      team: shortfall.teamName,
      got: shortfall.scheduled,
      needed: shortfall.requested,
      reasons: shortfall.reasons.map((reason) => reason.code),
    })),
  };

  try {
    const provider = await getProvider(context);
    const response = await provider.generate({
      system: GUARDRAIL,
      maxTokens: 600,
      messages: [
        {
          role: "user",
          content:
            "Explain to a club organizer why these training requirements could not be met, " +
            "and what they could change. Two or three sentences per team, no preamble.\n\n" +
            JSON.stringify(facts, null, 2),
        },
      ],
    });

    return { text: response.text };
  } catch (error) {
    // A failed explanation must never break the page it sits on: the structured
    // findings are the real answer and are already rendered.
    return { error: describeProviderError(error) };
  }
}

/** Verifies a stored configuration and records the outcome. */
export async function verifyConfiguredProvider(
  context: AuthContext,
  providerId: "ANTHROPIC" | "GEMINI" | "OPENAI",
): Promise<{ ok: true } | { ok: false; message: string }> {
  assertPermission(context, "ai.manage");

  try {
    const provider = await getProvider(context, providerId);
    const result = await provider.verify();
    await recordVerification(context, providerId, result);
    return result;
  } catch (error) {
    const result = { ok: false as const, message: describeProviderError(error) };
    await recordVerification(context, providerId, result);
    return result;
  }
}
