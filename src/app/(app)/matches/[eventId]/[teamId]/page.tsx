import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, MapPin, Star } from "lucide-react";

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
import { Disclosure } from "@/components/data/disclosure";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { getMatch, listSquad } from "@/server/services/match-service";
import { getRegisterSheet } from "@/server/services/attendance-service";
import { BoxScoreEditor } from "@/components/attendance/box-score-editor";
import { RegisterSheetEditor } from "@/components/attendance/register-sheet";
import { RegisterStateActions } from "@/components/attendance/register-state-actions";
import { SCROLLING_GRID } from "@/components/attendance/scrolling-grid";
import { listSheets } from "@/server/services/match-sheet-service";
import { listBoxScores, listSelections } from "@/server/services/performance-service";
import { getDefaultProvider } from "@/server/services/ai-config-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTeamOptions } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";

import { EditMatchButton } from "./edit-match-button";
import { ResultForm } from "./result-form";
import { OpenSquadCard } from "./open-squad-card";
import { OpponentCard } from "./opponent-card";
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
  const tAttendance = await getTranslations("attendance");
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
  const [
    squad, sheets, boxScores, selections, provider, seasons, gyms, trainers, teams, register,
  ] = await Promise.all([
    listSquad(context, teamId),
    match.registerId ? listSheets(context, match.registerId) : Promise.resolve([]),
    match.registerId && match.tracksBoxScore
      ? listBoxScores(context, match.registerId)
      : Promise.resolve([]),
    match.registerId ? listSelections(context, match.registerId) : Promise.resolve([]),
    // Asked here so the sheet card can say "no provider configured" rather than
    // offering a button that fails.
    hasPermission(context, "ai.read")
      ? getDefaultProvider(context).catch(() => null)
      : Promise.resolve(null),
    canEditEvent ? listSeasonOptions(context) : Promise.resolve([]),
    canEditEvent ? listGymOptions(context) : Promise.resolve([]),
    canEditEvent ? listTrainerOptions(context) : Promise.resolve([]),
    canEditEvent ? listTeamOptions(context) : Promise.resolve([]),
    /*
      The squad sheet itself — who was called up, who started, who turned up.
      This used to be its own page under /attendance, which made a match two
      pages about the same ninety minutes. It is here now, and the register
      route redirects a match back to this page.
    */
    match.registerId ? getRegisterSheet(context, match.registerId) : Promise.resolve(null),
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
  // The sheet identifies a scorer by shirt, so the table that comes off it
  // should read the same way round.
  const shirtById = new Map(squad.map((member) => [member.athleteId, member.jerseyNumber]));
  /*
    The starting five, which on a referto are the circled crosses in the E/N.
    column. Worth its own mark in the table: who finished with the points and
    who the coach actually trusted to start are different questions, and the
    second one is invisible in a column of totals.
  */
  const starters = new Set(
    selections.filter((selection) => selection.started).map((selection) => selection.athleteId),
  );
  const starterNames = squad
    .filter((member) => starters.has(member.athleteId))
    .map((member) =>
      member.jerseyNumber !== null ? `${member.jerseyNumber} ${member.name}` : member.name,
    );
  const canReadAthletes = hasPermission(context, "athletes.read");
  const canRecord = hasPermission(context, "attendance.record");
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
            {/*
              No link to the register any more: it is this page. Following one
              would redirect straight back here.
            */}
            {canEditEvent ? <EditMatchButton eventId={eventId} options={eventOptions} /> : null}
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
            {starterNames.length > 0 ? (
              <CardDescription>
                {t("startingFiveAre", { players: starterNames.join(", ") })}
              </CardDescription>
            ) : null}
            {fromSheet ? <CardDescription>{t("fromSheetCaveat")}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {boxScores.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("boxScoreEmpty")}</p>
            ) : (
              // A grid on a phone too, scrolling sideways: see SCROLLING_GRID.
              <div className={SCROLLING_GRID}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" aria-label={t("startingFive")} />
                      <TableHead className="w-12 text-end">{t("shirt")}</TableHead>
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
                          <TableCell className="pe-0">
                            {starters.has(row.athlete_id) ? (
                              <Star
                                className="size-3.5 fill-current text-amber-500"
                                aria-label={t("started")}
                              />
                            ) : null}
                          </TableCell>
                          {/* The sheet names a scorer by shirt, so this reads the same way round. */}
                          <TableCell className="text-end tabular-nums text-muted-foreground">
                            {shirtById.get(row.athlete_id) ?? "—"}
                          </TableCell>
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
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <AlertDescription>{t("needsBoxScore")}</AlertDescription>
        </Alert>
      )}

      {/*
        The other side's scorers, directly beneath ours so the two can be read
        against each other — which is the whole reason to want them. Derived
        from the same sheet, and only ever from a sheet: a result typed in by
        hand has no opponent detail to show.
      */}
      {(() => {
        const read = sheets.find((sheet) => sheet.reading !== null);
        return read ? <OpponentCard sheet={read} opponentName={match.opponent} /> : null;
      })()}

      {register ? (
        <>
          {/*
            Folded away by default once the sheet is recorded. Picking the
            squad is Saturday's job and reading the result is Sunday's; after
            the match this is twelve rows somebody has already finished with,
            sitting between the score and the game sheet. It opens on its own
            while there is still work in it.
          */}
          <Disclosure
            title={tAttendance("squadSelection")}
            meta={tAttendance("calledNoLimit", {
              called: register.lines.filter((line) => line.calledUp).length,
            })}
            defaultOpen={register.register.state !== "RECORDED"}
          >
            <div className="space-y-4">
              <div className="flex justify-end">
                <RegisterStateActions
                  registerId={register.register.id}
                  state={register.register.state}
                  canRecord={hasPermission(context, "attendance.record")}
                  canManage={hasPermission(context, "attendance.manage")}
                />
              </div>
              <RegisterSheetEditor sheet={register} />
            </div>
          </Disclosure>

          {/*
            Typing the scoresheet in by hand, folded away. The table above is
            how it is read; this is how it is entered, and most clubs will let
            the referto import do it rather than open this at all.
          */}
          {match.tracksBoxScore && register.editable ? (
            <Disclosure title={t("enterByHand")}>
              <BoxScoreEditor
                registerId={register.register.id}
                lines={register.lines.filter((line) => line.calledUp)}
                existing={boxScores}
                editable={register.editable}
              />
            </Disclosure>
          ) : null}
        </>
      ) : (
        /*
          No register yet. Rather than sending somebody to another page to make
          one, the button makes it here — and uploading a sheet does the same,
          so a club that works off the photograph never has to think about
          registers at all.
        */
        <OpenSquadCard eventId={eventId} teamId={teamId} canRecord={canRecord} />
      )}

      {!match.tracksBoxScore ? (
        <Alert>
          <AlertDescription>{t("needsBoxScore")}</AlertDescription>
        </Alert>
      ) : null}

      {match.tracksBoxScore ? (
        <SheetsCard
          eventId={eventId}
          teamId={teamId}
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
