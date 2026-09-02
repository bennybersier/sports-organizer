import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { StatusBadge } from "@/components/data/status-badge";
import { ExceptionsEditor } from "@/components/availability/exceptions-editor";
import { WeeklyAvailabilityEditor } from "@/components/availability/weekly-availability-editor";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { listGymOptions } from "@/server/services/gym-service";
import { getSeason } from "@/server/services/season-service";
import { getTeam } from "@/server/services/team-service";
import { getTrainingRequirement } from "@/server/services/training-requirement-service";

import { RequirementsForm } from "./requirements-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "teams.read")) return {};
  try {
    const team = await getTeam(context, (await params).id);
    return { title: team.name };
  } catch {
    return {};
  }
}

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "teams.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("teams");
  const tCommon = await getTranslations("common");
  const tGender = await getTranslations("gender");

  let team;
  try {
    team = await getTeam(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canEditTeam = hasPermission(context, "teams.update");
  const canReadAvailability = hasPermission(context, "availability.read");
  const canEditAvailability = hasPermission(context, "availability.create");

  const today = new Date().toISOString().slice(0, 10);
  const [season, requirement, gyms, windows, exceptions] = await Promise.all([
    getSeason(context, team.season_id),
    getTrainingRequirement(context, id, team.season_id),
    hasPermission(context, "gyms.read") ? listGymOptions(context) : Promise.resolve([]),
    canReadAvailability ? listAvailability(context, "team", id) : Promise.resolve([]),
    canReadAvailability ? listExceptions(context, "team", id, { from: today }) : Promise.resolve([]),
  ]);

  const gymOptions = gyms.map((gym) => ({ value: gym.id, label: gym.name }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/teams">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={team.name}
        description={`${team.sport} · ${season.name}`}
        action={<StatusBadge status={team.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" aria-hidden />
            {tCommon("description")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("ageGroup")}</dt>
            <dd className="text-sm font-medium">{team.age_group ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("gender")}</dt>
            <dd className="text-sm font-medium">{tGender(team.gender)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{tCommon("category")}</dt>
            <dd className="text-sm font-medium">{team.category ?? "—"}</dd>
          </div>
          {team.notes ? (
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">{tCommon("notes")}</dt>
              <dd className="text-sm whitespace-pre-line">{team.notes}</dd>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RequirementsForm requirement={requirement} gyms={gymOptions} canEdit={canEditTeam} />

      {canReadAvailability ? (
        <>
          <WeeklyAvailabilityEditor
            domain="team"
            ownerId={team.id}
            windows={windows}
            seasonStart={season.start_date}
            canEdit={canEditAvailability}
          />
          <ExceptionsEditor
            domain="team"
            ownerId={team.id}
            exceptions={exceptions}
            canEdit={canEditAvailability}
          />
        </>
      ) : null}
    </div>
  );
}
