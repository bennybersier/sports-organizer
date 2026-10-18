import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, ClipboardCheck, MapPin } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { getMatch, listSquad } from "@/server/services/match-service";
import { listSheets } from "@/server/services/match-sheet-service";
import { listBoxScores } from "@/server/services/performance-service";
import { getDefaultProvider } from "@/server/services/ai-config-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTeamOptions } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";

import { EditMatchButton } from "./edit-match-button";
import { ResultForm } from "./result-form";
import { SheetsCard } from "./sheets-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string; teamId: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return {};
  try {
    const { eventId, teamId } = await params;
    const match = await getMatch(context, eventId, teamId);
    return { title: `${match.teamName} vs ${match.opponent}` };
  } catch {
    return {};
  }
}

/**
 * One match, in one place.
 *
 * Before this page a match's life was split three ways: the fixture in
 * Competitions, the squad and scoresheet in Attendance, the resulting numbers in
 * each athlete's profile. This is the page that holds the match itself — what it
 * finished, the photograph of the sheet, and the numbers that came off it — and
 * links out to the register for the attendance detail rather than duplicating
 * it.
 */
export default async function MatchPage({
  params,
}: {
  params: Promise<{ eventId: string; teamId: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return <AccessDenied />;

  const { eventId, teamId } = await params;
  const t = await getTranslations("matches");
  const format = await getFormatter();

  let match;
  try {
    match = await getMatch(context, eventId, teamId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // Everything the shared event dialog needs, loaded only for someone who may
  // actually change the match.
  const canEditEvent = hasPermission(context, "calendar.update");
  const [squad, sheets, boxScores, provider, seasons, gyms, trainers, teams] = await Promise.all([
    listSquad(context, teamId),
    match.registerId ? listSheets(context, match.registerId) : Promise.resolve([]),
    match.registerId && match.tracksBoxScore
      ? listBoxScores(context, match.registerId)
      : Promise.resolve([]),
    // Asked here so the sheet card can say "no provider configured" rather than
    // offering a button that fails.
    hasPermission(context, "ai.read")
      ? getDefaultProvider(context).catch(() => null)
      : Promise.resolve(null),
    canEditEvent ? listSeasonOptions(context) : Promise.resolve([]),
    canEditEvent ? listGymOptions(context) : Promise.resolve([]),
    canEditEvent ? listTrainerOptions(context) : Promise.resolve([]),
    canEditEvent ? listTeamOptions(context) : Promise.resolve([]),
  ]);

  const eventOptions = {
    seasons: seasons.map((season) => ({ value: season.id, label: season.name })),
    gyms: gyms.map((gym) => ({ value: gym.id, label: gym.name })),
    trainers: trainers.map((trainer) => ({
      value: trainer.id,
      label: `${trainer.first_name} ${trainer.last_name}`,
    })),
    teams: teams.map((entry) => ({ value: entry.id, label: entry.name })),
    // What is typed is read on the club's clock, not the browser's.
    timeZone: context.tenant.timezone,
  };

  const nameById = new Map(squad.map((member) => [member.athleteId, member.name]));
  const canReadAthletes = hasPermission(context, "athletes.read");
  const subtitle = [
    format.dateTime(new Date(match.startsAt), {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }),
    match.gymName,
    match.competitionRef
      ? `${match.competitionRef.name} · ${t("matchday", { matchday: match.competitionRef.matchday })}`
      : match.competition,
  ]
    .filter(Boolean)
    .join(" · ");

  /*
    A referto gives makes and never attempts, so a REFERTO-sourced row has
    attempted = made. Showing a shooting percentage or a valutazione off that
    would be a confident lie, so the caveat is shown whenever any row on this
    match came from a sheet.
  */
  const fromSheet = boxScores.some((row) => row.source === "REFERTO");

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/matches">
          <ArrowLeft aria-hidden />
          {t("backToMatches")}
        </Link>
      </Button>

      <PageHeader
        title={`${match.teamName} — ${match.opponent}`}
        description={subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canEditEvent ? <EditMatchButton eventId={eventId} options={eventOptions} /> : null}
            {match.registerId ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/attendance/${match.registerId}`}>
                  <ClipboardCheck aria-hidden />
                  {t("openRegister")}
                </Link>
              </Button>
            ) : (
              <Badge variant="outline">{t("noRegister")}</Badge>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {match.isHome !== null ? (
          <Badge variant="secondary">{match.isHome ? t("home") : t("away")}</Badge>
        ) : null}
        {match.result && match.result.state !== "PENDING" ? (
          <Badge variant="outline">{t(match.result.state)}</Badge>
        ) : null}
        {match.result?.outcome ? (
          <Badge
            variant={
              match.result.outcome === "WIN"
                ? "default"
                : match.result.outcome === "DRAW"
                  ? "secondary"
                  : "destructive"
            }
          >
            {t(match.result.outcome)}
          </Badge>
        ) : null}
        {match.gymName ? (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            {match.gymName}
          </span>
        ) : null}
        {match.competitionRef ? (
          <Button variant="link" size="sm" asChild className="h-auto p-0">
            <Link href={`/competitions/${match.competitionRef.id}`}>
              {match.competitionRef.name}
            </Link>
          </Button>
        ) : null}
      </div>

      <ResultForm
        eventId={eventId}
        teamId={teamId}
        result={match.result}
        editable={match.editable}
      />

      {match.tracksBoxScore ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("boxScore")}</CardTitle>
            {fromSheet ? <CardDescription>{t("fromSheetCaveat")}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {boxScores.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("boxScoreEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("player")}</TableHead>
                      <TableHead className="text-end">{t("twos")}</TableHead>
                      <TableHead className="text-end">{t("threes")}</TableHead>
                      <TableHead className="text-end">{t("freeThrows")}</TableHead>
                      <TableHead className="text-end">{t("points")}</TableHead>
                      <TableHead className="text-end">{t("fouls")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {boxScores
                      .slice()
                      .sort((a, b) => b.points - a.points)
                      .map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {/*
                              Through to the player's own page, which is where
                              the season behind this one line is. Guarded on
                              athletes.read: a coach who may see a box score
                              does not necessarily have the athlete register.
                            */}
                            {canReadAthletes && nameById.has(row.athlete_id) ? (
                              <Link
                                href={`/athletes/${row.athlete_id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {nameById.get(row.athlete_id)}
                              </Link>
                            ) : (
                              (nameById.get(row.athlete_id) ?? "—")
                            )}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {row.two_point_made}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {row.three_point_made}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {row.free_throw_made}
                          </TableCell>
                          <TableCell className="text-end font-semibold tabular-nums">
                            {row.points}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {row.fouls_committed}
                          </TableCell>
                          <TableCell>
                            {row.source === "REFERTO" ? (
                              <Badge variant="outline" className="font-normal">
                                {t("fromSheet")}
                              </Badge>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {match.registerId ? (
              <Button variant="link" size="sm" asChild className="mt-3 h-auto p-0">
                <Link href={`/attendance/${match.registerId}`}>{t("editInRegister")}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <AlertDescription>{t("needsBoxScore")}</AlertDescription>
        </Alert>
      )}

      {match.tracksBoxScore ? (
        <SheetsCard
          registerId={match.registerId}
          sheets={sheets}
          squad={squad}
          canRecord={hasPermission(context, "attendance.record")}
          canManage={hasPermission(context, "attendance.manage")}
          canRead={hasPermission(context, "ai.read")}
          hasProvider={provider !== null}
          needsResult={match.result === null || match.result.state === "PENDING"}
        />
      ) : null}
    </div>
  );
}
