import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { checkPlacement } from "@/server/services/calendar-service";
import { isBlocking } from "@/domain/scheduling/conflicts";
import type {
  CreateEventInput,
  MoveEntryInput,
  UpdateEventInput,
} from "@/lib/validation/calendar";
import type { CalendarEventRow } from "@/types/database";

export async function createEvent(
  context: AuthContext,
  input: CreateEventInput,
): Promise<CalendarEventRow> {
  assertPermission(context, "calendar.create");

  // Opponent, home/away and competition only mean anything on a fixture, and
  // the database enforces that. Clearing them here means changing an event's
  // type from MATCH to MEETING cannot leave a stale opponent behind.
  const fixture = input.type === "MATCH" || input.type === "TOURNAMENT";

  const { data, error } = await context.db
    .from("calendar_events")
    .insert({
      tenant_id: context.tenant.id,
      season_id: input.seasonId,
      type: input.type,
      title: input.title,
      description: input.description,
      location: input.location,
      gym_id: input.gymId,
      trainer_id: input.trainerId,
      start_at: input.startAt,
      end_at: input.endAt,
      all_day: input.allDay,
      color: input.color,
      opponent: fixture ? input.opponent : null,
      is_home: fixture ? input.isHome : null,
      competition: fixture ? input.competition : null,
      // An all-day event already holds the whole day, and the database refuses
      // to store a buffer on one.
      buffer_before_minutes: input.allDay ? 0 : input.bufferBeforeMinutes,
      buffer_after_minutes: input.allDay ? 0 : input.bufferAfterMinutes,
      allows_gym_sharing: input.allowsGymSharing,
      blocks_scheduling: input.blocksScheduling,
      created_by: context.user.id,
    })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "event" });

  if (input.teamIds.length > 0) {
    await context.db.from("calendar_event_teams").insert(
      input.teamIds.map((teamId) => ({
        tenant_id: context.tenant.id,
        event_id: data.id,
        team_id: teamId,
      })),
    );
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.CALENDAR_EVENT_CREATED,
    resourceType: "calendar_event",
    resourceId: data.id,
    newValue: { title: data.title, type: data.type, start_at: data.start_at },
  });

  return data;
}

export async function updateEvent(
  context: AuthContext,
  input: UpdateEventInput,
): Promise<CalendarEventRow> {
  assertPermission(context, "calendar.update");

  // Opponent, home/away and competition only mean anything on a fixture, and
  // the database enforces that. Clearing them here means changing an event's
  // type from MATCH to MEETING cannot leave a stale opponent behind.
  const fixture = input.type === "MATCH" || input.type === "TOURNAMENT";

  const { data, error } = await context.db
    .from("calendar_events")
    .update({
      season_id: input.seasonId,
      type: input.type,
      title: input.title,
      description: input.description,
      location: input.location,
      gym_id: input.gymId,
      trainer_id: input.trainerId,
      start_at: input.startAt,
      end_at: input.endAt,
      all_day: input.allDay,
      color: input.color,
      opponent: fixture ? input.opponent : null,
      is_home: fixture ? input.isHome : null,
      competition: fixture ? input.competition : null,
      // An all-day event already holds the whole day, and the database refuses
      // to store a buffer on one.
      buffer_before_minutes: input.allDay ? 0 : input.bufferBeforeMinutes,
      buffer_after_minutes: input.allDay ? 0 : input.bufferAfterMinutes,
      allows_gym_sharing: input.allowsGymSharing,
      blocks_scheduling: input.blocksScheduling,
      updated_by: context.user.id,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "event" });

  await context.db
    .from("calendar_event_teams")
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("event_id", input.id);

  if (input.teamIds.length > 0) {
    await context.db.from("calendar_event_teams").insert(
      input.teamIds.map((teamId) => ({
        tenant_id: context.tenant.id,
        event_id: input.id,
        team_id: teamId,
      })),
    );
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.CALENDAR_EVENT_UPDATED,
    resourceType: "calendar_event",
    resourceId: input.id,
    newValue: { title: data.title, start_at: data.start_at, end_at: data.end_at },
  });

  return data;
}

