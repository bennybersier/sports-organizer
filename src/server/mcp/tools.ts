import "server-only";

import { isAppError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import type { Permission } from "@/domain/permissions";
import { parseListParams, DEFAULT_PAGE_SIZE } from "@/server/services/list-query";
import { listSeasons, listSeasonOptions } from "@/server/services/season-service";
import { listTeams, getTeam } from "@/server/services/team-service";
import { listAthletes } from "@/server/services/athlete-service";
import { listTrainers } from "@/server/services/trainer-service";
import { listGyms } from "@/server/services/gym-service";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { listCalendarItems, checkPlacement } from "@/server/services/calendar-service";
import { getTrainingRequirement } from "@/server/services/training-requirement-service";
import { generateAndStore } from "@/server/services/schedule-generation-service";
import { publishScheduleVersion } from "@/server/services/schedule-publish-service";
import { addDays, todayInZone } from "@/domain/scheduling/timezone";

/**
 * MCP tools.
 *
 * Every tool is a thin shell over a service the web UI already calls. That is
 * the point: the spec's final principle is that the UI, the API, AI and MCP are
 * different interfaces to one secure domain, and the way to keep that true is
 * for MCP to own no business logic at all. If a rule changes in a service, it
 * changes for MCP in the same commit.
 *
 * Each tool declares the permission it needs. The check is not decoration —
 * `assertPermission` runs against the intersected scope set from `auth.ts`, so
 * a key scoped to reading cannot publish a schedule even if its owner could.
 */

export interface McpTool {
  name: string;
  title: string;
  description: string;
  /** JSON Schema for the arguments, as MCP clients expect. */
  inputSchema: Record<string, unknown>;
  permission: Permission;
  /** Sensitive operations are refused unless the key opted into them. */
  requiresExplicitScope?: boolean;
  handler: (context: AuthContext, args: Record<string, unknown>) => Promise<unknown>;
}

const pagination = {
  page: { type: "number", description: "1-based page number.", minimum: 1 },
  pageSize: { type: "number", description: `Rows per page (default ${DEFAULT_PAGE_SIZE}).`, minimum: 1, maximum: 100 },
  search: { type: "string", description: "Free-text search." },
};

const listArgs = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: { ...pagination, ...extra },
  additionalProperties: false,
});

