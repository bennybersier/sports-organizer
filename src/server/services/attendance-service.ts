import "server-only";

import { AuthorizationError, ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission, hasPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { registerDay } from "@/domain/attendance/statistics";
import type {
  AbsenceReason,
  AttendanceRecordRow,
  AttendanceRegisterRow,
  AttendanceStateValue,
} from "@/types/database";
import type { SaveRegisterInput, DeclareAbsenceInput } from "@/lib/validation/attendance";

/**
 * Registers: opening them, marking them, and closing them again.
 *
 * Two things shape this file.
 *
 * A register is created lazily — the first time somebody opens the sheet, not
 * when a schedule is published. Materialising thirty teams' sessions up front
 * would mean thousands of empty rows, all of them stale the moment the
 * optimizer runs again, and "which sessions has nobody marked?" becomes a
 * question about rows rather than about the club. Opened on demand, an
 * unmarked session is simply a published entry in the past with no register,
 * which is both cheaper and true.
 *
 * And a whole sheet is saved in one call. Next.js dispatches Server Actions one
 * at a time per client, so sixteen taps firing sixteen actions would queue
 * behind each other — and a coach marking a register in a gym with two bars
 * needs the network touched once, at the end, not once per player.
 */

/**
 * A coach may mark their own teams' sheets, and nobody else's.
 *
 * `attendance.record` says you may mark a register; it does not say whose. RLS
 * cannot make that distinction — there is no member-to-team link in the
 * database, only trainers.user_id — so the narrowing happens here, against the
 * caller's resolved identity. That works the same for a browser session, an MCP
 * key and a background job, which is why it is here rather than in a policy.
 *
 * `attendance.manage` is the club-wide bypass: an organizer fixing a sheet
 * marked wrong three weeks ago is not coaching that team and should not have
 * to be.
 */
async function assertCanRecordForTeam(context: AuthContext, teamId: string): Promise<void> {
  assertPermission(context, "attendance.record");
  if (hasPermission(context, "attendance.manage")) return;

  const { data: trainer } = await context.db
    .from("trainers")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (trainer) {
    const { data: link } = await context.db
      .from("trainer_teams")
      .select("team_id")
      .eq("tenant_id", context.tenant.id)
      .eq("trainer_id", trainer.id)
      .eq("team_id", teamId)
      .maybeSingle();
    if (link) return;
  }

  throw new AuthorizationError("You can only mark registers for the teams you coach.");
}

const CONFLICTS = {
  attendance_registers_entry_uniq: "That session already has a register.",
  attendance_registers_event_uniq: "That fixture already has a team sheet.",
};

export interface RegisterLine {
  athleteId: string;
  name: string;
  jerseyNumber: number | null;
  position: string | null;
  state: AttendanceStateValue;
  reason: AttendanceRecordRow["reason"];
  minutesLate: number | null;
  /** True while this line is what a declared absence assumed, not what was seen. */
  prefilled: boolean;
  calledUp: boolean | null;
  started: boolean | null;
  benchReason: AttendanceRecordRow["bench_reason"];
  note: string | null;
  /** Set when a declared absence covers this date, whether or not it was used. */
  declaredAbsence: { reason: AbsenceReason; note: string | null } | null;
}

export interface RegisterSheet {
  register: AttendanceRegisterRow;
  team: { id: string; name: string; color: string; callUpLimit: number | null; tracksBoxScore: boolean };
  gym: { id: string; name: string } | null;
  /** Set for a match: who we are playing and where. */
  fixture: { opponent: string | null; competition: string | null; isHome: boolean | null } | null;
  lines: RegisterLine[];
  /** Whether the caller may change this sheet as it currently stands. */
  editable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Opening                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Opens the sheet for a scheduled training session, or returns the one already
 * open.
 *
 * Idempotent on purpose: two coaches tapping the same session must not produce
 * two registers, and the unique index means the second insert loses rather than
 * duplicating.
 */
export async function openTrainingRegister(
  context: AuthContext,
  scheduleEntryId: string,
): Promise<string> {
  assertPermission(context, "attendance.record");
  // The team-aware check comes below, once the entry says which team it is.

  const existing = await context.db
    .from("attendance_registers")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("schedule_entry_id", scheduleEntryId)
    .maybeSingle();
  if (existing.data) return existing.data.id;

  const { data: entry, error: entryError } = await context.db
    .from("schedule_entries")
    .select("id, season_id, team_id, gym_id, trainer_id, start_at, end_at, status")
    .eq("tenant_id", context.tenant.id)
    .eq("id", scheduleEntryId)
    .maybeSingle();
  if (entryError) throw fromDatabaseError(entryError, { resource: "schedule" });
  if (!entry) throw new NotFoundError("session");
  await assertCanRecordForTeam(context, entry.team_id);
  if (entry.status === "CANCELLED") {
    throw new ConflictError("That session was cancelled, so there is nobody to mark.");
  }

  const { data, error } = await context.db
    .from("attendance_registers")
    .insert({
      tenant_id: context.tenant.id,
      season_id: entry.season_id,
      team_id: entry.team_id,
      occasion: "TRAINING",
      schedule_entry_id: entry.id,
      gym_id: entry.gym_id,
      trainer_id: entry.trainer_id,
      starts_at: entry.start_at,
      ends_at: entry.end_at,
      created_by: context.user.id,
    })
    .select("id")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "register", conflictMessages: CONFLICTS });

  await seedLines(context, data.id, entry.team_id, entry.start_at, "TRAINING");
  return data.id;
}

