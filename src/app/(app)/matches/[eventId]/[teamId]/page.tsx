import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  FileImage,
  MapPin,
  Navigation,
  Star,
  Table2,
  Users,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { Disclosure } from "@/components/data/disclosure";
import { PageCrumb } from "@/components/layout/app-breadcrumb";
import { ShirtNumbersDialog } from "@/components/data/shirt-numbers-dialog";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { getMatch, listSquad } from "@/server/services/match-service";
import { getRegisterSheet } from "@/server/services/attendance-service";
import { BoxScoreEditor } from "@/components/attendance/box-score-editor";
import { RegisterSheetEditor } from "@/components/attendance/register-sheet";
import { RegisterStateActions } from "@/components/attendance/register-state-actions";
import { listSheets } from "@/server/services/match-sheet-service";
import { listBoxScores, listSelections } from "@/server/services/performance-service";
import { getDefaultProvider } from "@/server/services/ai-config-service";

import { EditMatchButton } from "./edit-match-button";
import { ResultForm } from "./result-form";
import { OpenSquadCard } from "./open-squad-card";
import { BoxScoreTable, type BoxScoreRow } from "./box-score-table";
import { PageTabPanel, PageTabs } from "@/components/data/page-tabs";
import { Scoreboard, ScoringSplit, ScoringTiles, SheetSummary } from "./match-summary";
import { OpponentBoxScore, OpponentThreats, readOpponent } from "./opponent-card";
import { SheetsCard } from "./sheets-card";

/**
 * How long this page's Server Actions may run, in seconds.
 *
 * Reading a game sheet is a vision-model call on a photograph, and those take
 * tens of seconds, not the handful a platform allows by default. When the
 * platform kills the request instead, the action never returns an error — the
 * browser is left with a dead request, the sheet stays UPLOADED and the person
 * sees nothing happen at all. Per the Next docs, the page-level value is what
 * governs every action invoked from it.
 *
 * 60s is the ceiling on Vercel's Hobby plan; a paid plan allows 300.
 */
export const maxDuration = 60;

