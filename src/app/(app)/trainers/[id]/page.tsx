import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Dumbbell, MapPin, Trophy, UserCog, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { RelatedCard } from "@/components/data/related-card";
import { StatusBadge } from "@/components/data/status-badge";
import { ExceptionsEditor } from "@/components/availability/exceptions-editor";
import { WeeklyAvailabilityEditor } from "@/components/availability/weekly-availability-editor";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { listCompetitionsForTeams } from "@/server/services/competition-service";
import { getTrainerRelations } from "@/server/services/relations-service";
import { ManageRelationDialog } from "@/components/data/manage-relation-dialog";
import { TrainerFormDialog } from "../trainer-form-dialog";
import { setTrainerTeamsAction } from "@/server/actions/relations";
import { listTeamOptions } from "@/server/services/team-service";
import { getAvailabilityAnchorDate } from "@/server/services/season-service";
import { getTrainer } from "@/server/services/trainer-service";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "trainers.read")) return {};
  try {
    const trainer = await getTrainer(context, (await params).id);
    return { title: `${trainer.first_name} ${trainer.last_name}` };
  } catch {
    return {};
  }
}

export default async function TrainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "trainers.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("trainers");
  const tCommon = await getTranslations("common");
  const tRelated = await getTranslations("related");
  const tCompetitions = await getTranslations("competitions");
  const tMembership = await getTranslations("membershipState");

  let trainer;
  try {
    trainer = await getTrainer(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  /*
    A trainer may edit their own availability without holding trainers.update —
    the Trainer role has availability.* precisely so coaches can keep their own
    hours current. The RLS policies allow the same thing at the database level.
  */
  const canEditAvailability = hasPermission(context, "availability.create");
  const canReadAvailability = hasPermission(context, "availability.read");

  const canReadTeams = hasPermission(context, "teams.read");
  const canEditTrainer = hasPermission(context, "trainers.update");
  const teamPool = canEditTrainer && canReadTeams ? await listTeamOptions(context) : [];
  const canReadAthletes = hasPermission(context, "athletes.read");
  const canReadGyms = hasPermission(context, "gyms.read");

  const today = new Date().toISOString().slice(0, 10);
  const [windows, exceptions, seasonStart, relations] = await Promise.all([
    canReadAvailability ? listAvailability(context, "trainer", id) : Promise.resolve([]),
    canReadAvailability
      ? listExceptions(context, "trainer", id, { from: today })
      : Promise.resolve([]),
    getAvailabilityAnchorDate(context),
    getTrainerRelations(context, id),
  ]);

  // A coach reaches a competition through the squads they take, so this waits
  // on the relations above rather than joining alongside them.
  const competitions = hasPermission(context, "competitions.read")
    ? await listCompetitionsForTeams(context, relations.teams.map((team) => team.id))
    : [];

  return (
    <div className="flex w-full flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/trainers">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={`${trainer.first_name} ${trainer.last_name}`}
        description={trainer.email ?? undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={trainer.status} />
            {canEditTrainer ? (
              <TrainerFormDialog
                mode="edit"
                teams={teamPool.map((entry) => ({ value: entry.id, label: entry.name }))}
                initialTeamIds={relations.teams.map((entry) => entry.id)}
                trainer={{
                  id: trainer.id,
                  firstName: trainer.first_name,
                  lastName: trainer.last_name,
                  email: trainer.email,
                  phone: trainer.phone,
                  qualifications: trainer.qualifications,
                  color: trainer.color,
                  notes: trainer.notes,
                }}
              />
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="size-4" aria-hidden />
            {tCommon("description")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{tCommon("phone")}</dt>
            <dd className="text-sm font-medium">{trainer.phone ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("qualifications")}</dt>
            <dd className="flex flex-wrap gap-1 pt-0.5">
              {trainer.qualifications.length === 0 ? (
                <span className="text-sm">—</span>
              ) : (
                trainer.qualifications.map((qualification) => (
                  <Badge key={qualification} variant="outline">
                    {qualification}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          {trainer.notes ? (
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">{tCommon("notes")}</dt>
              <dd className="text-sm whitespace-pre-line">{trainer.notes}</dd>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {competitions.length > 0 ? (
        <RelatedCard
          icon={Trophy}
          title={tRelated("competitions")}
          empty={tRelated("noCompetitionsForTrainer")}
          items={competitions.map((competition) => ({
            id: competition.id,
            name: competition.name,
            href: `/competitions/${competition.id}`,
            // Which of their squads this is about — a coach with three teams
            // needs to know which one the fixture list belongs to.
            meta: [competition.teamName, tCompetitions(competition.format)]
              .filter(Boolean)
              .join(" · "),
            tags:
              competition.phase !== "SINGLE"
                ? [{ label: tCompetitions(competition.phase), variant: "secondary" as const }]
                : [],
          }))}
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
            tags: team.sessions
              ? [{ label: tRelated("sessions", { count: team.sessions }), variant: "outline" as const }]
              : [],
          }))}
          action={
            teamPool.length > 0 ? (
              <ManageRelationDialog
                title={tRelated("teams")}
                options={teamPool.map((team) => ({ value: team.id, label: team.name }))}
                selected={relations.teams.map((team) => team.id)}
                id={id}
                save={setTrainerTeamsAction}
              />
            ) : null
          }
        />
      ) : null}

      {canReadAthletes ? (
        <RelatedCard
          icon={Dumbbell}
          title={tRelated("athletes")}
          empty={tRelated("noAthletes")}
          items={relations.athletes.map((athlete) => ({
            id: athlete.id,
            name: athlete.name,
            href: `/athletes/${athlete.id}`,
            // Athletes reach a trainer only through a squad, so the squad is
            // the thing worth showing next to the name.
            meta: athlete.via?.length ? tRelated("inTeams", { teams: athlete.via.join(", ") }) : null,
            tags:
              athlete.membershipStatus !== "ACTIVE"
                ? [{ label: tMembership(athlete.membershipStatus), variant: "outline" as const }]
                : [],
          }))}
        />
      ) : null}

      {canReadGyms ? (
        <RelatedCard
          icon={MapPin}
          title={tRelated("gyms")}
          empty={tRelated("noGymsForTrainer")}
          items={relations.gyms.map((gym) => ({
            id: gym.id,
            name: gym.name,
            href: `/gyms/${gym.id}`,
            meta: gym.city,
            tags: gym.sessions
              ? [{ label: tRelated("sessions", { count: gym.sessions }), variant: "outline" as const }]
              : [],
          }))}
        />
      ) : null}

      {canReadAvailability ? (
        <>
          <WeeklyAvailabilityEditor
            domain="trainer"
            ownerId={trainer.id}
            windows={windows}
            seasonStart={seasonStart}
            canEdit={canEditAvailability}
          />
          <ExceptionsEditor
            domain="trainer"
            ownerId={trainer.id}
            exceptions={exceptions}
            canEdit={canEditAvailability}
          />
        </>
      ) : null}
    </div>
  );
}
