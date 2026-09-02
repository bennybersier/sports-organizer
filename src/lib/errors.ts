/**
 * Structured application errors.
 *
 * Every error carries a stable `code` (for clients and logs) and a
 * `userMessage` that is safe to render. Anything not derived from an
 * AppError is reported to users as a generic internal error, so SQL text,
 * stack traces, provider responses and credentials can never leak through an
 * error path.
 */

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTEGRATION_ERROR"
  | "SCHEDULING_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  /** Field-level messages, keyed by form path. Rendered next to inputs. */
  fieldErrors?: Record<string, string[]>;
  /** Structured context for logs. Never rendered, never contains secrets. */
  context?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly context?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    status: number,
    userMessage: string,
    options: AppErrorOptions = {},
  ) {
    super(userMessage, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    this.fieldErrors = options.fieldErrors;
    this.context = options.context;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please check the highlighted fields.", options: AppErrorOptions = {}) {
    super("VALIDATION_ERROR", 422, message, options);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "You need to sign in to continue.", options: AppErrorOptions = {}) {
    super("AUTHENTICATION_REQUIRED", 401, message, options);
  }
}

export class AuthorizationError extends AppError {
  constructor(
    message = "You don't have permission to do that.",
    options: AppErrorOptions = {},
  ) {
    super("AUTHORIZATION_ERROR", 403, message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "record", options: AppErrorOptions & { message?: string } = {}) {
    super("NOT_FOUND", 404, options.message ?? `That ${resource} could not be found.`, options);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("CONFLICT", 409, message, options);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many attempts. Please wait a moment and try again.") {
    super("RATE_LIMITED", 429, message);
  }
}

export class IntegrationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("INTEGRATION_ERROR", 502, message, options);
  }
}

export class SchedulingError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("SCHEDULING_ERROR", 422, message, options);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message = "An external service is unavailable. Please try again.", options: AppErrorOptions = {}) {
    super("EXTERNAL_SERVICE_ERROR", 502, message, options);
  }
}

export class InternalError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super("INTERNAL_ERROR", 500, "Something went wrong on our end. Please try again.", options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Postgres error codes we translate into domain errors rather than leaking.
 * The `message` from Postgres is deliberately discarded except for the custom
 * `raise exception` texts our own functions produce, which are written to be
 * user-facing.
 */
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";
const PG_EXCLUSION_VIOLATION = "23P01";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_RLS_VIOLATION = "42501";
const PG_NO_DATA = "P0002";
const PG_RAISE_EXCEPTION = "P0001";

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Marker our own PL/pgSQL functions set on messages written for end users.
 *
 * Postgres never sets this hint itself, so it unambiguously separates
 * "a constraint was violated" (message is technical — must not be shown) from
 * "our function raised copy intended for a human". Without it, a precise
 * message like "No account exists for that email" gets replaced by a generic
 * one, which is worse than useless: it is wrong.
 *
 * Set in supabase/migrations/*_0012_error_messages_and_owner_guard.sql.
 */
const USER_MESSAGE_HINT = "SCO_USER_MESSAGE";

function isPostgrestError(error: unknown): error is PostgrestLikeError {
  return typeof error === "object" && error !== null && "code" in error;
}

/**
 * Translates a Supabase/PostgREST error into an AppError.
 *
 * `conflictMessages` lets a caller give a human explanation for a specific
 * constraint, e.g. `{ gyms_tenant_name_uniq: "A gym with that name already exists." }`.
 */
export function fromDatabaseError(
  error: unknown,
  options: {
    resource?: string;
    conflictMessages?: Record<string, string>;
    /**
     * Message for an exclusion violation (23P01), regardless of which
     * constraint fired. Postgres generates those names by truncating the column
     * list, so matching on them is brittle — the same rule can be expressed by
     * three constraints with three unpredictable names.
     */
    exclusionMessage?: string;
  } = {},
): AppError {
  if (isAppError(error)) return error;
  if (!isPostgrestError(error)) return new InternalError({ cause: error });

  const { code, message = "" } = error;
  const resource = options.resource ?? "record";

  const constraintMatch = message.match(/constraint "([^"]+)"/);
  const constraint = constraintMatch?.[1];
  const mapped = constraint ? options.conflictMessages?.[constraint] : undefined;

  // Our own functions write their own copy. Keep it: the SQLSTATE still picks
  // the error type and status, the hint only decides whose words are shown.
  if (error.hint === USER_MESSAGE_HINT && message) {
    switch (code) {
      case PG_INSUFFICIENT_PRIVILEGE:
        return new AuthorizationError(message, { cause: error });
      case PG_NO_DATA:
        return new NotFoundError(resource, { message, cause: error });
      case PG_CHECK_VIOLATION:
        return new ValidationError(message, { cause: error });
      case PG_FOREIGN_KEY_VIOLATION:
      case PG_UNIQUE_VIOLATION:
      case PG_EXCLUSION_VIOLATION:
        return new ConflictError(message, { cause: error });
      default:
        return new ConflictError(message, { cause: error });
    }
  }

  switch (code) {
    case PG_UNIQUE_VIOLATION:
      return new ConflictError(mapped ?? `That ${resource} already exists.`, {
        context: { constraint },
        cause: error,
      });

    case PG_EXCLUSION_VIOLATION:
      return new ConflictError(
        mapped ??
          options.exclusionMessage ??
          "That overlaps an existing entry. Adjust the times and try again.",
        { context: { constraint }, cause: error },
      );

    case PG_FOREIGN_KEY_VIOLATION:
      return new ConflictError(
        mapped ?? "That change would break a link to related records.",
        { context: { constraint }, cause: error },
      );

    case PG_CHECK_VIOLATION:
      return new ValidationError(mapped ?? "That value isn't allowed here.", {
        context: { constraint },
        cause: error,
      });

    case PG_INSUFFICIENT_PRIVILEGE:
    case PG_RLS_VIOLATION:
      return new AuthorizationError(undefined, { cause: error });

    case PG_NO_DATA:
      return new NotFoundError(resource, { cause: error });

    // Messages raised by our own PL/pgSQL functions are written for end users.
    case PG_RAISE_EXCEPTION:
      return new ConflictError(message || "That operation isn't allowed right now.", {
        cause: error,
      });

    // PostgREST: "JSON object requested, multiple (or no) rows returned"
    case "PGRST116":
      return new NotFoundError(resource, { cause: error });

    default:
      return new InternalError({ cause: error, context: { code } });
  }
}

/** The safe, serialisable shape handed back to clients. */
export interface SerializedError {
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export function serializeError(error: unknown): SerializedError {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.userMessage,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    };
  }
  return { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." };
}
