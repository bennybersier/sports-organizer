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
 * Default model per provider — only the suggestion the form starts with; the
 * chosen model is stored per tenant. Bumping a default is one edit here.
 */
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  ANTHROPIC: "claude-opus-5",
  GEMINI: "gemini-2.5-pro",
  OPENAI: "gpt-5",
};
