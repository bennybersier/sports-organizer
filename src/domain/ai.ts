/**
 * Client-safe AI vocabulary.
 *
 * The provider *interface* and its adapters are `server-only` — a browser must
 * never be able to import something that constructs a vendor client. These are
 * the parts the UI legitimately needs: which providers exist, what to call
 * them, and a sensible default model.
 */

export const AI_PROVIDER_IDS = ["ANTHROPIC", "GEMINI", "OPENAI"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  ANTHROPIC: "Anthropic Claude",
  GEMINI: "Google Gemini",
  OPENAI: "OpenAI",
};

/**
 * Image types every one of the three providers reads natively.
 *
 * Deliberately short. HEIC is what an iPhone stores and no vendor accepts it;
 * naming these three on the file input is what makes iOS hand over a JPEG
 * instead. PDF is absent because reading one differs per vendor, and a format
 * that works on one provider's key and not another's is worse than one that is
 * refused up front.
 */
export const READABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ReadableImageType = (typeof READABLE_IMAGE_TYPES)[number];

export function isReadableImageType(value: string): value is ReadableImageType {
  return (READABLE_IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * 10 MB, which is the storage bucket's limit and the figure
 * `serverActions.bodySizeLimit` in next.config.ts is set above. A phone photo
 * of a single A4 sheet is 2–5 MB, so this is headroom rather than a target.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Default model per provider — only the suggestion the form starts with; the
 * chosen model is stored per tenant. Bumping a default is one edit here.
 */
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  ANTHROPIC: "claude-opus-5",
  GEMINI: "gemini-2.5-pro",
  OPENAI: "gpt-5",
};
