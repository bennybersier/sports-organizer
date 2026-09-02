import "server-only";

/**
 * The AI provider interface.
 *
 * One shape, three implementations. The application never imports a vendor SDK
 * directly — it asks the registry for whatever the tenant configured and works
 * against this. Adding a fourth provider is a new adapter and nothing else.
 *
 * A hard rule runs through everything below: **AI is never authoritative about
 * scheduling.** It explains, summarises and drafts. Whether a schedule is valid
 * is decided by the deterministic engine in `src/domain/scheduling`, and any
 * action an AI suggests goes back through the same services, validation and
 * authorization as a human's.
 */

export type { AiProviderId } from "@/domain/ai";
export { AI_PROVIDER_IDS, DEFAULT_MODELS, PROVIDER_LABELS } from "@/domain/ai";

import type { AiProviderId } from "@/domain/ai";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  /** Instructions and guardrails. Never contains tenant secrets. */
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  /** Model override; otherwise the tenant's configured model is used. */
  model?: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  /** Streams text deltas. Falls back to a single chunk if unsupported. */
  stream(options: GenerateOptions): AsyncIterable<string>;
  /** Cheapest possible round-trip, to check a key works. */
  verify(): Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * Normalises a provider failure into something safe to show a user.
 *
 * Vendor errors routinely echo the request back, and a request may contain club
 * data — so nothing from the provider's message is passed through verbatim
 * except the status class it belongs to.
 */
export function describeProviderError(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;

  if (status === 401 || status === 403) return "The API key was rejected.";
  if (status === 404) return "That model isn't available to this key.";
  if (status === 429) return "The provider is rate-limiting this key.";
  if (status && status >= 500) return "The provider is unavailable right now.";
  return "The request to the AI provider failed.";
}
