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
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),

  /**
   * Bypasses RLS. Used only by server-side code that has already resolved an
   * AuthContext and checked permissions itself (background jobs, MCP, secret
   * handling). Never imported into a client component.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

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

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.APP_ENV === "production";
export const isDevelopment = env.APP_ENV === "development";
