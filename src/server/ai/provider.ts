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
  /**
   * Ask the provider to emit JSON and nothing else.
   *
   * A prompt that says "reply with JSON only" is a request; this is a
   * constraint the decoder enforces. Providers that have no such mode ignore
   * it, which is safe — the caller still has to parse defensively.
   */
  json?: boolean;
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

/**
 * How long reading a game sheet may take.
 *
 * Transcribing a referto is a much bigger job than a key test — a full
 * photograph, a hundred ladder rungs, two rosters — so it gets a deadline of
 * its own. It sits below the route's `maxDuration` on purpose: whichever limit
 * fires first decides what the person is told, and ours can say the sheet
 * could not be read and mark it FAILED, where the platform's just kills the
 * request and explains nothing.
 */
export const READ_TIMEOUT_MS = 50_000;

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
 * Pulls the quota numbers out of a 429, and nothing else.
 *
 * "The provider is rate-limiting this key" is true of both a burst that will
 * clear in a minute and an allowance that is gone until tomorrow, and those
 * ask opposite things of whoever reads it. Google says which in the error
 * body — but that body is vendor text, so only the two numbers are taken from
 * it and the sentence around them is ours. Returns null for any shape that
 * isn't recognised, which includes every other provider.
 */
function quotaFailure(error: unknown): { perDay: number; resetsInHours: number | null } | null {
  if (!(error instanceof Error)) return null;

  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    return null;
  }

  const details = (body as { error?: { details?: unknown } })?.error?.details;
  if (!Array.isArray(details)) return null;

  let perDay: number | null = null;
  let retrySeconds: number | null = null;

  for (const detail of details as Record<string, unknown>[]) {
    const violations = detail.violations;
    if (Array.isArray(violations)) {
      for (const violation of violations as Record<string, unknown>[]) {
        // Only the per-day quota earns the different sentence; a per-minute
        // one really does clear in a minute.
        if (typeof violation.quotaId === "string" && violation.quotaId.includes("PerDay")) {
          const value = Number(violation.quotaValue);
          if (Number.isFinite(value)) perDay = value;
        }
      }
    }
    if (typeof detail.retryDelay === "string") {
      const seconds = Number.parseInt(detail.retryDelay, 10);
      if (Number.isFinite(seconds)) retrySeconds = seconds;
    }
  }

  if (perDay === null) return null;
  return {
    perDay,
    resetsInHours: retrySeconds === null ? null : Math.max(1, Math.round(retrySeconds / 3600)),
  };
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
    return "The provider did not answer in time. The key may still be valid — try again.";
  }
  if (status === 401 || status === 403) return "The API key was rejected.";
  if (status === 404) return "That model isn't available to this key.";
  if (status === 429) {
    const quota = quotaFailure(error);
    if (quota?.perDay) {
      return quota.resetsInHours
        ? `This key has used its daily allowance for this model — ${quota.perDay} requests a day on the free tier. It resets in about ${quota.resetsInHours} hours. Adding billing to the Google project, or choosing a smaller model, lifts the limit.`
        : `This key has used its daily allowance for this model — ${quota.perDay} requests a day on the free tier. Adding billing to the Google project, or choosing a smaller model, lifts the limit.`;
    }
    return "The provider is rate-limiting this key. Wait a minute and try again.";
  }
  if (status && status >= 500) return "The provider is unavailable right now.";
  return "The request to the AI provider failed.";
}
