import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, diffFields, recordAudit } from "@/server/services/audit-service";
import {
  buildListResult,
  paginationRange,
  searchAcross,
  tally,
  type ListParams,
  type ListResult,
} from "@/server/services/list-query";
import type { SeasonRow } from "@/types/database";
import type {
  CreateSeasonInput,
  DuplicateSeasonInput,
  UpdateSeasonInput,
} from "@/lib/validation/season";

export interface SeasonListItem extends SeasonRow {
  team_count: number;
}

const CONFLICTS = {
  seasons_tenant_name_uniq: "A season with that name already exists.",
  seasons_one_active_per_tenant:
    "There is already an active season. Archive it first, or activate this one instead.",
};

export async function listSeasons(
  context: AuthContext,
  params: ListParams,
  filters: { status?: string } = {},
): Promise<ListResult<SeasonListItem>> {
  assertPermission(context, "seasons.read");
  const { from, to } = paginationRange(params);

  let query = context.db
    .from("seasons")
    .select("*", { count: "exact" })
    .eq("tenant_id", context.tenant.id);

  if (params.q) query = query.or(searchAcross(["name", "description"], params.q));
  if (filters.status) query = query.eq("status", filters.status as SeasonRow["status"]);

  // Newest first: the season people are working on is nearly always the latest.
  const { data, error, count } = await query
    .order("start_date", { ascending: false })
    .range(from, to);

  if (error) throw fromDatabaseError(error, { resource: "season" });

  const seasons = data ?? [];
  const teamCounts = await countTeamsBySeason(
    context,
    seasons.map((season) => season.id),
  );

  const rows = seasons.map((season) => ({
    ...season,
    team_count: teamCounts.get(season.id) ?? 0,
  }));

  return buildListResult(rows, count ?? 0, params, Boolean(params.q || filters.status));
}

async function countTeamsBySeason(
  context: AuthContext,
  seasonIds: string[],
): Promise<Map<string, number>> {
  if (seasonIds.length === 0) return new Map();

  const { data } = await context.db
    .from("teams")
    .select("season_id")
    .eq("tenant_id", context.tenant.id)
    .in("season_id", seasonIds)
    .is("deleted_at", null);

  return tally(data ?? [], "season_id");
}

export async function getSeason(context: AuthContext, id: string): Promise<SeasonRow> {
  assertPermission(context, "seasons.read");

  const { data, error } = await context.db
    .from("seasons")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "season" });
  if (!data) throw new NotFoundError("season");
  return data;
}

/** Seasons for pickers — id and name only, no paging. */
export async function listSeasonOptions(context: AuthContext) {
  assertPermission(context, "seasons.read");

  const { data, error } = await context.db
    .from("seasons")
    .select("id, name, status, start_date")
    .eq("tenant_id", context.tenant.id)
    .order("start_date", { ascending: false });

  if (error) throw fromDatabaseError(error, { resource: "season" });
  return data ?? [];
}

export async function createSeason(
  context: AuthContext,
  input: CreateSeasonInput,
): Promise<SeasonRow> {
  assertPermission(context, "seasons.create");

  const { data, error } = await context.db
    .from("seasons")
    .insert({
      tenant_id: context.tenant.id,
      name: input.name,
      start_date: input.startDate,
      end_date: input.endDate,
      description: input.description,
      created_by: context.user.id,
    })
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "season", conflictMessages: CONFLICTS });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SEASON_CREATED,
    resourceType: "season",
    resourceId: data.id,
    newValue: { name: data.name, start_date: data.start_date, end_date: data.end_date },
  });

  return data;
}

export async function updateSeason(
  context: AuthContext,
  input: UpdateSeasonInput,
): Promise<SeasonRow> {
  assertPermission(context, "seasons.update");
  const before = await getSeason(context, input.id);

  if (before.status === "ARCHIVED") {
    throw new ConflictError("Archived seasons can't be edited. Restore it first.");
  }

  const changes = {
    name: input.name,
    start_date: input.startDate,
    end_date: input.endDate,
    description: input.description,
  };

  const { data, error } = await context.db
    .from("seasons")
    .update(changes)
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "season", conflictMessages: CONFLICTS });

  const diff = diffFields(before as unknown as Record<string, unknown>, changes);
  if (diff) {
    await recordAudit(context, {
      action: AUDIT_ACTIONS.SEASON_UPDATED,
      resourceType: "season",
      resourceId: data.id,
      ...diff,
    });
  }

  return data;
}

/**
 * Promotes a season to ACTIVE.
 *
 * A tenant may have only one active season — enforced by a partial unique index
 * — so the current one is archived in the same operation rather than leaving
 * the caller to discover the constraint the hard way.
 */
export async function activateSeason(context: AuthContext, id: string): Promise<SeasonRow> {
  assertPermission(context, "seasons.update");
  const season = await getSeason(context, id);
  if (season.status === "ACTIVE") return season;

  const { error: archiveError } = await context.db
    .from("seasons")
    .update({ status: "ARCHIVED", archived_at: new Date().toISOString() })
    .eq("tenant_id", context.tenant.id)
    .eq("status", "ACTIVE");

  if (archiveError) throw fromDatabaseError(archiveError, { resource: "season" });

  const { data, error } = await context.db
    .from("seasons")
    .update({ status: "ACTIVE", archived_at: null })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "season", conflictMessages: CONFLICTS });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SEASON_UPDATED,
    resourceType: "season",
    resourceId: id,
    oldValue: { status: season.status },
    newValue: { status: "ACTIVE" },
  });

  return data;
}

