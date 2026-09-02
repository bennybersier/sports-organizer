import "server-only";

import { AuthorizationError, ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";

/**
 * Publishes a schedule version, whatever the transport.
 *
 * Authorization happens here, in TypeScript, against the caller's resolved
 * permissions — which works identically for a browser session, an MCP key and a
 * background job. The transaction itself lives in
 * `internal_publish_schedule_version`, which is service_role-only precisely
 * because it performs no check of its own.
 *
 * The session-facing `publish_schedule_version` RPC still exists and still
 * checks `auth.uid()`; it is the right thing for a browser and the wrong thing
 * for a caller that has no JWT.
 */
export async function publishScheduleVersion(
  context: AuthContext,
  versionId: string,
): Promise<void> {
  assertPermission(context, "schedule.publish");

  const { error } = await createAdminClient().rpc(
    "internal_publish_schedule_version",
    { p_version_id: versionId, p_user_id: context.user.id },
  );

  if (error) throw fromDatabaseError(error, { resource: "schedule" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_PUBLISHED,
    resourceType: "schedule_version",
    resourceId: versionId,
  });
}

/*
  RLS filters an UPDATE rather than rejecting it, so a caller the policy
  excludes gets zero rows and no error. Every write below checks what came back
  and raises this rather than reporting a success that never happened.
*/
const errorMessages = {
  cannotChangeSchedule: "You don't have permission to change a schedule for this club.",
} as const;

/**
 * Takes a published schedule back off the calendar.
 *
 * The counterpart to publishing, and the thing whose absence made a published
 * schedule permanent: there was no way to withdraw one, so a schedule published
 * by mistake stayed on the club's calendar forever.
 *
 * Archives rather than deletes. The version, its sessions and their
 * explanations are all preserved — the club simply stops being told to turn up
 * to them. Once withdrawn it can be discarded like any other non-published
 * version, so "remove this entirely" is withdraw then discard, in that order,
 * with the destructive step explicit.
 */
export async function withdrawSchedule(
  context: AuthContext,
  versionId: string,
): Promise<void> {
  // Withdrawing changes what the whole club sees, so it takes the same
  // permission as publishing rather than the weaker review permission.
  assertPermission(context, "schedule.publish");

  const { data: version } = await context.db
    .from("schedule_versions")
    .select("status, version_number")
    .eq("tenant_id", context.tenant.id)
    .eq("id", versionId)
    .maybeSingle();

  if (!version) throw new NotFoundError("schedule");
  if (version.status !== "PUBLISHED") {
    throw new ConflictError("That schedule isn't published, so there is nothing to withdraw.");
  }

  /*
    `select()` on the update is not decoration. Row-level security filters an
    UPDATE rather than rejecting it, so a caller the policy excludes gets zero
    rows and no error — without checking what came back, this would report
    success while the schedule stayed published.
  */
  const { data: updated, error } = await context.db
    .from("schedule_versions")
    .update({ status: "ARCHIVED", archived_at: new Date().toISOString() })
    .eq("tenant_id", context.tenant.id)
    .eq("id", versionId)
    .select("id");

  if (error) throw fromDatabaseError(error, { resource: "schedule" });
  if (!updated?.length) throw new AuthorizationError(
      errorMessages.cannotChangeSchedule,
    );

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_WITHDRAWN,
    resourceType: "schedule_version",
    resourceId: versionId,
    oldValue: { status: "PUBLISHED" },
    newValue: { status: "ARCHIVED" },
  });
}

/**
 * Cancels one training session.
 *
 * The everyday case: a coach is ill, a hall floods, one week is off. The
 * session stays on the calendar struck through, because people were told to
 * attend it and silently removing it is how someone turns up to a locked door.
 */
