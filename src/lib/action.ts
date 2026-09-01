import "server-only";

import { z } from "zod";

import {
  AppError,
  ValidationError,
  isAppError,
  serializeError,
  type SerializedError,
} from "@/lib/errors";
import { isProduction } from "@/env";

/**
 * The uniform Server Action result.
 *
 * Actions never throw across the RSC boundary: a thrown error there becomes an
 * opaque "An error occurred in the Server Components render" in production,
 * which tells the user nothing. Instead every action returns a discriminated
 * union the form layer can render — including field-level errors.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: SerializedError };

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFailure(error: unknown): ActionResult<never> {
  if (!isAppError(error)) {
    // Log the real cause server-side; the client gets a generic message.
    console.error("[action] unhandled error", error);
  } else if (!isProduction && error.context) {
    console.warn(`[action] ${error.code}`, error.context);
  }
  return { ok: false, error: serializeError(error) };
}

/**
 * Wraps an action body so any thrown AppError becomes a structured result.
 *
 * Next.js signals redirect() and notFound() by throwing, so those are re-thrown
 * untouched rather than swallowed into an error result.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return actionSuccess(await fn());
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return actionFailure(error);
  }
}

function isNextControlFlow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(
      (error as { digest: string }).digest,
    )
  );
}

/**
 * Validates input with Zod, converting failures into a ValidationError carrying
 * field-level messages.
 *
 * Every action validates its own input: an action is a public HTTP endpoint,
 * and client-side validation is a convenience, never a control.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_form";
    (fieldErrors[path] ??= []).push(issue.message);
  }

  throw new ValidationError(undefined, { fieldErrors });
}

/** Reads a FormData into a plain object before Zod validation. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

export { AppError };