/** Shared by the metadata and the page, so the match is read once. */
const loadMatch = cache(getMatch);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string; teamId: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return {};
  try {
    const { eventId, teamId } = await params;
    const match = await loadMatch(context, eventId, teamId);
    return {
      title:
        match.isHome === false
          ? `${match.opponent} vs ${match.teamName}`
          : `${match.teamName} vs ${match.opponent}`,
    };
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
 * finished, the photograph of the sheet, and the numbers that came off it.
 *
 * Laid out as a scoreboard over a set of tabs. The scoreboard is what anybody
 * opening a match wants first; the tabs hold the work — our box score, theirs,
 * the sheet being read, and the result and squad being entered.
 */
export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; teamId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return <AccessDenied />;

  const { eventId, teamId } = await params;
  const { tab: requestedTab } = await searchParams;
  const t = await getTranslations("matches");
  const format = await getFormatter();

  let match;
  try {
    match = await loadMatch(context, eventId, teamId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // The edit dialog's pickers are fetched when it opens, not with the page.
  const canEditEvent = hasPermission(context, "calendar.update");
  const [squad, sheets, boxScores, selections, provider, register] = await Promise.all([
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
    /*
      The squad sheet itself — who was called up, who started, who turned up.
      This used to be its own page under /attendance, which made a match two
      pages about the same ninety minutes. It is here now, and the register
      route redirects a match back to this page.
    */
    match.registerId ? getRegisterSheet(context, match.registerId) : Promise.resolve(null),
  ]);

  const canReadAthletes = hasPermission(context, "athletes.read");
  const canRecord = hasPermission(context, "attendance.record");
  const canEditTeam = hasPermission(context, "teams.update");

  const memberById = new Map(squad.map((member) => [member.athleteId, member]));
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
      member.jerseyNumber !== null ? `#${member.jerseyNumber} ${member.name}` : member.name,
    );
  const rows: BoxScoreRow[] = boxScores.map((row) => {
    const member = memberById.get(row.athlete_id);
    return {
      id: row.id,
      shirt: member?.jerseyNumber ?? null,
      name: member?.name ?? "—",
      // Guarded on athletes.read: a coach who may see a box score does not
      // necessarily have the athlete register.
      href: canReadAthletes && member ? `/athletes/${row.athlete_id}` : null,
      started: starters.has(row.athlete_id),
      twos: row.two_point_made,
      threes: row.three_point_made,
      freeThrows: row.free_throw_made,
      points: row.points,
      fouls: row.fouls_committed,
      fromSheet: row.source === "REFERTO",
    };
  });

  /*
    A referto gives makes and never attempts, so a REFERTO-sourced row has
    attempted = made. Showing a shooting percentage or a valutazione off that
    would be a confident lie, so the caveat is shown whenever any row on this
    match came from a sheet.
  */
  const fromSheet = rows.some((row) => row.fromSheet);

  // The most recent sheet that has been read, else the most recent at all.
  const readSheet = sheets.find((sheet) => sheet.reading !== null);
  const latestSheet = readSheet ?? sheets[0];
  /*
    The other side's scorers. Derived from the same sheet, and only ever from a
    sheet: a result typed in by hand has no opponent detail to show.
  */
  const opponent = readOpponent(readSheet);

  /*
    A saved hall with a street wins: it was picked on purpose, and correcting
    the hall corrects every match there. Text typed on the match fills in for
    a hall with no street on file, or no hall at all.
  */
  const address = match.gymHasStreet
    ? match.gymAddress
    : (match.location ?? match.gymAddress);

  const kickoff = format.dateTime(new Date(match.startsAt), {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const played = match.result !== null && match.result.state !== "PENDING";
  // Home side first, everywhere the two are written side by side.
  const awayMatch = match.isHome === false;
  // Our side's name leads to its team page, for whoever may open one.
  const teamHref = hasPermission(context, "teams.read") ? `/teams/${teamId}` : null;
  const teamLink = teamHref ? (
    <Link href={teamHref} className="underline-offset-4 hover:underline">
      {match.teamName}
    </Link>
  ) : (
    match.teamName
  );
  const fixtureTitle = awayMatch
    ? `${match.opponent} — ${match.teamName}`
    : `${match.teamName} — ${match.opponent}`;

  /*
    Which tab opens. Before the match there is nothing to read, so it opens on
    the result and the squad; afterwards, on the box score.
  */
  const tabs = [
    ...(match.tracksBoxScore
      ? [
          {
            value: "box",
            label: (
              <>
                <Table2 aria-hidden />
                {match.teamName}
                {played && match.result?.ourScore != null ? (
                  <TabCount>{match.result.ourScore}</TabCount>
                ) : null}
              </>
            ),
          },
        ]
      : []),
    ...(opponent
      ? [
          {
            value: "opponent",
            label: (
              <>
                <Users aria-hidden />
                {opponent.clubName ?? match.opponent}
                {played && match.result?.theirScore != null ? (
                  <TabCount>{match.result.theirScore}</TabCount>
                ) : null}
              </>
            ),
          },
        ]
      : []),
    ...(match.tracksBoxScore
      ? [
          {
            value: "sheet",
            label: (
              <>
                <FileImage aria-hidden />
                {t("sheets")}
                {sheets.length > 0 ? <TabCount>{sheets.length}</TabCount> : null}
              </>
            ),
          },
        ]
      : []),
    {
      value: "match",
      label: (
        <>
          <ClipboardList aria-hidden />
          {t("resultAndSquad")}
        </>
      ),
    },
  ];
  const fallbackTab = played && match.tracksBoxScore ? "box" : "match";
  const initialTab =
    typeof requestedTab === "string" && tabs.some((entry) => entry.value === requestedTab)
      ? requestedTab
      : fallbackTab;

  return (
    <div className="space-y-6">
      <PageCrumb title={fixtureTitle} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/matches">
            <ArrowLeft aria-hidden />
            {t("backToMatches")}
          </Link>
        </Button>
        {canEditEvent ? <EditMatchButton eventId={eventId} /> : null}
      </div>

      {/*
        On a phone this is just the line above the scoreboard — competition,
        kick-off, hall. The scoreboard names both sides and carries the result,
        so the title and badges would only say it twice.
      */}
      <Card className="max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:py-0 max-sm:shadow-none max-sm:ring-0">
        <CardContent className="space-y-3 max-sm:space-y-1.5 max-sm:px-0">
          <div className="flex flex-wrap items-center gap-2">
            {match.isHome !== null ? (
              <Badge variant="secondary" className="label-caps max-sm:hidden">
                {match.isHome ? t("home") : t("away")}
              </Badge>
            ) : null}
            {match.result && match.result.state !== "PENDING" ? (
              <Badge className="label-caps bg-blue-600 text-white max-sm:hidden">{t(match.result.state)}</Badge>
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
                className="label-caps max-sm:hidden"
              >
                {t(match.result.outcome)}
                {match.result.ourScore !== null && match.result.theirScore !== null
                  ? awayMatch
                    ? ` (${match.result.theirScore}–${match.result.ourScore})`
                    : ` (${match.result.ourScore}–${match.result.theirScore})`
                  : ""}
              </Badge>
            ) : null}
            {match.competitionRef ? (
              <Link
                href={`/competitions/${match.competitionRef.id}`}
                className="label-caps text-muted-foreground hover:underline"
              >
                {match.competitionRef.name} ·{" "}
                {t("matchday", { matchday: match.competitionRef.matchday })}
              </Link>
            ) : match.competition ? (
              <span className="label-caps text-muted-foreground">
                {match.competition}
              </span>
            ) : null}
          </div>

          <h1 className="max-sm:sr-only text-2xl leading-7 font-bold tracking-[-0.01em] text-balance sm:text-[32px] sm:leading-[38px] sm:tracking-[-0.02em]">
            {awayMatch ? match.opponent : teamLink}{" "}
            <span className="text-muted-foreground">—</span>{" "}
            {awayMatch ? teamLink : match.opponent}
          </h1>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground max-sm:text-xs">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4 text-orange-500" aria-hidden />
              {kickoff}
            </span>
            {match.gymName ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4 text-orange-500" aria-hidden />
                {match.gymName}
              </span>
            ) : null}
            {/*
              The address, straight into a map: the person reading it is
              usually about to drive there. A plain search link rather than an
              embedded map — nothing loads until someone asks for directions.
            */}
            {address ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  // The hall's name helps the search when the address is its own.
                  address === match.gymAddress
                    ? [match.gymName, address].filter(Boolean).join(", ")
                    : address,
                )}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
              >
                <Navigation className="size-4 text-orange-500" aria-hidden />
                {address}
              </a>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={match.tracksBoxScore ? "lg:col-span-2" : "lg:col-span-3"}>
          <Scoreboard
            teamName={match.teamName}
            teamHref={teamHref}
            opponent={match.opponent}
            isHome={match.isHome}
            result={match.result}
            kickoff={kickoff}
          />
        </div>
        {match.tracksBoxScore ? (
          <div className="hidden lg:block">
            <ScoringSplit rows={rows} />
          </div>
        ) : null}
      </div>

      {!match.tracksBoxScore ? (
        <Alert>
          <AlertDescription>{t("needsBoxScore")}</AlertDescription>
        </Alert>
      ) : null}

      <PageTabs initial={initialTab} tabs={tabs}>
        {match.tracksBoxScore ? (
          <PageTabPanel value="box">
            <div className="grid items-start gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t("ourBoxScore", { team: match.teamName })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {starterNames.length > 0 ? (
                    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-orange-500/50 text-orange-500">
                        <Star className="size-3.5" aria-hidden />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p className="label-caps text-orange-600 dark:text-orange-400">
                          {t("startingFive")}
                        </p>
                        <p className="text-sm font-medium">{starterNames.join(", ")}</p>
                      </div>
                    </div>
                  ) : null}
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("boxScoreEmpty")}</p>
                  ) : (
                    <BoxScoreTable rows={rows} />
                  )}
                  {fromSheet ? (
                    <Alert>
                      <AlertDescription className="text-xs">
                        {t("fromSheetCaveat")}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {/*
                    Typing the scoresheet in by hand, folded away. Most clubs
                    will let the referto import do it rather than open this.
                  */}
                  {register?.editable ? (
                    <Disclosure title={t("enterByHand")}>
                      <BoxScoreEditor
                        registerId={register.register.id}
                        lines={register.lines.filter((line) => line.calledUp)}
                        existing={boxScores}
                        editable={register.editable}
                      />
                    </Disclosure>
                  ) : null}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <div className="lg:hidden">
                  <ScoringTiles rows={rows} />
                </div>
                <SheetSummary sheet={latestSheet} />
                {opponent ? (
                  <OpponentThreats opponent={opponent} opponentName={match.opponent} />
                ) : null}
              </div>
            </div>
          </PageTabPanel>
        ) : null}

        {opponent ? (
          <PageTabPanel value="opponent">
            <OpponentBoxScore opponent={opponent} opponentName={match.opponent} />
          </PageTabPanel>
        ) : null}

        {match.tracksBoxScore ? (
          <PageTabPanel value="sheet">
            <SheetsCard
              eventId={eventId}
              teamId={teamId}
              registerId={match.registerId}
              sheets={sheets}
              squad={squad}
              canRecord={canRecord}
              canManage={hasPermission(context, "attendance.manage")}
              canRead={hasPermission(context, "ai.read")}
              hasProvider={provider !== null}
              needsResult={!played}
            />
          </PageTabPanel>
        ) : null}

        <PageTabPanel value="match">
          <div className="space-y-6">
            <ResultForm
              eventId={eventId}
              teamId={teamId}
              result={match.result}
              editable={match.editable}
            />

            {register ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/*
                    Here as well as on the team page: a player added to the
                    squad this week has no number, and this is where that shows.
                  */}
                  {canEditTeam && squad.length > 0 ? (
                    <ShirtNumbersDialog
                      teamId={teamId}
                      members={squad.map((member) => ({
                        id: member.athleteId,
                        name: member.name,
                        jerseyNumber: member.jerseyNumber,
                      }))}
                    />
                  ) : null}
                  <RegisterStateActions
                    registerId={register.register.id}
                    state={register.register.state}
                    canRecord={canRecord}
                    canManage={hasPermission(context, "attendance.manage")}
                  />
                </div>
                <RegisterSheetEditor
                  sheet={register}
                  callUp={{
                    clubName: context.tenant.name,
                    // Signed with a first name, as a coach would.
                    signature: context.user.fullName?.split(" ")[0] ?? "",
                    timeZone: context.tenant.timezone,
                  }}
                />
              </div>
            ) : (
              /*
                No register yet. Rather than sending somebody to another page to
                make one, the button makes it here — and uploading a sheet does
                the same, so a club that works off the photograph never has to
                think about registers at all.
              */
              <OpenSquadCard eventId={eventId} teamId={teamId} canRecord={canRecord} />
            )}
          </div>
        </PageTabPanel>
      </PageTabs>
    </div>
  );
}

/** The small count beside a tab's label. */
function TabCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-black/10 px-1.5 font-mono text-[11px] dark:bg-white/10">
      {children}
    </span>
  );
}
