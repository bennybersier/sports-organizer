import "server-only";

import { CONVERSATION_MODELS } from "@/domain/ai";
import { ConflictError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import {
  getDecryptedKey,
  getDefaultProvider,
} from "@/server/services/ai-config-service";

import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { OpenAiProvider } from "./openai-provider";
import type { AiProvider, AiProviderId } from "./provider";

/**
 * Builds the provider a tenant has configured.
 *
 * The only place a decrypted key is turned into a client, and the only place
 * that knows which vendor SDK exists. Callers ask for "the tenant's AI" and get
 * the interface.
 */
export async function getProvider(
  context: AuthContext,
  providerId?: AiProviderId,
): Promise<AiProvider> {
  assertPermission(context, "ai.read");

  const id = providerId ?? (await getDefaultProvider(context));
  if (!id) {
    throw new ConflictError(
      "No AI provider is configured for this club. Add one in Integrations.",
    );
  }

  const { apiKey, model } = await getDecryptedKey(context, id);

  switch (id) {
    case "ANTHROPIC":
      return new AnthropicProvider(apiKey, model);
    case "GEMINI":
      return new GeminiProvider(apiKey, model);
    case "OPENAI":
      return new OpenAiProvider(apiKey, model);
  }
}

/**
 * The model a club has chosen for talking about a document, if any.
 *
 * Three steps, most specific first: what the club set, then the application's
 * cheap default for that provider, then the club's reading model. The last
 * step is what makes this safe to leave blank — a provider with no cheap
 * model named still works, it just costs the same as a read.
 */
export async function getConversationModel(
  context: AuthContext,
  providerId?: AiProviderId,
): Promise<string | undefined> {
  assertPermission(context, "ai.read");

  const id = providerId ?? (await getDefaultProvider(context));
  if (!id) return undefined;

  const { conversationModel } = await getDecryptedKey(context, id);
  return conversationModel?.trim() || CONVERSATION_MODELS[id];
}

/** Builds a provider from a key that hasn't been stored yet, to test it. */
export function buildProvider(
  id: AiProviderId,
  apiKey: string,
  model: string,
): AiProvider {
  switch (id) {
    case "ANTHROPIC":
      return new AnthropicProvider(apiKey, model);
    case "GEMINI":
      return new GeminiProvider(apiKey, model);
    case "OPENAI":
      return new OpenAiProvider(apiKey, model);
  }
}
