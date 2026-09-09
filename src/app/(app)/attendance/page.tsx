import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarDays, ClipboardCheck, MapPin, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { PageHeader } from "@/components/data/page-header";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import {
  getSquadPerformance,
  listPendingSessions,
  listUpcomingFixtures,
} from "@/server/services/performance-service";
import { listTeamOptions } from "@/server/services/team-service";

import { OpenRegisterButton } from "./open-register-button";
import { SquadReport } from "./squad-report";
import { TeamPicker } from "./team-picker";

export const metadata: Metadata = { title: "Attendance" };

/**
 * The module's front door, and it answers one question first: what has nobody
 * marked yet?
 *
 * That list is computed rather than stored — a register only exists once
 * somebody opens one, so an unmarked session is the *absence* of a row. Which
 * means it stays correct across a schedule being regenerated, and there is no
 * backlog of empty rows to keep in step.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return <AccessDenied />;

  const t = await getTranslations("attendance");
  const format = await getFormatter();
  const { team: selectedTeam } = await searchParams;

  const [pending, upcoming, teams] = await Promise.all([
    listPendingSessions(context),
    listUpcomingFixtures(context),
    listTeamOptions(context),
  ]);

  const report = selectedTeam ? await getSquadPerformance(context, selectedTeam) : null;
  const canRecord = hasPermission(context, "attendance.record");

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("toPick")}</h2>
          <ul className="divide-y rounded-lg border">
            {upcoming.map((fixture) => (
              <li
                key={`${fixture.eventId}:${fixture.teamId}`}
                className="flex flex-wrap items-center gap-3 p-3 sm:p-4"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: fixture.teamColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{fixture.teamName}</p>
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {format.dateTime(new Date(fixture.startsAt), {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {fixture.gymName ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {fixture.gymName}
                      </span>
                    ) : null}
                  </p>
                </div>
                {canRecord ? (
                  <OpenRegisterButton
                    registerId={fixture.registerId}
                    scheduleEntryId={null}
                    eventId={fixture.eventId}
                    teamId={fixture.teamId}
                    label={fixture.registerId ? undefined : "pickSquad"}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("toMark")}</h2>

        {pending.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={t("toMarkEmpty")}
            description={t("toMarkEmptyBody")}
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {pending.map((session) => (
              <li
                key={`${session.scheduleEntryId ?? session.eventId}:${session.teamId}`}
                className="flex flex-wrap items-center gap-3 p-3 sm:p-4"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: session.teamColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{session.teamName}</p>
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {session.occasion === "MATCH" ? (
                        <Users className="size-3.5" aria-hidden />
                      ) : (
                        <CalendarDays className="size-3.5" aria-hidden />
                      )}
                      {format.dateTime(new Date(session.startsAt), {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {session.gymName ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {session.gymName}
                      </span>
                    ) : null}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {session.occasion === "MATCH" ? t("match") : t("training")}
                </Badge>
                {canRecord ? (
                  <OpenRegisterButton
                    registerId={session.registerId}
                    scheduleEntryId={session.scheduleEntryId}
                    eventId={session.eventId}
                    teamId={session.teamId}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("squadReport")}</h2>
          <TeamPicker
            teams={teams.map((team) => ({ id: team.id, name: team.name }))}
            value={selectedTeam ?? null}
          />
        </div>

        {report ? (
          <SquadReport report={report} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("pickTeam")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{t("stats.noData")}</CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
