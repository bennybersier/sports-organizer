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

import type { AiProviderId, ReadableImageType } from "@/domain/ai";

/**
 * A picture sent with a message.
 *
 * Base64 without the `data:` prefix, because that is what two of the three
 * SDKs want and the third is one template string away. The media type is
 * narrowed to what every provider reads, so an unreadable upload is refused
 * where it is uploaded rather than by a vendor error three layers down.
 */
export interface AiImage {
  data: string;
  mediaType: ReadableImageType;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * Pictures to send alongside the text, in order, before it.
   *
   * Optional and ignored by every existing caller: scheduling advice is a
   * conversation about rows in a database and has nothing to look at.
   */
  images?: AiImage[];
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

/**
 * How long a key test may take before it is called a failure.
 *
 * A verify runs while somebody watches a spinner, so it needs a deadline that
 * a person would accept — not the SDK's default, which is minutes. Without one
 * a provider having a slow afternoon is indistinguishable from a wrong key,
 * and the button spins until the tab is closed.
 */
export const VERIFY_TIMEOUT_MS = 15_000;

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

  // A deadline we imposed, not a vendor status. Worth its own sentence: the
  // key may be perfectly good and the provider merely slow.
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "The provider did not answer within 15 seconds. The key may still be valid — try again.";
  }
  if (status === 401 || status === 403) return "The API key was rejected.";
  if (status === 404) return "That model isn't available to this key.";
  if (status === 429) return "The provider is rate-limiting this key.";
  if (status && status >= 500) return "The provider is unavailable right now.";
  return "The request to the AI provider failed.";
}
