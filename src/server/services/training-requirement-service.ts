import "server-only";

import { fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { normalizeTime } from "@/domain/availability";
import type { TrainingRequirementInput } from "@/lib/validation/training-requirement";
import type { IsoWeekday, TeamTrainingRequirementRow } from "@/types/database";

export interface TrainingRequirement {
  id: string | null;
  teamId: string;
  seasonId: string;
  sessionsPerWeek: number;
  durationMinutes: number;
  /** 1 (highest) to 5 (lowest). Decides who gets a contested slot. */
  priority: number;
  /** First date this team trains. Null starts with the schedule. */
  startsOn: string | null;
  allowedWeekdays: number[];
  earliestStart: string;
  latestEnd: string;
  minDaysBetween: number;
  maxDaysBetween: number | null;
  allowedGymIds: string[];
  preferredWeekdays: number[];
  preferredStart: string | null;
  preferredEnd: string | null;
  preferredGymIds: string[];
  notes: string | null;
}

/** What a team gets before anyone configures anything. */
export function defaultRequirement(teamId: string, seasonId: string): TrainingRequirement {
  return {
    id: null,
    teamId,
    seasonId,
    sessionsPerWeek: 2,
    durationMinutes: 90,
    priority: 3,
    startsOn: null,
    allowedWeekdays: [1, 2, 3, 4, 5],
    earliestStart: "16:30",
    latestEnd: "22:00",
    minDaysBetween: 1,
    maxDaysBetween: null,
    allowedGymIds: [],
    preferredWeekdays: [],
    preferredStart: null,
    preferredEnd: null,
    preferredGymIds: [],
    notes: null,
  };
}

function fromRow(row: TeamTrainingRequirementRow): TrainingRequirement {
  return {
    id: row.id,
    teamId: row.team_id,
    seasonId: row.season_id,
    sessionsPerWeek: row.sessions_per_week,
    durationMinutes: row.duration_minutes,
    priority: row.priority,
    startsOn: row.starts_on,
    allowedWeekdays: row.allowed_weekdays,
    earliestStart: normalizeTime(row.earliest_start),
    latestEnd: normalizeTime(row.latest_end),
    minDaysBetween: row.min_days_between,
    maxDaysBetween: row.max_days_between,
    allowedGymIds: row.allowed_gym_ids,
    preferredWeekdays: row.preferred_weekdays,
    preferredStart: row.preferred_start ? normalizeTime(row.preferred_start) : null,
    preferredEnd: row.preferred_end ? normalizeTime(row.preferred_end) : null,
    preferredGymIds: row.preferred_gym_ids,
    notes: row.notes,
  };
}

export async function getTrainingRequirement(
  context: AuthContext,
  teamId: string,
  seasonId: string,
): Promise<TrainingRequirement> {
  assertPermission(context, "teams.read");

  const { data, error } = await context.db
    .from("team_training_requirements")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("team_id", teamId)
    .eq("season_id", seasonId)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "training requirement" });
  return data ? fromRow(data) : defaultRequirement(teamId, seasonId);
}

/**
 * Saves a team's requirements.
 *
 * Upsert on (team, season): a team has exactly one set per season, and the
 * unique index says so. Creating and editing are the same operation from the
 * organizer's point of view, so they are the same operation here.
 */
export async function saveTrainingRequirement(
  context: AuthContext,
  input: TrainingRequirementInput,
): Promise<TrainingRequirement> {
  assertPermission(context, "teams.update");

  const { data, error } = await context.db
    .from("team_training_requirements")
    .upsert(
      {
        tenant_id: context.tenant.id,
        team_id: input.teamId,
        season_id: input.seasonId,
        sessions_per_week: input.sessionsPerWeek,
        duration_minutes: input.durationMinutes,
        priority: input.priority,
        starts_on: input.startsOn,
        allowed_weekdays: input.allowedWeekdays as IsoWeekday[],
        earliest_start: input.earliestStart,
        latest_end: input.latestEnd,
        min_days_between: input.minDaysBetween,
        max_days_between: input.maxDaysBetween,
        allowed_gym_ids: input.allowedGymIds,
        preferred_weekdays: input.preferredWeekdays as IsoWeekday[],
        preferred_start: input.preferredStart,
        preferred_end: input.preferredEnd,
        preferred_gym_ids: input.preferredGymIds,
        notes: input.notes,
        created_by: context.user.id,
      },
      { onConflict: "team_id,season_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw fromDatabaseError(error, {
      resource: "training requirement",
      conflictMessages: {
        ttr_duration_fits: "A session that long doesn't fit inside the allowed hours.",
        ttr_time_window: "The latest end must be after the earliest start.",
        ttr_gap_order: "The maximum gap can't be smaller than the minimum.",
      },
    });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.TRAINING_REQUIREMENTS_CHANGED,
    resourceType: "team_training_requirement",
    resourceId: data.id,
    newValue: {
      team: input.teamId,
      sessions_per_week: input.sessionsPerWeek,
      duration_minutes: input.durationMinutes,
      priority: input.priority,
      starts_on: input.startsOn,
    },
  });

  return fromRow(data);
}

/** Requirements for every team in a season — the optimizer's input, later. */
export async function listTrainingRequirements(
  context: AuthContext,
  seasonId: string,
): Promise<Map<string, TrainingRequirement>> {
  assertPermission(context, "teams.read");

  const { data, error } = await context.db
    .from("team_training_requirements")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("season_id", seasonId);

  if (error) throw fromDatabaseError(error, { resource: "training requirement" });
  return new Map((data ?? []).map((row) => [row.team_id, fromRow(row)]));
}
