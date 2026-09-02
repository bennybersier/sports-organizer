import "server-only";

import { ConflictError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { normalizeTime, type IsoWeekday } from "@/domain/availability";
import type {
  AvailabilityDomain,
  CreateAvailabilityInput,
  CreateExceptionInput,
  UpdateAvailabilityInput,
} from "@/lib/validation/availability";

/**
 * Availability for gyms, trainers and teams.
 *
 * The three domains have structurally identical tables, so they share one
 * implementation rather than three near-copies that drift apart. The table and
 * foreign-key names are the only difference, and they live in one map.
 */
const DOMAINS = {
  gym: {
    recurring: "gym_availability",
    exceptions: "gym_availability_exceptions",
    fk: "gym_id",
    parent: "gyms",
  },
  trainer: {
    recurring: "trainer_availability",
    exceptions: "trainer_availability_exceptions",
    fk: "trainer_id",
    parent: "trainers",
  },
  team: {
    recurring: "team_availability",
    exceptions: "team_availability_exceptions",
    fk: "team_id",
    parent: "teams",
  },
} as const;

export interface AvailabilityWindow {
  id: string;
  isoWeekday: IsoWeekday;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
  note: string | null;
}

export interface AvailabilityExceptionRecord {
  id: string;
  exceptionDate: string;
  startTime: string | null;
  endTime: string | null;
  type: "UNAVAILABLE" | "AVAILABLE_OVERRIDE";
  reason: string | null;
}

/**
 * The database rejects overlapping windows with an exclusion constraint. That
 * is the guarantee — contradictory availability never reaches the scheduler —
 * but the raw error says nothing useful, so it is translated here.
 *
 * Matched by SQLSTATE rather than constraint name: Postgres generates those
 * names by truncating the column list, so the three tables end up with three
 * unpredictable names for the same rule.
 */
const OVERLAP_MESSAGE =
  "That overlaps an existing window on the same day. Edit the existing one, or choose different times.";

// The generic table access needs a loosened client; every query below still
// filters by tenant_id and runs under RLS.
type LooseClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function listAvailability(
  context: AuthContext,
  domain: AvailabilityDomain,
  ownerId: string,
): Promise<AvailabilityWindow[]> {
  assertPermission(context, "availability.read");
  const config = DOMAINS[domain];

  const { data, error } = await (context.db as unknown as LooseClient)
    .from(config.recurring)
    .select("id, iso_weekday, start_time, end_time, valid_from, valid_until, note")
    .eq("tenant_id", context.tenant.id)
    .eq(config.fk, ownerId)
    .order("iso_weekday")
    .order("start_time");

  if (error) throw fromDatabaseError(error, { resource: "availability" });

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    isoWeekday: row.iso_weekday as IsoWeekday,
    startTime: normalizeTime(row.start_time as string),
    endTime: normalizeTime(row.end_time as string),
    validFrom: row.valid_from as string,
    validUntil: (row.valid_until as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  }));
}

export async function listExceptions(
  context: AuthContext,
  domain: AvailabilityDomain,
  ownerId: string,
  options: { from?: string } = {},
): Promise<AvailabilityExceptionRecord[]> {
  assertPermission(context, "availability.read");
  const config = DOMAINS[domain];

  let query = (context.db as unknown as LooseClient)
    .from(config.exceptions)
    .select("id, exception_date, start_time, end_time, type, reason")
    .eq("tenant_id", context.tenant.id)
    .eq(config.fk, ownerId);

  // Past exceptions are history; the editor only shows what still matters.
  if (options.from) query = query.gte("exception_date", options.from);

  const { data, error } = await query.order("exception_date");
  if (error) throw fromDatabaseError(error, { resource: "availability" });

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    exceptionDate: row.exception_date as string,
    startTime: row.start_time ? normalizeTime(row.start_time as string) : null,
    endTime: row.end_time ? normalizeTime(row.end_time as string) : null,
    type: row.type as AvailabilityExceptionRecord["type"],
    reason: (row.reason as string | null) ?? null,
  }));
}

/** Confirms the owner belongs to this tenant before writing anything to it. */
async function assertOwner(
  context: AuthContext,
  domain: AvailabilityDomain,
  ownerId: string,
): Promise<void> {
  const { data } = await (context.db as unknown as LooseClient)
    .from(DOMAINS[domain].parent)
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", ownerId)
    .maybeSingle();

  if (!data) throw new ConflictError("That record no longer exists.");
}

