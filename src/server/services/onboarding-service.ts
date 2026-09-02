import "server-only";

import type { AuthContext } from "@/server/auth/context";

export interface OnboardingStep {
  key: string;
  done: boolean;
  href: string;
}

/**
 * The setup checklist.
 *
 * Derived from what actually exists rather than from a stored list of ticked
 * boxes: a club that deleted its only gym should see that step reopen, and a
 * checklist that disagrees with reality is worse than none.
 */
export async function getOnboardingSteps(context: AuthContext): Promise<OnboardingStep[]> {
  const tenantId = context.tenant.id;
  const count = async (
    table: "seasons" | "gyms" | "trainers" | "teams" | "gym_availability" | "team_training_requirements" | "schedule_versions",
  ) => {
    const { count: total } = await context.db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    return total ?? 0;
  };

  const [seasons, gyms, gymHours, trainers, teams, requirements, schedules] = await Promise.all([
    count("seasons"),
    count("gyms"),
    count("gym_availability"),
    count("trainers"),
    count("teams"),
    count("team_training_requirements"),
    count("schedule_versions"),
  ]);

  return [
    { key: "stepSeason", done: seasons > 0, href: "/seasons" },
    { key: "stepGyms", done: gyms > 0, href: "/gyms" },
    { key: "stepGymHours", done: gymHours > 0, href: "/gyms" },
    { key: "stepTrainers", done: trainers > 0, href: "/trainers" },
    { key: "stepTeams", done: teams > 0, href: "/teams" },
    { key: "stepRequirements", done: requirements > 0, href: "/teams" },
    { key: "stepSchedule", done: schedules > 0, href: "/organizer" },
  ];
}