export async function archiveSeason(context: AuthContext, id: string): Promise<SeasonRow> {
  assertPermission(context, "seasons.archive");
  const season = await getSeason(context, id);

  const { data, error } = await context.db
    .from("seasons")
    .update({ status: "ARCHIVED", archived_at: new Date().toISOString() })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "season" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SEASON_ARCHIVED,
    resourceType: "season",
    resourceId: id,
    oldValue: { status: season.status },
    newValue: { status: "ARCHIVED" },
  });

  return data;
}

/**
 * Copies a season's *configuration* into a new one.
 *
 * Deliberately never copies schedules or past events: last year's Tuesday
 * training is a historical fact, not a starting point. What carries over is the
 * setup an organizer would otherwise retype — teams, who coaches them, which
 * halls they use, and how often they need to train.
 */
/**
 * Strips the columns that must not carry over into a copied row: the primary
 * key and the timestamps, which the database assigns.
 */
function withoutIdentity<T extends Record<string, unknown>>(row: T) {
  const copy = { ...row };
  delete copy.id;
  delete copy.created_at;
  delete copy.updated_at;
  return copy;
}

export async function duplicateSeason(
  context: AuthContext,
  input: DuplicateSeasonInput,
): Promise<{ season: SeasonRow; copied: { teams: number; requirements: number; availability: number; athletes: number } }> {
  assertPermission(context, "seasons.create");
  const source = await getSeason(context, input.sourceSeasonId);

  const season = await createSeason(context, {
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    description: input.description,
  });

  await context.db
    .from("seasons")
    .update({ copied_from_season_id: source.id })
    .eq("id", season.id)
    .eq("tenant_id", context.tenant.id);

  const copied = { teams: 0, requirements: 0, availability: 0, athletes: 0 };
  // Maps a source team id to its copy, so assignments can be re-pointed.
  const teamMap = new Map<string, string>();

  if (input.includeTeams) {
    const { data: sourceTeams, error } = await context.db
      .from("teams")
      .select("*")
      .eq("tenant_id", context.tenant.id)
      .eq("season_id", source.id)
      .is("deleted_at", null);

    if (error) throw fromDatabaseError(error, { resource: "team" });

    for (const team of sourceTeams ?? []) {
      const { data: copy, error: copyError } = await context.db
        .from("teams")
        .insert({
          tenant_id: context.tenant.id,
          season_id: season.id,
          name: team.name,
          sport: team.sport,
          category: team.category,
          age_group: team.age_group,
          gender: team.gender,
          color: team.color,
          notes: team.notes,
          created_by: context.user.id,
        })
        .select("id")
        .single();

      if (copyError) throw fromDatabaseError(copyError, { resource: "team" });
      teamMap.set(team.id, copy.id);
      copied.teams += 1;
    }

    // Training requirements and coaching assignments follow their team.
    for (const [sourceTeamId, newTeamId] of teamMap) {
      const { data: requirement } = await context.db
        .from("team_training_requirements")
        .select("*")
        .eq("team_id", sourceTeamId)
        .eq("season_id", source.id)
        .maybeSingle();

      if (requirement) {
        const { error: reqError } = await context.db
          .from("team_training_requirements")
          .insert({
            ...withoutIdentity(requirement),
            team_id: newTeamId,
            season_id: season.id,
            created_by: context.user.id,
          });
        if (!reqError) copied.requirements += 1;
      }

      const { data: coaches } = await context.db
        .from("trainer_teams")
        .select("trainer_id, is_head_coach")
        .eq("team_id", sourceTeamId)
        .is("unassigned_at", null);

      for (const coach of coaches ?? []) {
        await context.db.from("trainer_teams").insert({
          tenant_id: context.tenant.id,
          team_id: newTeamId,
          trainer_id: coach.trainer_id,
          is_head_coach: coach.is_head_coach,
          created_by: context.user.id,
        });
      }

      if (input.includeAthletes) {
        const { data: squad } = await context.db
          .from("athlete_teams")
          .select("athlete_id, jersey_number, position")
          .eq("team_id", sourceTeamId)
          .is("left_at", null);

        for (const member of squad ?? []) {
          const { error: memberError } = await context.db.from("athlete_teams").insert({
            tenant_id: context.tenant.id,
            team_id: newTeamId,
            athlete_id: member.athlete_id,
            jersey_number: member.jersey_number,
            position: member.position,
            created_by: context.user.id,
          });
          if (!memberError) copied.athletes += 1;
        }
      }
    }
  }

  if (input.includeAvailability) {
    // Season-scoped availability only. Rows with season_id NULL already apply
    // to every season, so copying them would create duplicates.
    for (const table of ["gym_availability", "trainer_availability"] as const) {
      const { data: rows } = await context.db
        .from(table)
        .select("*")
        .eq("tenant_id", context.tenant.id)
        .eq("season_id", source.id);

      for (const row of rows ?? []) {
        const { error } = await context.db
          .from(table)
          .insert({
            ...withoutIdentity(row),
            season_id: season.id,
            created_by: context.user.id,
          });
        if (!error) copied.availability += 1;
      }
    }
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SEASON_DUPLICATED,
    resourceType: "season",
    resourceId: season.id,
    newValue: { name: season.name, copied_from: source.name, ...copied },
  });

  return { season, copied };
}
