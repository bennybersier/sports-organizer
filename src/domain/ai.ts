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
 * instead.
 */
export const READABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ReadableImageType = (typeof READABLE_IMAGE_TYPES)[number];

export function isReadableImageType(value: string): value is ReadableImageType {
  return (READABLE_IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Everything a sheet may be uploaded as.
 *
 * PDF was left out at first because each vendor takes one differently — an
 * inline part for Gemini, a document block for Anthropic, a file input for
 * OpenAI — and a format that works on one club's key and not another's is
 * worse than one refused up front. All three adapters now carry that
 * difference, so the club can hand over what it actually has: a referto is
 * routinely circulated as a PDF, and asking somebody to convert one back to
 * a photograph is asking them to degrade it first.
 */
export const READABLE_FILE_TYPES = [...READABLE_IMAGE_TYPES, "application/pdf"] as const;

export type ReadableFileType = (typeof READABLE_FILE_TYPES)[number];

export function isReadableFileType(value: string): value is ReadableFileType {
  return (READABLE_FILE_TYPES as readonly string[]).includes(value);
}

/** Whether a stored sheet is a page to be rendered rather than a picture. */
export function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
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
  /*
    Argon rather than a flash or a pro, chosen by measurement on a real
    referto rather than by tier.

    The hard job here is reading a photographed score sheet, and it is
    perception, not reasoning — which is why the expensive pro model was the
    worst of the four tried, inventing a basket in our column that belonged to
    the opponent's and getting both final scores wrong, while taking five
    times as long. Argon read the same photograph with every hard check
    passing on three runs out of four, in twenty seconds.

    `gemini-2.5-pro` was here before and is not merely weaker: it answers 404
    on a current API key, so the default a club starts with did not work at
    all.
  */
  GEMINI: "gemini-4-argon",
  OPENAI: "gpt-5",
};
