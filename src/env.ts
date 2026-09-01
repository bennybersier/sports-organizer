import "server-only";

import { z } from "zod";

/**
 * Environment configuration, validated once at module load.
 *
 * Importing this module from anywhere on the server fails fast and loudly when
 * a required secret is missing, rather than surfacing as a confusing runtime
 * error deep inside a request.
 *
 * Only NEXT_PUBLIC_* values are ever allowed to reach the browser bundle; see
 * `publicEnv` at the bottom of this file for the exhaustive list.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),

  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),

  /**
   * Publishable key (`sb_publishable_…`). Safe to ship to the browser: it is
   * subject to RLS exactly like an unauthenticated request.
   *
   * Replaces the legacy `anon` JWT, which Supabase deprecates at the end of 2026.
   */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20)
    .refine((value) => !value.startsWith("sb_secret_"), {
      error:
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Anything NEXT_PUBLIC_ is " +
        "inlined into the browser bundle — move it to SUPABASE_SECRET_KEY and rotate it now.",
    })
    .refine((value) => value.startsWith("sb_publishable_") || value.startsWith("eyJ"), {
      error:
        "Expected a publishable key starting with `sb_publishable_`. Copy it from " +
        "Project Settings -> API Keys in the Supabase dashboard.",
    }),

  /**
   * Secret key (`sb_secret_…`). **Bypasses RLS.** Used only by server-side code
   * that has already resolved an AuthContext and checked permissions itself
   * (background jobs, MCP, secret handling). Never imported into a client
   * component.
   *
   * Replaces the legacy `service_role` JWT.
   */
  SUPABASE_SECRET_KEY: z
    .string()
    .min(20)
    .refine((value) => value.startsWith("sb_secret_") || value.startsWith("eyJ"), {
      error:
        "Expected a secret key starting with `sb_secret_`. Copy it from " +
        "Project Settings -> API Keys in the Supabase dashboard.",
    }),

  /**
   * 32-byte key, base64 encoded, used for AES-256-GCM encryption of tenant AI
   * keys and OAuth refresh tokens at rest.
   * Generate with: openssl rand -base64 32
   */
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, "base64").length === 32,
      "ENCRYPTION_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32)",
    ),

  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  /** Optional until the email provider is wired up in Phase 7. */
  EMAIL_FROM: z.email().optional(),
  RESEND_API_KEY: z.string().optional(),

  /** Optional until Google Calendar sync lands in Phase 8. */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration.\n${issues}\n\n` +
        "Copy .env.example to .env.local and fill in the missing values.",
    );
  }

  warnOnLegacyKeys(parsed.data);
  return parsed.data;
}

/**
 * Supabase's `anon` / `service_role` JWTs still work, but are deprecated and
 * stop working at the end of 2026. They are accepted here so an existing
 * project keeps running, with a nudge rather than a hard failure.
 */
function warnOnLegacyKeys(config: ServerEnv): void {
  const legacy = [
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("eyJ") && "publishable",
    config.SUPABASE_SECRET_KEY.startsWith("eyJ") && "secret",
  ].filter(Boolean);

  if (legacy.length > 0) {
    console.warn(
      `[env] Using legacy Supabase JWT keys for: ${legacy.join(", ")}. ` +
        "Switch to sb_publishable_… / sb_secret_… keys — the legacy keys are " +
        "deprecated and stop working at the end of 2026.",
    );
  }
}

export const env = loadEnv();

export const isProduction = env.APP_ENV === "production";
export const isDevelopment = env.APP_ENV === "development";
