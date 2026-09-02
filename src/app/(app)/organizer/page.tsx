import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { PageHeader } from "@/components/data/page-header";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAvailability } from "@/server/services/availability-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTeamOptions } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";
import { listTrainingRequirements } from "@/server/services/training-requirement-service";

import { OrganizerWorkflow } from "./organizer-workflow";
import { VersionList } from "./version-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("organizer");
  return { title: t("title") };
}

export default async function OrganizerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "schedule.generate")) return <AccessDenied />;

  const t = await getTranslations("organizer");

  const raw = await searchParams;
  const seasons = await listSeasonOptions(context);

  if (seasons.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader title={t("title")} description={t("subtitle")} />
        <EmptyState icon={Sparkles} title={t("noSeasons")} description={t("subtitle")} />
      </div>
    );
  }

  const requested = typeof raw.season === "string" ? raw.season : undefined;
  const seasonId =
    seasons.find((season) => season.id === requested)?.id ??
    seasons.find((season) => season.status === "ACTIVE")?.id ??
    seasons[0].id;

  const [teams, gyms, trainers, requirements, versions] = await Promise.all([
    listTeamOptions(context, seasonId),
    listGymOptions(context),
    listTrainerOptions(context),
    listTrainingRequirements(context, seasonId),
    context.db
      .from("schedule_versions")
      .select("id, version_number, name, status, result_summary, created_at, published_at")
      .eq("tenant_id", context.tenant.id)
      .eq("season_id", seasonId)
      .order("version_number", { ascending: false })
      .limit(10),
  ]);

  /*
    Readiness is computed rather than assumed: telling someone their schedule
    is empty *after* a generation run wastes their time, when the cause —
    "no gym has opening hours" — is knowable beforehand.
  */
  const gymsWithAvailability = await countWithAvailability(
    gyms.map((gym) => gym.id),
    (id) => listAvailability(context, "gym", id),
  );
  const trainersWithAvailability = await countWithAvailability(
    trainers.map((trainer) => trainer.id),
    (id) => listAvailability(context, "trainer", id),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <OrganizerWorkflow
        seasons={seasons.map((season) => ({
          value: season.id,
          label: season.name,
          isActive: season.status === "ACTIVE",
        }))}
        selectedSeasonId={seasonId}
        teams={teams.map((team) => ({ value: team.id, label: team.name }))}
        gyms={gyms.map((gym) => ({ value: gym.id, label: gym.name }))}
        readiness={{
          teams: teams.length,
          teamsWithRequirements: requirements.size,
          gyms: gymsWithAvailability,
          trainers: trainersWithAvailability,
        }}
      />

      <VersionList
        versions={(versions.data ?? []).map((version) => ({
          id: version.id,
          number: version.version_number,
          name: version.name,
          status: version.status,
          summary: version.result_summary as {
            score?: number;
            stats?: { sessionsScheduled?: number; sessionsRequested?: number };
            unmet?: { teamName: string; scheduled: number; requested: number }[];
          },
          createdAt: version.created_at,
        }))}
        canPublish={hasPermission(context, "schedule.publish")}
        canReview={hasPermission(context, "schedule.review")}
      />
    </div>
  );
}

/** How many of these owners have any availability configured at all. */
async function countWithAvailability(
  ids: string[],
  load: (id: string) => Promise<unknown[]>,
): Promise<number> {
  const results = await Promise.all(ids.map((id) => load(id)));
  return results.filter((windows) => windows.length > 0).length;
}