/** Normalises MCP arguments into the shape `parseListParams` expects. */
function toListParams(args: Record<string, unknown>) {
  return parseListParams({
    q: typeof args.search === "string" ? args.search : undefined,
    page: args.page === undefined ? undefined : String(args.page),
    pageSize: args.pageSize === undefined ? undefined : String(args.pageSize),
  });
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_seasons",
    title: "List seasons",
    description: "Seasons in the club, newest first, with team counts.",
    inputSchema: listArgs({ status: { type: "string", enum: ["DRAFT", "ACTIVE", "ARCHIVED"] } }),
    permission: "seasons.read",
    handler: async (context, args) => {
      const result = await listSeasons(context, toListParams(args), { status: str(args.status) });
      return {
        total: result.total,
        seasons: result.rows.map((season) => ({
          id: season.id,
          name: season.name,
          status: season.status,
          startDate: season.start_date,
          endDate: season.end_date,
          teams: season.team_count,
        })),
      };
    },
  },

  {
    name: "list_teams",
    title: "List teams",
    description: "Teams, optionally filtered by season or sport, with squad and staff counts.",
    inputSchema: listArgs({
      seasonId: { type: "string", description: "Restrict to one season." },
      sport: { type: "string" },
    }),
    permission: "teams.read",
    handler: async (context, args) => {
      const result = await listTeams(context, toListParams(args), {
        seasonId: str(args.seasonId),
        sport: str(args.sport),
      });
      return {
        total: result.total,
        teams: result.rows.map((team) => ({
          id: team.id,
          name: team.name,
          sport: team.sport,
          ageGroup: team.age_group,
          season: team.season_name,
          athletes: team.athlete_count,
          trainers: team.trainer_count,
          status: team.status,
        })),
      };
    },
  },

  {
    name: "get_team",
    title: "Get a team",
    description: "One team with its training requirements — what the scheduler must satisfy.",
    inputSchema: {
      type: "object",
      properties: { teamId: { type: "string" } },
      required: ["teamId"],
      additionalProperties: false,
    },
    permission: "teams.read",
    handler: async (context, args) => {
      const team = await getTeam(context, String(args.teamId));
      const requirement = await getTrainingRequirement(context, team.id, team.season_id);
      return {
        id: team.id,
        name: team.name,
        sport: team.sport,
        category: team.category,
        ageGroup: team.age_group,
        gender: team.gender,
        status: team.status,
        requirements: {
          sessionsPerWeek: requirement.sessionsPerWeek,
          durationMinutes: requirement.durationMinutes,
          allowedWeekdays: requirement.allowedWeekdays,
          earliestStart: requirement.earliestStart,
          latestEnd: requirement.latestEnd,
          minDaysBetween: requirement.minDaysBetween,
          preferredWeekdays: requirement.preferredWeekdays,
        },
      };
    },
  },

  {
    name: "list_athletes",
    title: "List athletes",
    description: "Athletes, optionally filtered by team, with their current squads.",
    inputSchema: listArgs({ teamId: { type: "string" } }),
    permission: "athletes.read",
    handler: async (context, args) => {
      const result = await listAthletes(context, toListParams(args), { teamId: str(args.teamId) });
      return {
        total: result.total,
        athletes: result.rows.map((athlete) => ({
          id: athlete.id,
          name: `${athlete.first_name} ${athlete.last_name}`,
          membershipStatus: athlete.membership_status,
          teams: athlete.teams.map((team) => team.name),
        })),
      };
    },
  },

  {
    name: "list_trainers",
    title: "List trainers",
    description: "Coaching staff and how many teams each covers.",
    inputSchema: listArgs(),
    permission: "trainers.read",
    handler: async (context, args) => {
      const result = await listTrainers(context, toListParams(args));
      return {
        total: result.total,
        trainers: result.rows.map((trainer) => ({
          id: trainer.id,
          name: `${trainer.first_name} ${trainer.last_name}`,
          qualifications: trainer.qualifications,
          teams: trainer.team_count,
          status: trainer.status,
        })),
      };
    },
  },

  {
    name: "list_gyms",
    title: "List gyms",
    description: "Training locations, their capacity and which sports they host.",
    inputSchema: listArgs(),
    permission: "gyms.read",
    handler: async (context, args) => {
      const result = await listGyms(context, toListParams(args));
      return {
        total: result.total,
        gyms: result.rows.map((gym) => ({
          id: gym.id,
          name: gym.name,
          city: gym.city,
          capacity: gym.capacity,
          sports: gym.sport_types,
          status: gym.status,
        })),
      };
    },
  },

  {
    name: "get_availability",
    title: "Get availability",
    description:
      "Recurring weekly availability and upcoming exceptions for a gym, trainer or team. " +
      "Weekdays are ISO-8601 (1 = Monday). Times are wall-clock in the club's timezone.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", enum: ["gym", "trainer", "team"] },
        ownerId: { type: "string", description: "The gym, trainer or team id." },
      },
      required: ["domain", "ownerId"],
      additionalProperties: false,
    },
    permission: "availability.read",
    handler: async (context, args) => {
      const domain = args.domain as "gym" | "trainer" | "team";
      const ownerId = String(args.ownerId);
      const today = todayInZone(context.tenant.timezone);

      const [windows, exceptions] = await Promise.all([
        listAvailability(context, domain, ownerId),
        listExceptions(context, domain, ownerId, { from: today }),
      ]);

      return {
        timezone: context.tenant.timezone,
        weekly: windows.map((window) => ({
          isoWeekday: window.isoWeekday,
          start: window.startTime,
          end: window.endTime,
          validFrom: window.validFrom,
          validUntil: window.validUntil,
        })),
        exceptions: exceptions.map((exception) => ({
          date: exception.exceptionDate,
          type: exception.type,
          start: exception.startTime,
          end: exception.endTime,
          reason: exception.reason,
        })),
      };
    },
  },

  {
    name: "get_calendar",
    title: "Get the calendar",
    description:
      "Training and events between two dates. Dates are club-local (YYYY-MM-DD); " +
      "defaults to the next 7 days.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, YYYY-MM-DD." },
        to: { type: "string", description: "End date, YYYY-MM-DD." },
        teamId: { type: "string" },
        trainerId: { type: "string" },
        gymId: { type: "string" },
      },
      additionalProperties: false,
    },
    permission: "calendar.read",
    handler: async (context, args) => {
      const today = todayInZone(context.tenant.timezone);
      const from = str(args.from) ?? today;
      const to = str(args.to) ?? addDays(from, 6);

      const items = await listCalendarItems(context, from, to, {
        teamId: str(args.teamId),
        trainerId: str(args.trainerId),
        gymId: str(args.gymId),
      });

      return {
        from,
        to,
        timezone: context.tenant.timezone,
        items: items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          startAt: item.startAt,
          endAt: item.endAt,
          team: item.teamName,
          trainer: item.trainerName,
          gym: item.gymName,
          status: item.status,
          validation: item.validationState,
        })),
      };
    },
  },

  {
    name: "check_placement",
    title: "Check a proposed session",
    description:
      "Validates a proposed training slot against availability, existing bookings and the " +
      "team's rules. Returns structured findings — this is the authoritative check, and it " +
      "changes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string" },
        gymId: { type: "string" },
        trainerId: { type: "string" },
        seasonId: { type: "string" },
        startAt: { type: "string", description: "ISO-8601 instant." },
        endAt: { type: "string", description: "ISO-8601 instant." },
      },
      required: ["teamId", "gymId", "seasonId", "startAt", "endAt"],
      additionalProperties: false,
    },
    permission: "calendar.read",
    handler: async (context, args) => {
      const result = await checkPlacement(context, {
        teamId: String(args.teamId),
        gymId: String(args.gymId),
        trainerId: str(args.trainerId) ?? null,
        seasonId: String(args.seasonId),
        startAt: String(args.startAt),
        endAt: String(args.endAt),
      });
      return { severity: result.severity, findings: result.findings };
    },
  },

  {
    name: "generate_schedule",
    title: "Generate a schedule",
    description:
      "Runs the deterministic scheduling engine and stores the result as a new DRAFT " +
      "version. Never touches the published schedule. Returns the score, what was placed, " +
      "and why anything unmet could not be.",
    inputSchema: {
      type: "object",
      properties: {
        seasonId: { type: "string" },
        name: { type: "string", description: "Label for the draft." },
      },
      required: ["seasonId"],
      additionalProperties: false,
    },
    permission: "schedule.generate",
    requiresExplicitScope: true,
    handler: async (context, args) => {
      const { versionId, result } = await generateAndStore(context, {
        seasonId: String(args.seasonId),
        name: str(args.name),
      });

      return {
        versionId,
        status: "DRAFT",
        score: result.score,
        scheduled: result.stats.sessionsScheduled,
        requested: result.stats.sessionsRequested,
        unmet: result.unmet.map((shortfall) => ({
          team: shortfall.teamName,
          scheduled: shortfall.scheduled,
          requested: shortfall.requested,
          reasons: shortfall.reasons.map((reason) => reason.code),
        })),
        note: "This is a draft. Publishing is a separate, explicitly authorised step.",
      };
    },
  },

  {
    name: "publish_schedule",
    title: "Publish a schedule",
    description:
      "Promotes a draft to the club's live schedule, archiving the previous one. " +
      "Refused if any session is still in conflict.",
    inputSchema: {
      type: "object",
      properties: { versionId: { type: "string" } },
      required: ["versionId"],
      additionalProperties: false,
    },
    permission: "schedule.publish",
    requiresExplicitScope: true,
    handler: async (context, args) => {
      // The same service the web UI uses: authorization in TypeScript, the
      // promotion in one transaction underneath.
      await publishScheduleVersion(context, String(args.versionId));
      return { published: true, versionId: String(args.versionId) };
    },
  },

  {
    name: "list_season_options",
    title: "List season ids",
    description: "Compact season list, for resolving a name to an id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    permission: "seasons.read",
    handler: async (context) => ({ seasons: await listSeasonOptions(context) }),
  },
];