/**
 * Opens the team sheet for a fixture.
 *
 * The call-up limit is copied off the team rather than read through it, so that
 * a club changing its policy in March does not retroactively make October's
 * sheets illegal.
 */
export async function openMatchRegister(
  context: AuthContext,
  eventId: string,
  teamId: string,
): Promise<string> {
  assertPermission(context, "attendance.record");

  const existing = await context.db
    .from("attendance_registers")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("event_id", eventId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (existing.data) return existing.data.id;

  const [{ data: event, error: eventError }, { data: team }] = await Promise.all([
    context.db
      .from("calendar_events")
      .select("id, season_id, type, gym_id, start_at, end_at, status")
      .eq("tenant_id", context.tenant.id)
      .eq("id", eventId)
      .maybeSingle(),
    context.db
      .from("teams")
      .select("id, season_id, match_call_up_limit")
      .eq("tenant_id", context.tenant.id)
      .eq("id", teamId)
      .maybeSingle(),
  ]);

  if (eventError) throw fromDatabaseError(eventError, { resource: "event" });
  if (!event) throw new NotFoundError("event");
  if (!team) throw new NotFoundError("team");
  if (event.type !== "MATCH" && event.type !== "TOURNAMENT") {
    throw new ConflictError("Only a match or a tournament has a team sheet.");
  }
  await assertCanRecordForTeam(context, teamId);

  const { data, error } = await context.db
    .from("attendance_registers")
    .insert({
      tenant_id: context.tenant.id,
      season_id: event.season_id ?? team.season_id,
      team_id: teamId,
      occasion: "MATCH",
      event_id: event.id,
      gym_id: event.gym_id,
      starts_at: event.start_at,
      ends_at: event.end_at,
      call_up_limit: team.match_call_up_limit,
      created_by: context.user.id,
    })
    .select("id")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "register", conflictMessages: CONFLICTS });

  await seedLines(context, data.id, teamId, event.start_at, "MATCH");
  return data.id;
}

/**
 * Puts the current squad on a new sheet, pre-filled from declared absences.
 *
 * This is the return on entering an absence at all: the coach opens Tuesday's
 * register and the three they were told about are already marked, flagged as
 * assumed rather than observed so the difference stays visible.
 *
 * Everyone is on the sheet, including — for a match — the players who will not
 * be picked. A report that can only see the twelve who were cannot answer the
 * question the club actually asks.
 */
