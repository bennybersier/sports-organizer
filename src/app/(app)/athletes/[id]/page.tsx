import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Dumbbell, UserCog, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { RelatedCard } from "@/components/data/related-card";
import { StatusBadge } from "@/components/data/status-badge";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { getAthletePerformance, listAbsences } from "@/server/services/performance-service";
import { requireAuthContext } from "@/server/auth/context";
import { getAthlete } from "@/server/services/athlete-service";
import { getAthleteRelations } from "@/server/services/relations-service";

import { AbsencesCard } from "./absences-card";
import { EvaluationDialog } from "./evaluation-dialog";
import { PerformanceCard } from "./performance-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "athletes.read")) return {};
  try {
    const athlete = await getAthlete(context, (await params).id);
    return { title: `${athlete.first_name} ${athlete.last_name}` };
  } catch {
    return {};
  }
}

/** The three months up to today — the cadence the rubric is built around. */
function assessmentPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 3);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default async function AthleteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "athletes.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("athletes");
  const tCommon = await getTranslations("common");
  const tGender = await getTranslations("gender");
  const tMembership = await getTranslations("membershipState");
  const tRelated = await getTranslations("related");
  const format = await getFormatter();

  let athlete;
  try {
    athlete = await getAthlete(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const relations = await getAthleteRelations(context, id);
  const canReadTeams = hasPermission(context, "teams.read");
  // Attendance is its own permission, and a page that can show an athlete does
  // not automatically get to show their season.
  const canReadAttendance = hasPermission(context, "attendance.read");
  const [performance, absences] = canReadAttendance
    ? await Promise.all([getAthletePerformance(context, id), listAbsences(context, id)])
    : [null, []];
  const canReadTrainers = hasPermission(context, "trainers.read");

  const address =
    [athlete.address_line1, [athlete.postal_code, athlete.city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ") || "—";

  const emergency =
    [
      athlete.emergency_contact_name,
      athlete.emergency_contact_phone,
      athlete.emergency_contact_relation,
    ]
      .filter(Boolean)
      .join(" · ") || "—";

  return (
    <div className="flex w-full flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/athletes">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={`${athlete.first_name} ${athlete.last_name}`}
        description={athlete.email ?? undefined}
        action={
          <>
            <Badge variant={athlete.membership_status === "ACTIVE" ? "secondary" : "outline"}>
              {tMembership(athlete.membership_status)}
            </Badge>
            <StatusBadge status={athlete.status} />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Dumbbell className="size-4" aria-hidden />
            {tCommon("description")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("dateOfBirth")}</dt>
            <dd className="text-sm font-medium">
              {athlete.date_of_birth
                ? format.dateTime(new Date(`${athlete.date_of_birth}T12:00:00Z`), {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  })
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("gender")}</dt>
            <dd className="text-sm font-medium">{tGender(athlete.gender)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{tCommon("phone")}</dt>
            <dd className="text-sm font-medium">{athlete.phone ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{tCommon("address")}</dt>
            <dd className="text-sm font-medium">{address}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("emergencyContact")}</dt>
            <dd className="text-sm font-medium">{emergency}</dd>
          </div>
          {athlete.notes ? (
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">{tCommon("notes")}</dt>
              <dd className="text-sm whitespace-pre-line">{athlete.notes}</dd>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {performance ? (
        <PerformanceCard
          performance={performance}
          action={
            hasPermission(context, "evaluations.write") ? (
              <EvaluationDialog
                athleteId={id}
                teams={relations.teams.map((team) => ({ id: team.id, name: team.name }))}
                defaultPeriod={assessmentPeriod()}
              />
            ) : null
          }
        />
      ) : null}

      {canReadAttendance ? (
        <AbsencesCard
          athleteId={id}
          absences={absences}
          canRecord={hasPermission(context, "attendance.record")}
        />
      ) : null}

      {canReadTeams ? (
        <RelatedCard
          icon={Users}
          title={tRelated("teams")}
          empty={tRelated("noTeams")}
          items={relations.teams.map((team) => ({
            id: team.id,
            name: team.name,
            href: `/teams/${team.id}`,
            color: team.color,
            meta: [team.sport, team.ageGroup].filter(Boolean).join(" · "),
          }))}
        />
      ) : null}

      {canReadTrainers ? (
        <RelatedCard
          icon={UserCog}
          title={tRelated("trainers")}
          empty={tRelated("noTrainers")}
          items={relations.trainers.map((trainer) => ({
            id: trainer.id,
            name: trainer.name,
            href: `/trainers/${trainer.id}`,
            color: trainer.color,
            // The squad is why this coach is on the page at all.
            meta: trainer.via?.length
              ? tRelated("coaches", { teams: trainer.via.join(", ") })
              : trainer.email,
            tags: trainer.isHeadCoach
              ? [{ label: tRelated("headCoach"), variant: "secondary" as const }]
              : [],
          }))}
        />
      ) : null}
    </div>
  );
}
