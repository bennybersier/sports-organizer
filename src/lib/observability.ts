import "server-only";

import { isProduction } from "@/env";

/**
 * Structured logging.
 *
 * One shape for every event, so a log line can be filtered and aggregated
 * rather than grepped. JSON in production (where something is collecting it),
 * readable lines in development (where a person is reading it).
 *
 * The one rule that matters: **nothing secret goes in.** Fields whose names
 * look credential-shaped are redacted at this boundary regardless of what the
 * caller passed, because a context object assembled from a row can pick one up
 * by accident.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  /** Which club, so multi-tenant issues can be traced without guessing. */
  tenantId?: string;
  userId?: string;
  /** WEB, MCP, AI, JOB — matches the audit log's actor_type. */
  actor?: string;
  /** Milliseconds, for the operations worth timing. */
  durationMs?: number;
  [key: string]: unknown;
}

const REDACTED_KEYS = [
  "password", "token", "secret", "apikey", "api_key",
  "authorization", "cookie", "ciphertext", "hash",
];

function scrub(context: LogContext): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    const lowered = key.toLowerCase();
    clean[key] = REDACTED_KEYS.some((needle) => lowered.includes(needle))
      ? "[redacted]"
      : value;
  }
  return clean;
}

function emit(level: LogLevel, event: string, context: LogContext = {}): void {
  const payload = { level, event, at: new Date().toISOString(), ...scrub(context) };

  if (isProduction) {
    // One JSON object per line: what every log collector expects.
    console[level === "debug" ? "log" : level](JSON.stringify(payload));
    return;
  }

  const detail = Object.entries(scrub(context))
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" ");
  console[level === "debug" ? "log" : level](`[${level}] ${event}${detail ? ` ${detail}` : ""}`);
}

export const log = {
  debug: (event: string, context?: LogContext) => {
    // Debug output is noise in production and useful nowhere else.
    if (!isProduction) emit("debug", event, context);
  },
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
};

/**
 * Times an operation and logs how long it took.
 *
 * Used for the things worth watching in production — schedule generation above
 * all, since it is the one operation whose cost grows with a club's size.
 */
export async function timed<T>(
  event: string,
  context: LogContext,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    log.info(event, { ...context, durationMs: Date.now() - startedAt, outcome: "ok" });
    return result;
  } catch (error) {
    log.error(event, {
      ...context,
      durationMs: Date.now() - startedAt,
      outcome: "failed",
      // The message only — a stack trace in a log line is rarely read and
      // often carries values from the request.
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}
