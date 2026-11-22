import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageCrumb } from "@/components/layout/app-breadcrumb";
import { ManageRelationDialog } from "@/components/data/manage-relation-dialog";
import { AthleteFormDialog } from "../athlete-form-dialog";
import { setAthleteTeamsAction } from "@/server/actions/relations";
import { listTeamOptions } from "@/server/services/team-service";
import {
  TrainingSchedule,
  type TrainingScheduleView,
} from "@/components/calendar/training-schedule";
import { StatusBadge } from "@/components/data/status-badge";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import {
  getAthleteTrainingMonth,
  getAthleteTrainingWeek,
} from "@/server/services/calendar-service";
import { getAthletePerformance, listAbsences } from "@/server/services/performance-service";
import { listAthleteMatches } from "@/server/services/match-service";
import { requireAuthContext } from "@/server/auth/context";
import { getAthlete } from "@/server/services/athlete-service";
import { getAthleteRelations } from "@/server/services/relations-service";

import { AbsencesCard } from "./absences-card";
import { AthleteShirtNumbersDialog } from "./athlete-shirt-numbers-dialog";
import { EvaluationDialog } from "./evaluation-dialog";
import { LinkedCard } from "./linked-card";
import { MatchLogCard, PointsTrendCard } from "./match-log-card";
import { AttendanceCard, ScoringCard } from "./performance-card";
import { DetailTile, SectionHeader } from "./section";

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