export const TOOLS_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

/**
 * The tools a given key may see.
 *
 * Two independent gates, and both must pass:
 *
 *   1. The *owner* must hold the tool's permission. This is the one that cannot
 *      be argued with — a key never exceeds the person it acts as.
 *   2. The *key's scopes* must allow the tool. An empty scope list means "the
 *      ordinary tools my owner can use"; naming any scope narrows the key to
 *      exactly those tools. Either way, tools marked `requiresExplicitScope`
 *      — generating and publishing schedules — must be named.
 *
 * A tool the key cannot call is not advertised: an agent that can't publish
 * shouldn't be told publishing exists and then refused.
 */
export function toolsFor(context: AuthContext, requestedScopes: string[]): McpTool[] {
  const scoped = requestedScopes.length > 0;

  return MCP_TOOLS.filter((tool) => {
    if (!context.permissions.has(tool.permission)) return false;
    if (scoped) return requestedScopes.includes(tool.permission);
    return !tool.requiresExplicitScope;
  });
}

/** Runs a tool with the permission check the service will make anyway. */
export async function runTool(
  tool: McpTool,
  context: AuthContext,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    assertPermission(context, tool.permission);
    return { ok: true, data: await tool.handler(context, args) };
  } catch (error) {
    // Domain errors carry copy written for humans; anything else is opaque on
    // purpose, exactly as it is in the web UI.
    if (isAppError(error)) return { ok: false, message: error.userMessage };
    console.error(`[mcp] ${tool.name} failed`, error);
    return { ok: false, message: "That operation could not be completed." };
  }
}
