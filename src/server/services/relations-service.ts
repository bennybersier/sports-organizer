import "server-only";

import type { AuthContext } from "@/server/auth/context";
import { hasPermission } from "@/server/auth/authorization";
import type { EntityStatus, MembershipState } from "@/types/database";

/**
 * The links between a club's records, read for one record at a time.
 *
 * A detail page answers "who and what does this touch?" — a team's coaches and
 * squad, a trainer's teams and the athletes they see, the halls a session
 * actually lands in. The list pages already carry counts; these functions carry
 * the names behind them.
 *
 * Two rules run through the whole file:
 *
 *  - Permissions are checked with `hasPermission`, not asserted. A team manager
 *    who cannot read trainers still gets the squad rather than an error page;
 *    the section they may not see simply isn't there.
 *  - Every relation is fetched by key and stitched in memory rather than looped
 *    over per row. A page is a fixed handful of queries, not one per athlete.
 */

export interface RelatedTeam {
  id: string;
  name: string;
  color: string;
  sport: string;
  ageGroup: string | null;
  status: EntityStatus;
  /** Why this team is related — how many sessions it has in the hall, say. */
  sessions?: number;
}

export interface RelatedTrainer {
  id: string;
  name: string;
  email: string | null;
  color: string | null;
  status: EntityStatus;
  isHeadCoach?: boolean;
  /** The teams through which this trainer reaches the record being viewed. */
  via?: string[];
  sessions?: number;
}

export interface RelatedAthlete {
  id: string;
  name: string;
  membershipStatus: MembershipState;
  status: EntityStatus;
  jerseyNumber?: number | null;
  position?: string | null;
  via?: string[];
}

export interface RelatedGym {
  id: string;
  name: string;
  city: string | null;
  status: EntityStatus;
  /** Set when the team's requirements name this hall. */
  allowed?: boolean;
  preferred?: boolean;
  sessions?: number;
}

/* -------------------------------------------------------------------------- */
/* Shared readers                                                             */
/* -------------------------------------------------------------------------- */

const fullName = (row: { first_name: string; last_name: string }) =>
  `${row.first_name} ${row.last_name}`;

/** Current squad links for a set of teams. */
async function athleteLinks(context: AuthContext, teamIds: string[]) {
  if (teamIds.length === 0) return [];
  const { data } = await context.db
    .from("athlete_teams")
    .select("athlete_id, team_id, jersey_number, position")
    .eq("tenant_id", context.tenant.id)
    .in("team_id", teamIds)
    .is("left_at", null);
  return data ?? [];
}

/** Current coaching links for a set of teams. */
async function trainerLinks(context: AuthContext, teamIds: string[]) {
  if (teamIds.length === 0) return [];
  const { data } = await context.db
    .from("trainer_teams")
    .select("trainer_id, team_id, is_head_coach")
    .eq("tenant_id", context.tenant.id)
    .in("team_id", teamIds)
    .is("unassigned_at", null);
  return data ?? [];
}

async function fetchTeams(context: AuthContext, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await context.db
    .from("teams")
    .select("id, name, color, sport, age_group, status")
    .eq("tenant_id", context.tenant.id)
    .in("id", ids)
    .is("deleted_at", null)
    .order("name");
  return data ?? [];
}

async function fetchTrainers(context: AuthContext, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await context.db
    .from("trainers")
    .select("id, first_name, last_name, email, color, status")
    .eq("tenant_id", context.tenant.id)
    .in("id", ids)
    .is("deleted_at", null)
    .order("last_name")
    .order("first_name");
  return data ?? [];
}

async function fetchAthletes(context: AuthContext, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await context.db
    .from("athletes")
    .select("id, first_name, last_name, membership_status, status")
    .eq("tenant_id", context.tenant.id)
    .in("id", ids)
    .is("deleted_at", null)
    .order("last_name")
    .order("first_name");
  return data ?? [];
}

async function fetchGyms(context: AuthContext, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await context.db
    .from("gyms")
    .select("id, name, city, status")
    .eq("tenant_id", context.tenant.id)
    .in("id", ids)
    .is("deleted_at", null)
    .order("name");
  return data ?? [];
}