/** Guards the date query param: anything else falls back to the next session. */
function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function AthleteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // The range being viewed lives in the URL so it survives a refresh and can be
  // linked to, exactly as it does on a team's page.
  searchParams: Promise<{ view?: string; date?: string }>;
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
  const shirts = relations.teams.filter(
    (team): team is typeof team & { jerseyNumber: number } =>
      team.jerseyNumber !== null && team.jerseyNumber !== undefined,
  );
  const canReadTeams = hasPermission(context, "teams.read");
  const canEditAthlete = hasPermission(context, "athletes.update");
  const canEditTeams = hasPermission(context, "teams.update");
  // Every squad they could be put in, not only the ones they are in.
  const teamPool = canEditAthlete && canReadTeams ? await listTeamOptions(context) : [];
  // Attendance is its own permission, and a page that can show an athlete does
  // not automatically get to show their season.
  const { view: viewParam, date: dateParam } = await searchParams;
  const scheduleView: TrainingScheduleView = viewParam === "month" ? "month" : "week";
  const anchorParam = isIsoDate(dateParam) ? dateParam : undefined;

  // Gathered from every squad they are in — a boy who trains up an age group
  // has two teams' sessions in his week, and that is precisely the week worth
  // seeing in one place.
  const training = hasPermission(context, "calendar.read")
    ? scheduleView === "month"
      ? await getAthleteTrainingMonth(context, id, anchorParam)
      : await getAthleteTrainingWeek(context, id, anchorParam)
    : null;

  const canReadAttendance = hasPermission(context, "attendance.read");
  const [performance, absences, matchLog] = canReadAttendance
    ? await Promise.all([
        getAthletePerformance(context, id),
        listAbsences(context, id),
        // The games behind the averages, each one a link back to the match.
        listAthleteMatches(context, id),
      ])
    : [null, [], []];
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

  const fullName = `${athlete.first_name} ${athlete.last_name}`;
  const initials = `${athlete.first_name[0] ?? ""}${athlete.last_name[0] ?? ""}`.toUpperCase();
  const dateOfBirth = athlete.date_of_birth
    ? format.dateTime(new Date(`${athlete.date_of_birth}T12:00:00Z`), {
        dateStyle: "medium",
        timeZone: "UTC",
      })
    : "—";

  /*
    The page is a run of numbered sections, and on a phone they are reordered
    rather than restyled: the season's figures first, because that is what a
    coach opens a player for on the touchline, and the record card after them.
    `order` moves the later sections without duplicating any of them.
  */
  const later = "max-lg:order-1";

  return (
    <div className="flex w-full flex-col gap-6">
      <PageCrumb title={fullName} />
      <Button asChild variant="ghost" size="sm" className="label-caps -ml-2 w-fit">
        <Link href="/athletes">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <Card className="bg-linear-to-l from-orange-500/10 via-card to-card">
        <CardContent className="flex flex-wrap items-start gap-4">
          {/* No photographs are kept, so the mark is the player's initials. */}
          <div className="relative shrink-0">
            <span className="flex size-16 items-center justify-center rounded-lg border bg-muted font-mono text-xl font-bold sm:size-20 sm:text-2xl">
              {initials}
            </span>
            {shirts.length === 1 ? (
              <span className="absolute -right-1.5 -bottom-1.5 rounded bg-orange-500 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#0b0f17]">
                #{shirts[0].jerseyNumber}
              </span>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            {/*
              The shirt beside the name, where a coach looks for it.

              A number belongs to a player *in a team*, so a boy who trains up
              an age group has two. One number reads as part of the name; two
              go on their team chips below, or the title states something that
              is only half true.
            */}
            <h1 className="text-[28px] leading-8 font-extrabold tracking-[-0.02em] text-balance sm:text-[40px] sm:leading-[44px] sm:tracking-[-0.03em]">
              {fullName}
              {shirts.length === 1 ? (
                <span className="text-muted-foreground"> #{shirts[0].jerseyNumber}</span>
              ) : null}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  athlete.membership_status === "ACTIVE"
                    ? "label-caps inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-700 dark:text-emerald-400"
                    : "label-caps inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground"
                }
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {tMembership(athlete.membership_status)}
              </span>
              {athlete.status !== "ACTIVE" ? <StatusBadge status={athlete.status} /> : null}
              {relations.teams.map((team) => (
                <span
                  key={team.id}
                  className="label-caps rounded-full border border-orange-500/40 px-2.5 py-1 text-orange-700 dark:text-orange-400"
                >
                  {team.name}
                  {shirts.length > 1 && team.jerseyNumber != null ? ` · #${team.jerseyNumber}` : ""}
                </span>
              ))}
            </div>
            {athlete.email ? (
              <p className="truncate font-mono text-xs text-muted-foreground">{athlete.email}</p>
            ) : null}
          </div>

          {canEditAthlete ? (
            <div className="shrink-0">
              <AthleteFormDialog
                mode="edit"
                teams={teamPool.map((team) => ({ value: team.id, label: team.name }))}
                currentTeamIds={relations.teams.map((team) => team.id)}
                currentNumbers={Object.fromEntries(
                  relations.teams.map((team) => [team.id, team.jerseyNumber ?? null]),
                )}
                athlete={{
                  id: athlete.id,
                  firstName: athlete.first_name,
                  lastName: athlete.last_name,
                  dateOfBirth: athlete.date_of_birth,
                  gender: athlete.gender,
                  email: athlete.email,
                  phone: athlete.phone,
                  addressLine1: athlete.address_line1,
                  postalCode: athlete.postal_code,
                  city: athlete.city,
                  emergencyContactName: athlete.emergency_contact_name,
                  emergencyContactPhone: athlete.emergency_contact_phone,
                  emergencyContactRelation: athlete.emergency_contact_relation,
                  membershipStatus: athlete.membership_status,
                  notes: athlete.notes,
                }}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className={later}>
        <SectionHeader index={1} eyebrow={t("detailsEyebrow")} title={tCommon("description")} />
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <DetailTile label={t("dateOfBirth")}>{dateOfBirth}</DetailTile>
            <DetailTile label={t("gender")}>{tGender(athlete.gender)}</DetailTile>
            <DetailTile label={tCommon("phone")}>{athlete.phone ?? "—"}</DetailTile>
            <DetailTile label={tCommon("email")}>{athlete.email ?? "—"}</DetailTile>
            <DetailTile label={tCommon("address")}>{address}</DetailTile>
            <DetailTile label={t("emergencyContact")}>{emergency}</DetailTile>
          </dl>
          {athlete.notes ? (
            <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
              <Info className="mt-0.5 size-4 shrink-0 text-orange-500" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="label-caps text-muted-foreground">{tCommon("notes")}</p>
                <p className="text-sm break-words whitespace-pre-line">{athlete.notes}</p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {performance ? (
        <div className={performance.boxScore ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"}>
          <AttendanceCard
            index={2}
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
          {/* First on a phone: points and fouls are what the touchline asks. */}
          {performance.boxScore ? (
            <div className="max-lg:order-first">
              <ScoringCard index={3} boxScore={performance.boxScore} />
            </div>
          ) : null}
        </div>
      ) : null}

      {matchLog.length > 0 ? (
        <div className={matchLog.length > 1 ? "grid items-start gap-6 lg:grid-cols-2" : "grid gap-6"}>
          <PointsTrendCard index={4} matches={matchLog} />
          <MatchLogCard index={5} matches={matchLog} />
        </div>
      ) : null}

      {training ? (
        <div className={later}>
          <TrainingSchedule
            basePath={`/athletes/${id}`}
            eventTeamIds={relations.teams.map((team) => team.id)}
            view={scheduleView}
            weeks={
              "days" in training
                ? [training.days.map((day) => ({ ...day, inMonth: true }))]
                : training.weeks
            }
            anchor={"weekStart" in training ? training.weekStart : training.monthStart}
            rangeStart={"weekStart" in training ? training.weekStart : training.from}
            rangeEnd={"weekEnd" in training ? training.weekEnd : training.to}
            previous={"previousWeek" in training ? training.previousWeek : training.previousMonth}
            next={"nextWeek" in training ? training.nextWeek : training.nextMonth}
            scheduledCount={training.scheduledCount}
            coverageStart={training.coverageStart}
            // An athlete has no weekly session target of their own — that belongs
            // to each of their squads, and summing them would invent a number.
            requiredPerWeek={null}
            timezone={context.tenant.timezone}
          />
        </div>
      ) : null}

      <div className={`grid gap-6 md:grid-cols-2 xl:grid-cols-3 ${later}`}>
        {canReadAttendance ? (
          <div className="md:col-span-2 xl:col-span-1">
            <AbsencesCard
              index={7}
              eyebrow={t("absencesEyebrow")}
              athleteId={id}
              absences={absences}
              canRecord={hasPermission(context, "attendance.record")}
            />
          </div>
        ) : null}

        {canReadTeams ? (
          <LinkedCard
            index={8}
            eyebrow={t("rosterEyebrow")}
            title={tRelated("teams")}
            empty={tRelated("noTeams")}
            items={relations.teams.map((team) => ({
              id: team.id,
              name: team.name,
              href: `/teams/${team.id}`,
              color: team.color,
              meta: [team.sport, team.ageGroup].filter(Boolean).join(" · "),
              // Which shirt for which side — the pairing the number belongs to.
              badge: team.jerseyNumber != null ? `#${team.jerseyNumber}` : null,
            }))}
            action={
              <>
                {canEditTeams && relations.teams.length > 0 ? (
                  <AthleteShirtNumbersDialog
                    athleteId={id}
                    teams={relations.teams.map((team) => ({
                      id: team.id,
                      name: team.name,
                      jerseyNumber: team.jerseyNumber ?? null,
                    }))}
                  />
                ) : null}
                {teamPool.length > 0 ? (
                  <ManageRelationDialog
                    title={tRelated("teams")}
                    options={teamPool.map((team) => ({ value: team.id, label: team.name }))}
                    selected={relations.teams.map((team) => team.id)}
                    id={id}
                    save={setAthleteTeamsAction}
                  />
                ) : null}
              </>
            }
          />
        ) : null}

        {canReadTrainers ? (
          <LinkedCard
            index={9}
            eyebrow={t("staffEyebrow")}
            title={tRelated("trainers")}
            empty={tRelated("noTrainers")}
            items={relations.trainers.map((trainer) => ({
              id: trainer.id,
              name: trainer.name,
              href: `/trainers/${trainer.id}`,
              color: trainer.color,
              // The squad is why this coach is on the page at all.
              meta: [
                trainer.isHeadCoach ? tRelated("headCoach") : null,
                trainer.via?.length
                  ? tRelated("coaches", { teams: trainer.via.join(", ") })
                  : trainer.email,
              ]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}