export async function createAvailability(
  context: AuthContext,
  input: CreateAvailabilityInput,
): Promise<AvailabilityWindow> {
  assertPermission(context, "availability.create");
  await assertOwner(context, input.domain, input.ownerId);
  const config = DOMAINS[input.domain];

  const { data, error } = await (context.db as unknown as LooseClient)
    .from(config.recurring)
    .insert({
      tenant_id: context.tenant.id,
      [config.fk]: input.ownerId,
      iso_weekday: input.isoWeekday,
      start_time: input.startTime,
      end_time: input.endTime,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
      note: input.note,
      created_by: context.user.id,
    })
    .select("id, iso_weekday, start_time, end_time, valid_from, valid_until, note")
    .single();

  if (error) {
    throw fromDatabaseError(error, {
      resource: "availability",
      exclusionMessage: OVERLAP_MESSAGE,
    });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.AVAILABILITY_CHANGED,
    resourceType: `${input.domain}_availability`,
    resourceId: data.id,
    newValue: {
      owner: input.ownerId,
      weekday: input.isoWeekday,
      from: input.startTime,
      to: input.endTime,
    },
  });

  return {
    id: data.id,
    isoWeekday: data.iso_weekday,
    startTime: normalizeTime(data.start_time),
    endTime: normalizeTime(data.end_time),
    validFrom: data.valid_from,
    validUntil: data.valid_until,
    note: data.note,
  };
}

export async function updateAvailability(
  context: AuthContext,
  input: UpdateAvailabilityInput,
): Promise<void> {
  assertPermission(context, "availability.update");
  const config = DOMAINS[input.domain];

  const { error } = await (context.db as unknown as LooseClient)
    .from(config.recurring)
    .update({
      iso_weekday: input.isoWeekday,
      start_time: input.startTime,
      end_time: input.endTime,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
      note: input.note,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id);

  if (error) {
    throw fromDatabaseError(error, {
      resource: "availability",
      exclusionMessage: OVERLAP_MESSAGE,
    });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.AVAILABILITY_CHANGED,
    resourceType: `${input.domain}_availability`,
    resourceId: input.id,
    newValue: { weekday: input.isoWeekday, from: input.startTime, to: input.endTime },
  });
}

export async function deleteAvailability(
  context: AuthContext,
  domain: AvailabilityDomain,
  id: string,
): Promise<void> {
  assertPermission(context, "availability.delete");

  const { error } = await (context.db as unknown as LooseClient)
    .from(DOMAINS[domain].recurring)
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("id", id);

  if (error) throw fromDatabaseError(error, { resource: "availability" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.AVAILABILITY_CHANGED,
    resourceType: `${domain}_availability`,
    resourceId: id,
    oldValue: { deleted: true },
  });
}

export async function createException(
  context: AuthContext,
  input: CreateExceptionInput,
): Promise<void> {
  assertPermission(context, "availability.create");
  await assertOwner(context, input.domain, input.ownerId);
  const config = DOMAINS[input.domain];

  const { error } = await (context.db as unknown as LooseClient)
    .from(config.exceptions)
    .insert({
      tenant_id: context.tenant.id,
      [config.fk]: input.ownerId,
      exception_date: input.exceptionDate,
      start_time: input.startTime,
      end_time: input.endTime,
      type: input.type,
      reason: input.reason,
      created_by: context.user.id,
    });

  if (error) throw fromDatabaseError(error, { resource: "availability" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.AVAILABILITY_CHANGED,
    resourceType: `${input.domain}_availability_exception`,
    resourceId: input.ownerId,
    newValue: { date: input.exceptionDate, type: input.type, reason: input.reason },
  });
}

export async function deleteException(
  context: AuthContext,
  domain: AvailabilityDomain,
  id: string,
): Promise<void> {
  assertPermission(context, "availability.delete");

  const { error } = await (context.db as unknown as LooseClient)
    .from(DOMAINS[domain].exceptions)
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("id", id);

  if (error) throw fromDatabaseError(error, { resource: "availability" });
}

/** Total weekly hours, for the "is this club even schedulable?" summary. */
export function weeklyHours(windows: AvailabilityWindow[]): number {
  const minutes = windows.reduce((sum, window) => {
    const [sh, sm] = window.startTime.split(":").map(Number);
    const [eh, em] = window.endTime.split(":").map(Number);
    return sum + (eh * 60 + em - (sh * 60 + sm));
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}
