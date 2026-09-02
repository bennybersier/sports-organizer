import "server-only";

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
