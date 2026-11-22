import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarDays, ClipboardList, Info, MapPin, Swords, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageTabPanel, PageTabs } from "@/components/data/page-tabs";
import { PageCrumb } from "@/components/layout/app-breadcrumb";
import {
  TrainingSchedule,
  type TrainingScheduleView,
} from "@/components/calendar/training-schedule";
import { ExceptionsEditor } from "@/components/availability/exceptions-editor";
import { WeeklyAvailabilityEditor } from "@/components/availability/weekly-availability-editor";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listCompetitionsForTeams } from "@/server/services/competition-service";
import { getTeamRelations } from "@/server/services/relations-service";
import { getTeamRecord, listMatches } from "@/server/services/match-service";
import { getSeason, listSeasonOptions } from "@/server/services/season-service";
import { getTeam, listTeamOptions } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";
import { listAthleteOptions } from "@/server/services/athlete-service";
import { ManageRelationDialog } from "@/components/data/manage-relation-dialog";
import { ShirtNumbersDialog } from "@/components/data/shirt-numbers-dialog";
import { TeamFormDialog } from "../team-form-dialog";
import { setTeamAthletesAction } from "@/server/actions/relations";
import { getTrainingRequirement } from "@/server/services/training-requirement-service";

import {
  getTeamTrainingMonth,
  getTeamTrainingWeek,
} from "@/server/services/calendar-service";