async function seedLines(
  context: AuthContext,
  registerId: string,
  teamId: string,
  startsAt: string,
  occasion: "TRAINING" | "MATCH",
) {
  const day = registerDay(startsAt, context.tenant.timezone);

  const { data: squad } = await context.db
    .from("athlete_teams")
    .select("athlete_id")
    .eq("tenant_id", context.tenant.id)
    .eq("team_id", teamId)
    .is("left_at", null)
    .lte("joined_at", day);

  const athleteIds = (squad ?? []).map((row) => row.athlete_id);
  if (athleteIds.length === 0) return;

  const declared = await declaredAbsencesOn(context, athleteIds, teamId, day);

  const { error } = await context.db.from("attendance_records").insert(
    athleteIds.map((athleteId) => {
      const absence = declared.get(athleteId);
      return {
        tenant_id: context.tenant.id,
        register_id: registerId,
        athlete_id: athleteId,
        state: (absence ? "EXCUSED" : "PRESENT") as AttendanceStateValue,
        reason: absence?.reason ?? null,
        prefilled: Boolean(absence),
        // A match sheet starts with nobody picked; a coach chooses, and a
        // default of "everyone called" would be a lie the cap then rejects.
        called_up: occasion === "MATCH" ? false : null,
        recorded_by: context.user.id,
      };
    }),
  );
  if (error) throw fromDatabaseError(error, { resource: "register" });
}

