import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Dumbbell, MapPin, UserCog, Users } from "lucide-react";

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
import { listGymOptions } from "@/server/services/gym-service";
import { getTeamRelations } from "@/server/services/relations-service";
import { getSeason, listSeasonOptions } from "@/server/services/season-service";
import { getTeam, listTeamOptions } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";
import { getTrainingRequirement } from "@/server/services/training-requirement-service";

import {
  getTeamTrainingMonth,
  getTeamTrainingWeek,
} from "@/server/services/calendar-service";

import { RequirementsCard } from "./requirements-form";
import { TeamSchedule, type TeamScheduleView } from "./team-schedule";

/** Guards the week query param: anything else falls back to the next session. */
function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

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

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // The range being viewed lives in the URL so it survives a refresh and can be
  // linked to — "here is the week we are arguing about" is a real message.
  searchParams: Promise<{ view?: string; date?: string; week?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "teams.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("teams");
  const tCommon = await getTranslations("common");
  const tGender = await getTranslations("gender");
  const tRelated = await getTranslations("related");
  const tMembership = await getTranslations("membershipState");

  let team;
  try {
    team = await getTeam(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { view: viewParam, date: dateParam, week: legacyWeekParam } = await searchParams;
  const scheduleView: TeamScheduleView = viewParam === "month" ? "month" : "week";
  // `week` is what this page used before it had two views; links out there
  // still carry it.
  const anchorParam = isIsoDate(dateParam) ? dateParam : isIsoDate(legacyWeekParam) ? legacyWeekParam : undefined;
  const canEditTeam = hasPermission(context, "teams.update");
  const canReadCalendar = hasPermission(context, "calendar.read");
  const canReadAvailability = hasPermission(context, "availability.read");
  const canEditAvailability = hasPermission(context, "availability.create");

  const canCreateEvents = hasPermission(context, "calendar.create");

  const today = new Date().toISOString().slice(0, 10);
  const [
    season,
    requirement,
    gyms,
    windows,
    exceptions,
    trainingWeek,
    trainingMonth,
    seasons,
    trainers,
    teams,
  ] = await Promise.all([
      getSeason(context, team.season_id),
      getTrainingRequirement(context, id, team.season_id),
      hasPermission(context, "gyms.read") ? listGymOptions(context) : Promise.resolve([]),
      canReadAvailability ? listAvailability(context, "team", id) : Promise.resolve([]),
      canReadAvailability
        ? listExceptions(context, "team", id, { from: today })
        : Promise.resolve([]),
      canReadCalendar && scheduleView === "week"
        ? getTeamTrainingWeek(context, id, anchorParam)
        : Promise.resolve(null),
      canReadCalendar && scheduleView === "month"
        ? getTeamTrainingMonth(context, id, anchorParam)
        : Promise.resolve(null),
      // Only for the training week's "+" — the event editor needs the same
      // pickers the calendar page gives it.
      canCreateEvents && hasPermission(context, "seasons.read")
        ? listSeasonOptions(context)
        : Promise.resolve([]),
      canCreateEvents && hasPermission(context, "trainers.read")
        ? listTrainerOptions(context)
        : Promise.resolve([]),
      canCreateEvents ? listTeamOptions(context) : Promise.resolve([]),
    ]);

  /*
    One shape for the card, whichever range was asked for. The week and the
    month are read by different queries — a month is not seven days with a
    bigger number — but they render the same cell, so the difference is
    flattened here rather than in the component.
  */
  const schedule = trainingWeek
    ? {
        weeks: [trainingWeek.days.map((entry) => ({ ...entry, inMonth: true }))],
        anchor: trainingWeek.weekStart,
        rangeStart: trainingWeek.weekStart,
        rangeEnd: trainingWeek.weekEnd,
        previous: trainingWeek.previousWeek,
        next: trainingWeek.nextWeek,
        scheduledCount: trainingWeek.scheduledCount,
        coverageStart: trainingWeek.coverageStart,
      }
    : trainingMonth
      ? {
          weeks: trainingMonth.weeks,
          anchor: trainingMonth.monthStart,
          rangeStart: trainingMonth.from,
          rangeEnd: trainingMonth.to,
          previous: trainingMonth.previousMonth,
          next: trainingMonth.nextMonth,
          scheduledCount: trainingMonth.scheduledCount,
          coverageStart: trainingMonth.coverageStart,
        }
      : null;

  // Needs the requirement above it: which halls are related to a team is partly
  // a question its requirements answer.
  const relations = await getTeamRelations(context, id, requirement);

  const gymOptions = gyms.map((gym) => ({ value: gym.id, label: gym.name }));
  const eventOptions = canCreateEvents
    ? {
        seasons: seasons.map((entry) => ({ value: entry.id, label: entry.name })),
        gyms: gymOptions,
        trainers: trainers.map((trainer) => ({
          value: trainer.id,
          label: `${trainer.first_name} ${trainer.last_name}`,
        })),
        teams: teams.map((entry) => ({ value: entry.id, label: entry.name })),
        // What a coach types is read on the club's clock, not the browser's.
        timeZone: context.tenant.timezone,
      }
    : undefined;
  const canReadTrainers = hasPermission(context, "trainers.read");
  const canReadAthletes = hasPermission(context, "athletes.read");
  const canReadGyms = hasPermission(context, "gyms.read");

  return (
    <div className="flex w-full flex-col gap-6">
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

      {canReadTrainers ? (
        <RelatedCard
          icon={UserCog}
          title={tRelated("trainers")}
          empty={tRelated("noTrainers")}
          items={relations.trainers.map((trainer) => ({
            id: trainer.id,
            name: trainer.name,
            href: `/trainers/${trainer.id}`,
            meta: trainer.email,
            color: trainer.color,
            tags: [
              ...(trainer.isHeadCoach
                ? [{ label: tRelated("headCoach"), variant: "secondary" as const }]
                : []),
              ...(trainer.status !== "ACTIVE"
                ? [{ label: tCommon(trainer.status), variant: "outline" as const }]
                : []),
            ],
          }))}
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
            meta: athlete.position,
            tags: [
              ...(athlete.jerseyNumber !== null && athlete.jerseyNumber !== undefined
                ? [{ label: tRelated("jersey", { number: athlete.jerseyNumber }) }]
                : []),
              ...(athlete.membershipStatus !== "ACTIVE"
                ? [
                    {
                      label: tMembership(athlete.membershipStatus),
                      variant: "outline" as const,
                    },
                  ]
                : []),
            ],
          }))}
        />
      ) : null}

      {canReadGyms ? (
        <RelatedCard
          icon={MapPin}
          title={tRelated("gyms")}
          empty={tRelated("noGyms")}
          items={relations.gyms.map((gym) => ({
            id: gym.id,
            name: gym.name,
            href: `/gyms/${gym.id}`,
            meta: gym.city,
            tags: [
              ...(gym.preferred
                ? [{ label: tRelated("preferredGym"), variant: "secondary" as const }]
                : gym.allowed
                  ? [{ label: tRelated("allowedGym") }]
                  : []),
              ...(gym.sessions
                ? [
                    {
                      label: tRelated("sessions", { count: gym.sessions }),
                      variant: "outline" as const,
                    },
                  ]
                : []),
            ],
          }))}
        />
      ) : null}

      {schedule ? (
        <TeamSchedule
          teamId={team.id}
          view={scheduleView}
          weeks={schedule.weeks}
          anchor={schedule.anchor}
          rangeStart={schedule.rangeStart}
          rangeEnd={schedule.rangeEnd}
          previous={schedule.previous}
          next={schedule.next}
          scheduledCount={schedule.scheduledCount}
          coverageStart={schedule.coverageStart}
          timezone={context.tenant.timezone}
          requiredPerWeek={requirement?.sessionsPerWeek ?? null}
          eventOptions={eventOptions}
        />
      ) : null}

      <RequirementsCard requirement={requirement} gyms={gymOptions} canEdit={canEditTeam} />

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