export async function cancelScheduleEntry(
  context: AuthContext,
  entryId: string,
  reason: string | null,
): Promise<void> {
  assertPermission(context, "schedule.review");

  const { data: entry } = await context.db
    .from("schedule_entries")
    .select("id, start_at, status")
    .eq("tenant_id", context.tenant.id)
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) throw new NotFoundError("training session");

  const { data: updated, error } = await context.db
    .from("schedule_entries")
    .update({ status: "CANCELLED", updated_by: context.user.id })
    .eq("tenant_id", context.tenant.id)
    .eq("id", entryId)
    .select("id");

  if (error) throw fromDatabaseError(error, { resource: "training session" });
  if (!updated?.length) throw new AuthorizationError(
      errorMessages.cannotChangeSchedule,
    );

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_ENTRY_CANCELLED,
    resourceType: "schedule_entry",
    resourceId: entryId,
    oldValue: { status: entry.status },
    newValue: { status: "CANCELLED" },
    reason,
  });
}

/** Puts a cancelled session back. */
export async function restoreScheduleEntry(
  context: AuthContext,
  entryId: string,
): Promise<void> {
  assertPermission(context, "schedule.review");

  const { data: updated, error } = await context.db
    .from("schedule_entries")
    .update({ status: "SCHEDULED", updated_by: context.user.id })
    .eq("tenant_id", context.tenant.id)
    .eq("id", entryId)
    .eq("status", "CANCELLED")
    .select("id");

  if (error) {
    throw fromDatabaseError(error, {
      resource: "training session",
      // The exclusion constraints still apply: the slot may have been reused.
      exclusionMessage:
        "Something else has been booked in that slot since. Move it first, then restore this session.",
    });
  }

  // Either the session was never cancelled, or RLS filtered the row out.
  if (!updated?.length) throw new NotFoundError("cancelled training session");

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_ENTRY_RESTORED,
    resourceType: "schedule_entry",
    resourceId: entryId,
    newValue: { status: "SCHEDULED" },
  });
}


/**
 * Cancels a whole recurring slot — the "event" rather than the session.
 *
 * Forward-looking by design: it calls off this occurrence and every later one,
 * and leaves the weeks already trained alone. Cancelling a Tuesday slot in
 * March should not rewrite what happened in October, and a coach checking last
 * month's calendar should still see what actually ran.
 */
export async function cancelScheduleSeries(
  context: AuthContext,
  entryId: string,
  reason: string | null,
): Promise<number> {
  assertPermission(context, "schedule.review");

  const { data: entry } = await context.db
    .from("schedule_entries")
    .select("series_id, start_at")
    .eq("tenant_id", context.tenant.id)
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) throw new NotFoundError("training session");

  const { data: updated, error } = await context.db
    .from("schedule_entries")
    .update({ status: "CANCELLED", updated_by: context.user.id })
    .eq("tenant_id", context.tenant.id)
    .eq("series_id", entry.series_id)
    .gte("start_at", entry.start_at)
    .neq("status", "CANCELLED")
    .select("id");

  if (error) throw fromDatabaseError(error, { resource: "training session" });
  if (!updated?.length) throw new AuthorizationError(errorMessages.cannotChangeSchedule);

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_SERIES_CANCELLED,
    resourceType: "schedule_entry",
    resourceId: entryId,
    newValue: { seriesId: entry.series_id, from: entry.start_at, cancelled: updated.length },
    reason,
  });

  return updated.length;
}

/** Puts the remaining occurrences of a series back. */
export async function restoreScheduleSeries(
  context: AuthContext,
  entryId: string,
): Promise<number> {
  assertPermission(context, "schedule.review");

  const { data: entry } = await context.db
    .from("schedule_entries")
    .select("series_id, start_at")
    .eq("tenant_id", context.tenant.id)
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) throw new NotFoundError("training session");

  const { data: updated, error } = await context.db
    .from("schedule_entries")
    .update({ status: "SCHEDULED", updated_by: context.user.id })
    .eq("tenant_id", context.tenant.id)
    .eq("series_id", entry.series_id)
    .gte("start_at", entry.start_at)
    .eq("status", "CANCELLED")
    .select("id");

  if (error) {
    throw fromDatabaseError(error, {
      resource: "training session",
      exclusionMessage:
        "Something else has been booked into one of those slots since. Move it first, then restore the series.",
    });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_SERIES_RESTORED,
    resourceType: "schedule_entry",
    resourceId: entryId,
    newValue: { seriesId: entry.series_id, restored: updated?.length ?? 0 },
  });

  return updated?.length ?? 0;
}