import { CoachingStaffDialog } from "./coaching-staff-dialog";
import { TeamMatchTable } from "./match-table";
import { RequirementsCard } from "./requirements-form";
import { RosterGrid } from "./roster-grid";


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
  searchParams: Promise<{ view?: string; date?: string; week?: string; tab?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "teams.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("teams");
  const tCommon = await getTranslations("common");
  const tGender = await getTranslations("gender");
  const tRelated = await getTranslations("related");
  const tMatches = await getTranslations("matches");
  const tMembership = await getTranslations("membershipState");

  let team;
  try {
    team = await getTeam(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const {
    view: viewParam,
    date: dateParam,
    week: legacyWeekParam,
    tab: requestedTab,
  } = await searchParams;
  const scheduleView: TrainingScheduleView = viewParam === "month" ? "month" : "week";
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
    athletePool,
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
      (canCreateEvents || canEditTeam) && hasPermission(context, "seasons.read")
        ? listSeasonOptions(context)
        : Promise.resolve([]),
      (canCreateEvents || canEditTeam) && hasPermission(context, "trainers.read")
        ? listTrainerOptions(context)
        : Promise.resolve([]),
      canCreateEvents ? listTeamOptions(context) : Promise.resolve([]),
      canEditTeam && hasPermission(context, "athletes.read")
        ? listAthleteOptions(context)
        : Promise.resolve([]),
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

  // A side can be in several at once — a league, the phase it came out of, a
  // cup — so this is always a list.
  const competitions = hasPermission(context, "competitions.read")
    ? await listCompetitionsForTeams(context, [id])
    : [];

  /*
    A team's own matches, which Competitions could not answer: a side may be in
    a league, the phase it came out of and a cup at once, so "its matches" is a
    question about the team rather than about any one competition.
  */
  const canReadResults = hasPermission(context, "attendance.read");
  const [record, recentMatches] = canReadResults
    ? await Promise.all([
        getTeamRecord(context, id),
        listMatches(context, { teamId: id }),
      ])
    : [null, []];

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

  /*
    Every result of the season, most recent first — not the last-five form
    guide the record carries for a league table. On its own page a side's
    whole run is worth the row, and six played with five shown reads as one
    missing.
  */
  const seasonForm = recentMatches
    .filter((match) => match.result?.outcome)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((match) => match.result!.outcome!);

  const homeGym = team.home_gym_id ? gyms.find((gym) => gym.id === team.home_gym_id) : undefined;
  const otherHalls = relations.gyms.filter((gym) => gym.id !== team.home_gym_id && (gym.preferred || gym.allowed));
  const subtitle = [team.sport, tGender(team.gender), team.age_group, season.name]
    .filter(Boolean)
    .join(" · ");
  // Head coach first, then the assistants in the order the club listed them.
  const staff = [...relations.trainers].sort(
    (a, b) => Number(b.isHeadCoach ?? false) - Number(a.isHeadCoach ?? false),
  );
  const initialsOf = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();

  /*
    On a phone the page is four tabs under the season record; from lg up the
    tabs disappear and every section shows, one below the other.
  */
  const tabs = [
    ...(canReadResults && recentMatches.length > 0
      ? [{ value: "matches", label: <><Swords aria-hidden />{t("tabMatches")}</> }]
      : []),
    ...(canReadAthletes
      ? [
          {
            value: "roster",
            label: (
              <>
                <Users aria-hidden />
                {t("tabRoster")}
                <span className="font-mono text-[11px] opacity-70">{relations.athletes.length}</span>
              </>
            ),
          },
        ]
      : []),
    ...(schedule || canReadGyms
      ? [{ value: "training", label: <><CalendarDays aria-hidden />{t("tabTraining")}</> }]
      : []),
    { value: "rules", label: <><ClipboardList aria-hidden />{t("tabRules")}</> },
  ];
  const initialTab =
    typeof requestedTab === "string" && tabs.some((entry) => entry.value === requestedTab)
      ? requestedTab
      : tabs[0].value;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageCrumb title={team.name} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="label-caps -ml-2 w-fit">
          <Link href="/teams">
            <ArrowLeft aria-hidden />
            {t("title")}
          </Link>
        </Button>
        {canEditTeam ? (
          <TeamFormDialog
            mode="edit"
            seasons={seasons.map((entry) => ({ value: entry.id, label: entry.name }))}
            trainers={trainers.map((trainer) => ({
              value: trainer.id,
              label: `${trainer.first_name} ${trainer.last_name}`,
            }))}
            gyms={gyms.map((gym) => ({ value: gym.id, label: gym.name }))}
            initialTrainerIds={relations.trainers.map((trainer) => trainer.id)}
            team={{
              id: team.id,
              seasonId: team.season_id,
              name: team.name,
              sport: team.sport,
              category: team.category,
              ageGroup: team.age_group,
              gender: team.gender,
              homeGymId: team.home_gym_id,
              color: team.color,
              notes: team.notes,
            }}
          />
        ) : null}
      </div>

      <Card className="bg-linear-to-l from-orange-500/10 via-card to-card">
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  team.status === "ACTIVE"
                    ? "label-caps inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-700 dark:text-emerald-400"
                    : "label-caps inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground"
                }
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {tCommon(team.status)}
              </span>
              {/* A side can be in several at once — a league, its phase, a cup. */}
              {competitions.map((competition) => (
                <Link
                  key={competition.id}
                  href={`/competitions/${competition.id}`}
                  className="label-caps text-orange-600 hover:underline dark:text-orange-400"
                >
                  {competition.name}
                </Link>
              ))}
            </div>
            <h1 className="flex items-center gap-3 text-[28px] leading-8 font-extrabold tracking-[-0.02em] text-balance sm:text-[40px] sm:leading-[44px] sm:tracking-[-0.03em]">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: team.color }}
                aria-hidden
              />
              {team.name}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
            {team.notes ? (
              <p className="max-w-prose text-sm break-words whitespace-pre-line text-muted-foreground">
                {team.notes}
              </p>
            ) : null}
          </div>

          {canReadTrainers ? (
            <div className="w-full space-y-1.5 sm:w-auto sm:min-w-64">
              <div className="flex items-center justify-between gap-2">
                <p className="label-caps text-muted-foreground">{t("staff")}</p>
                {canEditTeam && trainers.length > 0 ? (
                  <CoachingStaffDialog
                    teamId={id}
                    trainers={trainers.map((trainer) => ({
                      id: trainer.id,
                      name: `${trainer.first_name} ${trainer.last_name}`,
                    }))}
                    selected={relations.trainers.map((trainer) => trainer.id)}
                    headCoachId={
                      relations.trainers.find((trainer) => trainer.isHeadCoach)?.id ?? null
                    }
                  />
                ) : null}
              </div>
              {staff.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tRelated("noTrainers")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {staff.map((trainer) => (
                    <li key={trainer.id}>
                      <Link
                        href={`/trainers/${trainer.id}`}
                        className="flex items-center gap-3 rounded-md border bg-background/60 p-2 hover:bg-muted/50"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-orange-500/15 font-mono text-xs font-bold text-orange-700 dark:text-orange-400">
                          {initialsOf(trainer.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{trainer.name}</span>
                            {/*
                              Everyone on the staff who is not the head is an
                              assistant — saying so is the difference between a
                              list of names and a structure a club recognises.
                            */}
                            <span className="label-caps shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              {trainer.isHeadCoach ? t("headShort") : t("assistantShort")}
                            </span>
                          </span>
                          {trainer.email ? (
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {trainer.email}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* The squad's particulars. On a phone the header already says them. */}
        <Card className="max-lg:hidden">
          <CardHeader>
            <CardTitle className="label-caps text-muted-foreground">{t("parametersTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                <p className="label-caps text-muted-foreground">{t("ageGroup")}</p>
                <p className="font-mono text-2xl font-bold">{team.age_group ?? "—"}</p>
              </div>
              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                <p className="label-caps text-muted-foreground">{t("gender")}</p>
                <p className="text-xl font-bold">{tGender(team.gender)}</p>
              </div>
            </div>
            <dl className="divide-y text-sm">
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-xs text-muted-foreground">{tCommon("category")}</dt>
                <dd className="text-end font-mono font-medium">{team.category ?? "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-xs text-muted-foreground">{t("homeGym")}</dt>
                <dd className="text-end font-medium">{homeGym?.name ?? "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-xs text-muted-foreground">{t("otherHalls")}</dt>
                <dd className="text-end font-medium">
                  {otherHalls.map((gym) => gym.name).join(", ") || "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-xs text-muted-foreground">{t("athletes")}</dt>
                <dd className="text-end font-mono font-semibold text-orange-600 dark:text-orange-400">
                  {relations.athletes.length}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {record ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="label-caps text-muted-foreground">{t("trackRecord")}</CardTitle>
              {record.played > 0 ? (
                <span className="label-caps text-muted-foreground">
                  {t("winPct")}{" "}
                  <span className="text-orange-600 dark:text-orange-400">
                    {Math.round((record.won / record.played) * 100)}%
                  </span>
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {record.played === 0 ? (
                <p className="text-sm text-muted-foreground">{tMatches("recordEmpty")}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <div className="col-span-2 space-y-1 rounded-md border bg-muted/30 p-3 lg:col-span-1">
                      <p className="label-caps text-muted-foreground">{tMatches("record")}</p>
                      <p className="font-mono text-3xl font-bold tracking-tight">
                        {record.won}W<span className="text-muted-foreground">–</span>
                        {record.lost}L
                        {record.drawn > 0 ? (
                          <>
                            <span className="text-muted-foreground">–</span>
                            {record.drawn}D
                          </>
                        ) : null}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {t("playedOf", { played: record.played, total: recentMatches.length })}
                      </p>
                    </div>
                    <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                      <p className="label-caps text-muted-foreground">{tMatches("pointsFor")}</p>
                      <p className="font-mono text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                        {record.pointsFor}
                      </p>
                      {record.perGame ? (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {t("perGameAvg", { value: record.perGame.scored.toFixed(1) })}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                      <p className="label-caps text-muted-foreground">{tMatches("pointsAgainst")}</p>
                      <p className="font-mono text-3xl font-bold text-orange-600 dark:text-orange-400">
                        {record.pointsAgainst}
                      </p>
                      {record.perGame ? (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {t("perGameAvg", { value: record.perGame.conceded.toFixed(1) })}
                        </p>
                      ) : null}
                    </div>
                    <div className="col-span-2 space-y-1 rounded-md border bg-muted/30 p-3 lg:col-span-1">
                      <p className="label-caps text-muted-foreground">{tMatches("pointDifference")}</p>
                      <p
                        className={
                          record.pointDifference >= 0
                            ? "font-mono text-3xl font-bold text-emerald-600 dark:text-emerald-400"
                            : "font-mono text-3xl font-bold text-destructive"
                        }
                      >
                        {record.pointDifference > 0 ? `+${record.pointDifference}` : record.pointDifference}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {t("netPerGame", {
                          value: (record.pointDifference / record.played).toFixed(1),
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                    <div>
                      <p className="label-caps text-muted-foreground">{tMatches("form")}</p>
                      <p className="text-xs text-muted-foreground">{tMatches("formHint")}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {seasonForm.map((outcome, index) => (
                        <span
                          key={index}
                          title={tMatches(outcome)}
                          className={
                            outcome === "WIN"
                              ? "flex size-8 items-center justify-center rounded bg-emerald-600 font-mono text-xs font-bold text-white"
                              : outcome === "LOSS"
                                ? "flex size-8 items-center justify-center rounded bg-red-700 font-mono text-xs font-bold text-white"
                                : "flex size-8 items-center justify-center rounded bg-muted font-mono text-xs font-bold"
                          }
                        >
                          {tMatches(outcome).charAt(0)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/*
                    Not boilerplate: anybody reading a won/lost line expects a
                    league table, and a club only ever sees its own fixtures.
                  */}
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    {tMatches("noLeagueTable")}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <PageTabs initial={initialTab} tabs={tabs} stackFrom="lg">
        {canReadResults && recentMatches.length > 0 ? (
          <PageTabPanel value="matches">
            <TeamMatchTable matches={recentMatches} timeZone={context.tenant.timezone} />
          </PageTabPanel>
        ) : null}

        {canReadAthletes ? (
          <PageTabPanel value="roster">
            <RosterGrid
              canOpen
              members={relations.athletes.map((athlete) => ({
                id: athlete.id,
                name: athlete.name,
                jerseyNumber: athlete.jerseyNumber ?? null,
                position: athlete.position ?? null,
                membership:
                  athlete.membershipStatus !== "ACTIVE"
                    ? tMembership(athlete.membershipStatus)
                    : null,
              }))}
              actions={
                canEditTeam ? (
                  <>
                    {relations.athletes.length > 0 ? (
                      <ShirtNumbersDialog
                        teamId={id}
                        members={relations.athletes.map((athlete) => ({
                          id: athlete.id,
                          name: athlete.name,
                          jerseyNumber: athlete.jerseyNumber ?? null,
                        }))}
                      />
                    ) : null}
                    {athletePool.length > 0 ? (
                      <ManageRelationDialog
                        title={tRelated("athletes")}
                        options={athletePool.map((athlete) => ({
                          value: athlete.id,
                          label: `${athlete.last_name} ${athlete.first_name}`,
                        }))}
                        selected={relations.athletes.map((athlete) => athlete.id)}
                        id={id}
                        save={setTeamAthletesAction}
                      />
                    ) : null}
                  </>
                ) : null
              }
            />
          </PageTabPanel>
        ) : null}

        {schedule || canReadGyms ? (
          <PageTabPanel value="training">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              {canReadGyms ? (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <MapPin className="size-4 text-orange-500" aria-hidden />
                      {tRelated("gyms")}
                    </CardTitle>
                    <span className="label-caps rounded-full bg-muted px-2 py-1 text-muted-foreground">
                      {t("hallsCount", { count: relations.gyms.length })}
                    </span>
                  </CardHeader>
                  <CardContent>
                    {relations.gyms.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{tRelated("noGyms")}</p>
                    ) : (
                      <ul className="space-y-2">
                        {relations.gyms.map((gym) => (
                          <li key={gym.id}>
                            <Link
                              href={`/gyms/${gym.id}`}
                              className="block space-y-1 rounded-md border bg-muted/20 p-3 hover:bg-muted/40"
                            >
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold">{gym.name}</span>
                                {gym.id === team.home_gym_id ? (
                                  <span className="label-caps rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-700 dark:text-orange-400">
                                    {t("homeGym")}
                                  </span>
                                ) : null}
                                {gym.preferred ? (
                                  <span className="label-caps rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">
                                    {tRelated("preferredGym")}
                                  </span>
                                ) : gym.allowed ? (
                                  <span className="label-caps rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                                    {tRelated("allowedGym")}
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
                                {gym.city ? <span>{gym.city}</span> : null}
                                {gym.sessions ? (
                                  <span>{tRelated("sessions", { count: gym.sessions })}</span>
                                ) : null}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {schedule ? (
                <div className={canReadGyms ? "" : "lg:col-span-2"}>
                  <TrainingSchedule
                    basePath={`/teams/${team.id}`}
                    eventTeamIds={[team.id]}
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
                    organizerHref={
                      hasPermission(context, "schedule.generate") ? "/organizer" : undefined
                    }
                  />
                </div>
              ) : null}
            </div>
          </PageTabPanel>
        ) : null}

        <PageTabPanel value="rules">
          <div className="space-y-6">
            {/*
              The weekly hours and the exceptions are more input to the same
              scheduler, so they sit inside the requirements as rows rather than
              as two cards of their own beneath them.
            */}
            <RequirementsCard requirement={requirement} gyms={gymOptions} canEdit={canEditTeam}>
              {canReadAvailability ? (
                <>
                  <WeeklyAvailabilityEditor
                    embedded
                    domain="team"
                    ownerId={team.id}
                    windows={windows}
                    seasonStart={season.start_date}
                    canEdit={canEditAvailability}
                  />
                  <ExceptionsEditor
                    embedded
                    domain="team"
                    ownerId={team.id}
                    exceptions={exceptions}
                    canEdit={canEditAvailability}
                  />
                </>
              ) : null}
            </RequirementsCard>
          </div>
        </PageTabPanel>
      </PageTabs>
    </div>
  );
}