/** Declared absences covering a given day, by athlete. */
async function declaredAbsencesOn(
  context: AuthContext,
  athleteIds: string[],
  teamId: string,
  day: string,
) {
  const { data } = await context.db
    .from("athlete_availability_exceptions")
    .select("athlete_id, team_id, reason, note")
    .eq("tenant_id", context.tenant.id)
    .in("athlete_id", athleteIds)
    .lte("starts_on", day)
    .gte("ends_on", day);

  const result = new Map<string, { reason: AttendanceRecordRow["reason"]; note: string | null }>();
  for (const row of data ?? []) {
    // A club-wide absence covers every squad; one pinned to another team does
    // not touch this one.
    if (row.team_id !== null && row.team_id !== teamId) continue;
    result.set(row.athlete_id, { reason: row.reason, note: row.note });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export async function getRegisterSheet(
  context: AuthContext,
  registerId: string,
): Promise<RegisterSheet> {
  assertPermission(context, "attendance.read");

  const { data: register, error } = await context.db
    .from("attendance_registers")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", registerId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "register" });
  if (!register) throw new NotFoundError("register");

  const [{ data: team }, { data: records }, { data: gym }, { data: event }] = await Promise.all([
    context.db
      .from("teams")
      .select("id, name, color, match_call_up_limit, tracks_box_score")
      .eq("id", register.team_id)
      .single(),
    context.db
      .from("attendance_records")
      .select("*")
      .eq("tenant_id", context.tenant.id)
      .eq("register_id", registerId),
    register.gym_id
      ? context.db.from("gyms").select("id, name").eq("id", register.gym_id).maybeSingle()
      : Promise.resolve({ data: null }),
    register.event_id
      ? context.db
          .from("calendar_events")
          .select("opponent, competition, is_home")
          .eq("id", register.event_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const athleteIds = (records ?? []).map((row) => row.athlete_id);
  const [{ data: athletes }, { data: links }] = await Promise.all([
    athleteIds.length
      ? context.db
          .from("athletes")
          .select("id, first_name, last_name")
          .in("id", athleteIds)
      : Promise.resolve({ data: [] }),
    athleteIds.length
      ? context.db
          .from("athlete_teams")
          .select("athlete_id, jersey_number, position")
          .eq("team_id", register.team_id)
          .in("athlete_id", athleteIds)
          .is("left_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  const nameById = new Map(
    (athletes ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]),
  );
  const linkById = new Map((links ?? []).map((l) => [l.athlete_id, l]));
  const declared = await declaredAbsencesOn(
    context,
    athleteIds,
    register.team_id,
    registerDay(register.starts_at, context.tenant.timezone),
  );

  const lines: RegisterLine[] = (records ?? [])
    .map((row) => {
      const absence = declared.get(row.athlete_id);
      return {
        athleteId: row.athlete_id,
        name: nameById.get(row.athlete_id) ?? "—",
        jerseyNumber: linkById.get(row.athlete_id)?.jersey_number ?? null,
        position: linkById.get(row.athlete_id)?.position ?? null,
        state: row.state,
        reason: row.reason,
        minutesLate: row.minutes_late,
        prefilled: row.prefilled,
        calledUp: row.called_up,
        started: row.started,
        benchReason: row.bench_reason,
        note: row.note,
        declaredAbsence: absence ? { reason: absence.reason ?? "OTHER", note: absence.note } : null,
      };
    })
    .sort(byShirtThenName);

  return {
    register,
    team: {
      id: team!.id,
      name: team!.name,
      color: team!.color,
      callUpLimit: register.call_up_limit ?? team!.match_call_up_limit,
      tracksBoxScore: team!.tracks_box_score,
    },
    gym: gym ?? null,
    fixture: event
      ? { opponent: event.opponent, competition: event.competition, isHome: event.is_home }
      : null,
    lines,
    editable:
      register.state !== "RECORDED"
        ? hasPermission(context, "attendance.record")
        : hasPermission(context, "attendance.manage"),
  };
}

/** Numbered shirts in order, then everyone else alphabetically. */
function byShirtThenName(a: RegisterLine, b: RegisterLine) {
  if (a.jerseyNumber !== null && b.jerseyNumber !== null) {
    return a.jerseyNumber - b.jerseyNumber;
  }
  if (a.jerseyNumber !== null) return -1;
  if (b.jerseyNumber !== null) return 1;
  return a.name.localeCompare(b.name);
}

/* -------------------------------------------------------------------------- */
/* Marking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Saves a whole sheet.
 *
 * One call, one transaction's worth of writes, because the coach pressed save
 * once. The call-up cap is enforced here rather than in the database: it is a
 * rule about a sheet as a whole, the database sees one row at a time, and the
 * error a coach needs is "you have picked thirteen, the limit is twelve" rather
 * than a constraint name.
 */
export async function saveRegister(
  context: AuthContext,
  input: SaveRegisterInput,
): Promise<{ registerId: string; marked: number }> {
  assertPermission(context, "attendance.record");

  const { data: register, error } = await context.db
    .from("attendance_registers")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.registerId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "register" });
  if (!register) throw new NotFoundError("register");

  await assertCanRecordForTeam(context, register.team_id);
  if (register.state === "RECORDED") {
    assertPermission(context, "attendance.manage");
  }
  if (register.state === "CANCELLED") {
    throw new ConflictError("That session was cancelled. Reopen it before marking it.");
  }

  const isMatch = register.occasion === "MATCH";

  if (isMatch) {
    const called = input.lines.filter((line) => line.calledUp).length;
    const limit = register.call_up_limit;
    if (limit !== null && called > limit) {
      throw new ConflictError(
        `You have picked ${called} players; this team's sheet holds ${limit}.`,
      );
    }
    const starters = input.lines.filter((line) => line.started).length;
    if (starters > 5) {
      throw new ConflictError(`You have marked ${starters} starters; five start a basketball match.`);
    }
  }

  // One statement for the whole sheet. `upsert` on the natural key rather than
  // update-per-row: a squad member added since the sheet opened gets a line
  // rather than being silently dropped.
  const { error: saveError } = await context.db.from("attendance_records").upsert(
    input.lines.map((line) => ({
      tenant_id: context.tenant.id,
      register_id: register.id,
      athlete_id: line.athleteId,
      state: line.state,
      reason: line.state === "PRESENT" ? null : (line.reason ?? null),
      // Once a human has touched the sheet, nothing on it is an assumption.
      prefilled: false,
      minutes_late: line.state === "LATE" ? (line.minutesLate ?? null) : null,
      called_up: isMatch ? Boolean(line.calledUp) : null,
      started: isMatch ? (line.calledUp ? Boolean(line.started) : null) : null,
      bench_reason: isMatch && line.calledUp ? (line.benchReason ?? null) : null,
      note: line.note ?? null,
      recorded_by: context.user.id,
    })),
    { onConflict: "register_id,athlete_id" },
  );
  if (saveError) throw fromDatabaseError(saveError, { resource: "register" });

  const recorded = input.state === "RECORDED";
  const { error: stateError } = await context.db
    .from("attendance_registers")
    .update({
      state: input.state,
      notes: input.notes ?? register.notes,
      // Kept once set, like a published schedule keeps published_at.
      recorded_at: recorded ? (register.recorded_at ?? new Date().toISOString()) : register.recorded_at,
      recorded_by: recorded ? context.user.id : register.recorded_by,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", register.id);
  if (stateError) throw fromDatabaseError(stateError, { resource: "register" });

  await recordAudit(context, {
    action: recorded ? AUDIT_ACTIONS.REGISTER_RECORDED : AUDIT_ACTIONS.REGISTER_UPDATED,
    resourceType: "attendance_register",
    resourceId: register.id,
    newValue: { occasion: register.occasion, lines: input.lines.length },
  });

  return { registerId: register.id, marked: input.lines.length };
}

/**
 * Marks a session as not having happened.
 *
 * The reason this state exists: without it, snow and a shut hall are
 * indistinguishable from a sheet nobody marked, and every percentage in the
 * club is quietly wrong.
 */
export async function cancelRegister(
  context: AuthContext,
  registerId: string,
  reason: string | null,
): Promise<void> {
  assertPermission(context, "attendance.record");

  const { data: register } = await context.db
    .from("attendance_registers")
    .select("team_id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", registerId)
    .maybeSingle();
  if (!register) throw new NotFoundError("register");
  await assertCanRecordForTeam(context, register.team_id);

  const { error } = await context.db
    .from("attendance_registers")
    .update({ state: "CANCELLED", cancellation_reason: reason })
    .eq("tenant_id", context.tenant.id)
    .eq("id", registerId);
  if (error) throw fromDatabaseError(error, { resource: "register" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.REGISTER_CANCELLED,
    resourceType: "attendance_register",
    resourceId: registerId,
    newValue: { reason },
  });
}

/** Puts a finished sheet back into play. Deliberately the stronger permission. */
export async function reopenRegister(
  context: AuthContext,
  registerId: string,
): Promise<void> {
  assertPermission(context, "attendance.manage");

  const { error } = await context.db
    .from("attendance_registers")
    .update({ state: "OPEN", cancellation_reason: null })
    .eq("tenant_id", context.tenant.id)
    .eq("id", registerId);
  if (error) throw fromDatabaseError(error, { resource: "register" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.REGISTER_REOPENED,
    resourceType: "attendance_register",
    resourceId: registerId,
  });
}

/* -------------------------------------------------------------------------- */
/* Declared absences                                                          */
/* -------------------------------------------------------------------------- */

export async function declareAbsence(
  context: AuthContext,
  input: DeclareAbsenceInput,
): Promise<{ id: string }> {
  assertPermission(context, "attendance.record");

  const { data, error } = await context.db
    .from("athlete_availability_exceptions")
    .insert({
      tenant_id: context.tenant.id,
      athlete_id: input.athleteId,
      team_id: input.teamId ?? null,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      reason: input.reason,
      note: input.note ?? null,
      reported_by: input.reportedBy ?? null,
      created_by: context.user.id,
    })
    .select("id")
    .single();
  if (error) throw fromDatabaseError(error, { resource: "absence" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.ABSENCE_DECLARED,
    resourceType: "athlete_availability_exception",
    resourceId: data.id,
    newValue: { athleteId: input.athleteId, from: input.startsOn, to: input.endsOn },
  });

  return data;
}

export async function deleteAbsence(context: AuthContext, id: string): Promise<void> {
  assertPermission(context, "attendance.record");

  const { error } = await context.db
    .from("athlete_availability_exceptions")
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("id", id);
  if (error) throw fromDatabaseError(error, { resource: "absence" });
}