export async function cancelEvent(
  context: AuthContext,
  id: string,
  reason: string | null,
): Promise<void> {
  assertPermission(context, "calendar.delete");

  const { error } = await context.db
    .from("calendar_events")
    .update({
      status: "CANCELLED",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
      updated_by: context.user.id,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id);

  if (error) throw fromDatabaseError(error, { resource: "event" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.CALENDAR_EVENT_CANCELLED,
    resourceType: "calendar_event",
    resourceId: id,
    reason,
  });
}

/**
 * Deletes an event outright.
 *
 * Deliberately separate from cancelling, because they mean different things.
 * Cancelling records that something real is not happening — people were told
 * about it, so the record stays. Deleting is for an event that should never
 * have existed: a typo, a duplicate, the wrong date. Keeping those around as
 * struck-through clutter helps nobody.
 *
 * Only `calendar_events` can be deleted this way. Training belongs to a
 * schedule version and is removed by discarding or republishing that version,
 * which keeps the schedule's history coherent.
 */
export async function deleteEvent(context: AuthContext, id: string): Promise<void> {
  assertPermission(context, "calendar.delete");

  const { data: event } = await context.db
    .from("calendar_events")
    .select("title, type, start_at")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .maybeSingle();

  if (!event) throw new NotFoundError("event");

  const { error } = await context.db
    .from("calendar_events")
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("id", id);

  if (error) throw fromDatabaseError(error, { resource: "event" });

  // The event is gone, so the audit entry is the only remaining record of it —
  // which is exactly why it carries what the event was.
  await recordAudit(context, {
    action: AUDIT_ACTIONS.CALENDAR_EVENT_DELETED,
    resourceType: "calendar_event",
    resourceId: id,
    oldValue: { title: event.title, type: event.type, start_at: event.start_at },
  });
}

/** The full event, for the edit form. */
export async function getEvent(context: AuthContext, id: string) {
  assertPermission(context, "calendar.read");

  const { data, error } = await context.db
    .from("calendar_events")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "event" });
  if (!data) throw new NotFoundError("event");

  const { data: teams } = await context.db
    .from("calendar_event_teams")
    .select("team_id")
    .eq("tenant_id", context.tenant.id)
    .eq("event_id", id);

  return { ...data, teamIds: (teams ?? []).map((row) => row.team_id) };
}

/**
 * Moves or resizes something on the calendar.
 *
 * Manual changes are validated but not vetoed on preference grounds: an
 * organizer knows things the optimizer does not, and the spec is explicit that
 * changes must not be blocked merely because the optimizer would have chosen
 * differently. Hard conflicts — a double-booked hall, a session outside opening
 * hours — are refused, and the database's exclusion constraints refuse them
 * again underneath.
 *
 * Every manual move is audited with its before and after, so a schedule that
 * drifts from the generated one can still be explained.
 */
export async function moveCalendarItem(
  context: AuthContext,
  input: MoveEntryInput,
): Promise<{ severity: string; findings: unknown[] }> {
  assertPermission(context, "calendar.update");

  if (input.source === "EVENT") {
    const { data: before } = await context.db
      .from("calendar_events")
      .select("start_at, end_at, gym_id, title")
      .eq("tenant_id", context.tenant.id)
      .eq("id", input.id)
      .maybeSingle();

    if (!before) throw new NotFoundError("event");

    const { error } = await context.db
      .from("calendar_events")
      .update({
        start_at: input.startAt,
        end_at: input.endAt,
        ...(input.gymId ? { gym_id: input.gymId } : {}),
        updated_by: context.user.id,
      })
      .eq("tenant_id", context.tenant.id)
      .eq("id", input.id);

    if (error) throw fromDatabaseError(error, { resource: "event" });

    await recordAudit(context, {
      action: AUDIT_ACTIONS.CALENDAR_EVENT_UPDATED,
      resourceType: "calendar_event",
      resourceId: input.id,
      oldValue: { start_at: before.start_at, end_at: before.end_at },
      newValue: { start_at: input.startAt, end_at: input.endAt },
      reason: input.reason,
    });

    return { severity: "VALID", findings: [] };
  }

  assertPermission(context, "schedule.review");

  const { data: entry } = await context.db
    .from("schedule_entries")
    .select("id, team_id, trainer_id, gym_id, start_at, end_at, season_id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .maybeSingle();

  if (!entry) throw new NotFoundError("training session");

  const gymId = input.gymId ?? entry.gym_id;
  const result = await checkPlacement(context, {
    entryId: entry.id,
    teamId: entry.team_id,
    trainerId: entry.trainer_id,
    gymId,
    startAt: input.startAt,
    endAt: input.endAt,
    seasonId: entry.season_id,
  });

  if (isBlocking(result.severity)) {
    // The findings travel back so the UI can explain exactly what is wrong,
    // rather than a bare refusal.
    throw new ConflictError("That move breaks a hard scheduling rule.", {
      context: { findings: result.findings },
    });
  }

  const { error } = await context.db
    .from("schedule_entries")
    .update({
      start_at: input.startAt,
      end_at: input.endAt,
      gym_id: gymId,
      manually_adjusted: true,
      validation_state: result.severity === "WARNING" ? "WARNING" : "VALID",
      // Structured, not prose: the UI translates the codes, so a schedule
      // reviewed in Italian explains itself in Italian.
      validation_details: JSON.parse(JSON.stringify({ findings: result.findings })),
      updated_by: context.user.id,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id);

  if (error) {
    throw fromDatabaseError(error, {
      resource: "training session",
      exclusionMessage:
        "Something else is already booked there. Move it somewhere free and try again.",
    });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_ENTRY_MOVED,
    resourceType: "schedule_entry",
    resourceId: input.id,
    oldValue: { start_at: entry.start_at, end_at: entry.end_at, gym_id: entry.gym_id },
    newValue: { start_at: input.startAt, end_at: input.endAt, gym_id: gymId },
    reason: input.reason,
    metadata: { severity: result.severity },
  });

  return { severity: result.severity, findings: result.findings };
}