/**
 * Sessions in the published schedule, narrowed to one team, trainer or gym.
 *
 * Only the published version counts: a draft in the organizer is a proposal,
 * and showing "this team trains here" from one would be a promise the club has
 * not made yet.
 */
async function publishedEntries(
  context: AuthContext,
  filter: { teamId?: string; trainerId?: string; gymId?: string },
) {
  const { data: published } = await context.db
    .from("schedule_versions")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PUBLISHED")
    .limit(1)
    .maybeSingle();

  if (!published) return [];

  let query = context.db
    .from("schedule_entries")
    .select("team_id, trainer_id, gym_id")
    .eq("tenant_id", context.tenant.id)
    .eq("schedule_version_id", published.id)
    .neq("status", "CANCELLED");

  if (filter.teamId) query = query.eq("team_id", filter.teamId);
  if (filter.trainerId) query = query.eq("trainer_id", filter.trainerId);
  if (filter.gymId) query = query.eq("gym_id", filter.gymId);

  const { data } = await query;
  return data ?? [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Teams whose requirements name a hall.
 *
 * PostgREST's `or=(...)` grammar has no placeholders, so the id is spliced into
 * the filter string — and braces and commas are structural in it. The id comes
 * from a URL, so it is checked against the UUID shape first rather than
 * trusted; anything else matches nothing.
 */
async function teamsEligibleForGym(context: AuthContext, gymId: string) {
  if (!UUID.test(gymId)) return [];

  const { data } = await context.db
    .from("team_training_requirements")
    .select("team_id")
    .eq("tenant_id", context.tenant.id)
    .or(`allowed_gym_ids.cs.{${gymId}},preferred_gym_ids.cs.{${gymId}}`);

  return data ?? [];
}

/** Counts non-null values of one column across a set of rows. */
function countBy<K extends string>(rows: Record<K, string | null>[], key: K) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Team                                                                       */
/* -------------------------------------------------------------------------- */

export interface TeamRelations {
  trainers: RelatedTrainer[];
  athletes: RelatedAthlete[];
  gyms: RelatedGym[];
}

/**
 * A team's coaches, squad and halls.
 *
 * The halls are the union of two different truths: the ones the requirements
 * allow or prefer, and the ones the published schedule actually books. They
 * disagree more often than you would like — a hall dropped from the allowed
 * list after a schedule was published still holds sessions — and seeing both on
 * one card is precisely what makes that visible.
 */
export async function getTeamRelations(
  context: AuthContext,
  teamId: string,
  requirement: { allowedGymIds: string[]; preferredGymIds: string[] },
): Promise<TeamRelations> {
  const canReadTrainers = hasPermission(context, "trainers.read");
  const canReadAthletes = hasPermission(context, "athletes.read");
  const canReadGyms = hasPermission(context, "gyms.read");
  const canReadCalendar = hasPermission(context, "calendar.read");

  const [coaching, squad, entries] = await Promise.all([
    canReadTrainers ? trainerLinks(context, [teamId]) : Promise.resolve([]),
    canReadAthletes ? athleteLinks(context, [teamId]) : Promise.resolve([]),
    canReadGyms && canReadCalendar
      ? publishedEntries(context, { teamId })
      : Promise.resolve([]),
  ]);

  const gymSessions = countBy(entries, "gym_id");
  const gymIds = canReadGyms
    ? [
        ...new Set([
          ...requirement.allowedGymIds,
          ...requirement.preferredGymIds,
          ...gymSessions.keys(),
        ]),
      ]
    : [];

  const [trainers, athletes, gyms] = await Promise.all([
    fetchTrainers(context, coaching.map((link) => link.trainer_id)),
    fetchAthletes(context, squad.map((link) => link.athlete_id)),
    fetchGyms(context, gymIds),
  ]);

  const headCoaches = new Set(
    coaching.filter((link) => link.is_head_coach).map((link) => link.trainer_id),
  );
  const squadById = new Map(squad.map((link) => [link.athlete_id, link]));
  const allowed = new Set(requirement.allowedGymIds);
  const preferred = new Set(requirement.preferredGymIds);

  return {
    trainers: trainers.map((trainer) => ({
      id: trainer.id,
      name: fullName(trainer),
      email: trainer.email,
      color: trainer.color,
      status: trainer.status,
      isHeadCoach: headCoaches.has(trainer.id),
    })),
    athletes: athletes.map((athlete) => ({
      id: athlete.id,
      name: fullName(athlete),
      membershipStatus: athlete.membership_status,
      status: athlete.status,
      jerseyNumber: squadById.get(athlete.id)?.jersey_number ?? null,
      position: squadById.get(athlete.id)?.position ?? null,
    })),
    gyms: gyms.map((gym) => ({
      id: gym.id,
      name: gym.name,
      city: gym.city,
      status: gym.status,
      allowed: allowed.has(gym.id),
      preferred: preferred.has(gym.id),
      sessions: gymSessions.get(gym.id) ?? 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Trainer                                                                    */
/* -------------------------------------------------------------------------- */

export interface TrainerRelations {
  teams: RelatedTeam[];
  athletes: RelatedAthlete[];
  gyms: RelatedGym[];
}

/**
 * A trainer's teams, the athletes they coach, and the halls they work in.
 *
 * Athletes reach a trainer only through a team, so each one carries the squads
 * that put them there — someone who appears twice is in two of this trainer's
 * teams, not listed twice by accident.
 */
export async function getTrainerRelations(
  context: AuthContext,
  trainerId: string,
): Promise<TrainerRelations> {
  const canReadTeams = hasPermission(context, "teams.read");
  const canReadAthletes = hasPermission(context, "athletes.read");
  const canReadGyms = hasPermission(context, "gyms.read");
  const canReadCalendar = hasPermission(context, "calendar.read");

  const { data: assignments } = await context.db
    .from("trainer_teams")
    .select("team_id")
    .eq("tenant_id", context.tenant.id)
    .eq("trainer_id", trainerId)
    .is("unassigned_at", null);

  const teamIds = (assignments ?? []).map((row) => row.team_id);

  const [teams, squad, entries] = await Promise.all([
    canReadTeams ? fetchTeams(context, teamIds) : Promise.resolve([]),
    canReadAthletes ? athleteLinks(context, teamIds) : Promise.resolve([]),
    canReadGyms && canReadCalendar
      ? publishedEntries(context, { trainerId })
      : Promise.resolve([]),
  ]);

  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const athletes = await fetchAthletes(context, [
    ...new Set(squad.map((link) => link.athlete_id)),
  ]);

  const viaByAthlete = new Map<string, string[]>();
  for (const link of squad) {
    const name = teamNames.get(link.team_id);
    if (!name) continue;
    viaByAthlete.set(link.athlete_id, [...(viaByAthlete.get(link.athlete_id) ?? []), name]);
  }

  const gymSessions = countBy(entries, "gym_id");
  const teamSessions = countBy(entries, "team_id");
  const gyms = await fetchGyms(context, [...gymSessions.keys()]);

  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      sport: team.sport,
      ageGroup: team.age_group,
      status: team.status,
      sessions: teamSessions.get(team.id) ?? 0,
    })),
    athletes: athletes.map((athlete) => ({
      id: athlete.id,
      name: fullName(athlete),
      membershipStatus: athlete.membership_status,
      status: athlete.status,
      via: viaByAthlete.get(athlete.id) ?? [],
    })),
    gyms: gyms.map((gym) => ({
      id: gym.id,
      name: gym.name,
      city: gym.city,
      status: gym.status,
      sessions: gymSessions.get(gym.id) ?? 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Gym                                                                        */
/* -------------------------------------------------------------------------- */

export interface GymRelations {
  teams: RelatedTeam[];
  trainers: RelatedTrainer[];
}

/**
 * Who uses a hall.
 *
 * Teams arrive two ways — booked here by the published schedule, or merely
 * allowed to be — and both belong on the page: the first says what happens, the
 * second says what the optimizer may do next time. Trainers follow from those
 * teams, plus anyone the schedule puts here directly.
 */
export async function getGymRelations(
  context: AuthContext,
  gymId: string,
): Promise<GymRelations> {
  const canReadTeams = hasPermission(context, "teams.read");
  const canReadTrainers = hasPermission(context, "trainers.read");
  const canReadCalendar = hasPermission(context, "calendar.read");

  const [entries, requirements] = await Promise.all([
    canReadCalendar ? publishedEntries(context, { gymId }) : Promise.resolve([]),
    canReadTeams ? teamsEligibleForGym(context, gymId) : Promise.resolve([]),
  ]);

  const teamSessions = countBy(entries, "team_id");
  const eligible = new Set(requirements.map((row) => row.team_id));
  const teamIds = canReadTeams
    ? [...new Set([...teamSessions.keys(), ...eligible])]
    : [];

  const [teams, coaching] = await Promise.all([
    fetchTeams(context, teamIds),
    canReadTrainers ? trainerLinks(context, teamIds) : Promise.resolve([]),
  ]);

  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const trainerSessions = countBy(entries, "trainer_id");
  const trainerIds = canReadTrainers
    ? [...new Set([...coaching.map((link) => link.trainer_id), ...trainerSessions.keys()])]
    : [];
  const trainers = await fetchTrainers(context, trainerIds);

  const viaByTrainer = new Map<string, string[]>();
  for (const link of coaching) {
    const name = teamNames.get(link.team_id);
    if (!name) continue;
    viaByTrainer.set(link.trainer_id, [...(viaByTrainer.get(link.trainer_id) ?? []), name]);
  }

  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      sport: team.sport,
      ageGroup: team.age_group,
      status: team.status,
      sessions: teamSessions.get(team.id) ?? 0,
    })),
    trainers: trainers.map((trainer) => ({
      id: trainer.id,
      name: fullName(trainer),
      email: trainer.email,
      color: trainer.color,
      status: trainer.status,
      via: viaByTrainer.get(trainer.id) ?? [],
      sessions: trainerSessions.get(trainer.id) ?? 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Athlete                                                                    */
/* -------------------------------------------------------------------------- */

export interface AthleteRelations {
  teams: RelatedTeam[];
  trainers: RelatedTrainer[];
}

/** An athlete's squads, and the coaches those squads put in front of them. */
export async function getAthleteRelations(
  context: AuthContext,
  athleteId: string,
): Promise<AthleteRelations> {
  const canReadTeams = hasPermission(context, "teams.read");
  const canReadTrainers = hasPermission(context, "trainers.read");

  const { data: memberships } = await context.db
    .from("athlete_teams")
    .select("team_id, jersey_number, position")
    .eq("tenant_id", context.tenant.id)
    .eq("athlete_id", athleteId)
    .is("left_at", null);

  const teamIds = (memberships ?? []).map((row) => row.team_id);
  const teams = canReadTeams ? await fetchTeams(context, teamIds) : [];

  const coaching = canReadTrainers ? await trainerLinks(context, teamIds) : [];
  const trainers = await fetchTrainers(context, [
    ...new Set(coaching.map((link) => link.trainer_id)),
  ]);

  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const viaByTrainer = new Map<string, string[]>();
  for (const link of coaching) {
    const name = teamNames.get(link.team_id);
    if (!name) continue;
    viaByTrainer.set(link.trainer_id, [...(viaByTrainer.get(link.trainer_id) ?? []), name]);
  }
  const headCoaches = new Set(
    coaching.filter((link) => link.is_head_coach).map((link) => link.trainer_id),
  );

  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      sport: team.sport,
      ageGroup: team.age_group,
      status: team.status,
    })),
    trainers: trainers.map((trainer) => ({
      id: trainer.id,
      name: fullName(trainer),
      email: trainer.email,
      color: trainer.color,
      status: trainer.status,
      isHeadCoach: headCoaches.has(trainer.id),
      via: viaByTrainer.get(trainer.id) ?? [],
    })),
  };
}
