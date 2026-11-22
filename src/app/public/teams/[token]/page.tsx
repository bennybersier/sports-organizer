import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight, Dumbbell, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getPublicTeamPage } from "@/server/services/public-team-service";

import { PublicMatchList } from "./match-list";
import { Venue } from "./venue";

/**
 * The parents' page: fixtures, results, squad and training for one team,
 * opened from a share link with no account. What it may show is decided in
 * `public-team-service.ts`; this file only lays it out, in the same design as
 * the team's page inside the app.
 */

/** Shared by the metadata and the page, so the token is looked up once. */
const load = cache(getPublicTeamPage);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const page = await load((await params).token);
  return page ? { title: `${page.team.name} · ${page.clubName}` } : {};
}

export default async function PublicTeamPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const page = await load(token);
  if (!page) notFound();

  const t = await getTranslations("publicTeam");
  const tTeams = await getTranslations("teams");
  const tMatches = await getTranslations("matches");
  const tGender = await getTranslations("gender");
  const format = await getFormatter();
  const timeZone = page.timeZone;

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { weekday: "short", day: "numeric", month: "short", timeZone });
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone });

  const subtitle = [
    page.team.sport,
    page.team.gender === "UNSPECIFIED" ? null : tGender(page.team.gender),
    page.team.ageGroup ?? page.team.category,
    page.team.season,
  ]
    .filter(Boolean)
    .join(" · ");

  const { record } = page;
  const total = page.upcoming.length + page.past.length;
  // The whole season's run, most recent first, as on the app's team page.
  const seasonForm = page.past
    .map((match) => match.result?.outcome)
    .filter((outcome) => outcome != null);

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="bg-linear-to-l from-orange-500/10 via-card to-card">
        <CardContent className="space-y-2">
          <p className="label-caps text-orange-600 dark:text-orange-400">{page.clubName}</p>
          <h1 className="flex items-center gap-3 text-[28px] leading-8 font-extrabold tracking-[-0.02em] text-balance sm:text-[40px] sm:leading-[44px] sm:tracking-[-0.03em]">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: page.team.color }}
              aria-hidden
            />
            {page.team.name}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          {page.homeVenue ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="label-caps text-muted-foreground">{t("homeVenue")}</span>
              <Venue venue={page.homeVenue} />
            </p>
          ) : null}
        </CardContent>
      </Card>

      {record.played > 0 ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="label-caps text-muted-foreground">
              {tTeams("trackRecord")}
            </CardTitle>
            <span className="label-caps text-muted-foreground">
              {tTeams("winPct")}{" "}
              <span className="text-orange-600 dark:text-orange-400">
                {Math.round((record.won / record.played) * 100)}%
              </span>
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
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
                  {tTeams("playedOf", { played: record.played, total })}
                </p>
              </div>
              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                <p className="label-caps text-muted-foreground">{tMatches("pointsFor")}</p>
                <p className="font-mono text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {record.pointsFor}
                </p>
                {record.perGame ? (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {tTeams("perGameAvg", { value: record.perGame.scored.toFixed(1) })}
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
                    {tTeams("perGameAvg", { value: record.perGame.conceded.toFixed(1) })}
                  </p>
                ) : null}
              </div>
              <div className="col-span-2 space-y-1 rounded-md border bg-muted/30 p-3 lg:col-span-1">
                <p className="label-caps text-muted-foreground">{tMatches("pointDifference")}</p>
                <p
                  className={cn(
                    "font-mono text-3xl font-bold",
                    record.pointDifference >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive",
                  )}
                >
                  {record.pointDifference > 0
                    ? `+${record.pointDifference}`
                    : record.pointDifference}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {tTeams("netPerGame", {
                    value: (record.pointDifference / record.played).toFixed(1),
                  })}
                </p>
              </div>
            </div>

            {seasonForm.length > 0 ? (
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
                      className={cn(
                        "flex size-8 items-center justify-center rounded font-mono text-xs font-bold",
                        outcome === "WIN" && "bg-emerald-600 text-white",
                        outcome === "LOSS" && "bg-red-700 text-white",
                        outcome === "DRAW" && "bg-muted",
                      )}
                    >
                      {tMatches(outcome).charAt(0)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <PublicMatchList
        token={token}
        upcoming={page.upcoming}
        played={page.past}
        timeZone={timeZone}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Dumbbell className="size-4 text-orange-500" aria-hidden />
              {t("training")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("trainingHint")}</p>
          </CardHeader>
          <CardContent>
            {page.training.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noTraining")}</p>
            ) : (
              <ul className="space-y-2">
                {page.training.map((session) => (
                  <li
                    key={session.startsAt}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border bg-muted/20 p-3",
                      session.cancelled && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className={cn("font-semibold", session.cancelled && "line-through")}>
                        {day(session.startsAt)}
                      </p>
                      {session.venue ? (
                        <p className="text-xs text-muted-foreground">
                          <Venue venue={session.venue} />
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 space-y-1 text-end">
                      <p className="font-mono text-sm font-semibold">
                        {time(session.startsAt)}–{time(session.endsAt)}
                      </p>
                      {session.cancelled ? (
                        <Badge variant="outline" className="label-caps">
                          {t("cancelled")}
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {page.roster.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="size-4 text-orange-500" aria-hidden />
                {t("roster")}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {page.roster.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-2">
                {page.roster.map((player) => (
                  <li key={player.athleteId}>
                    <Link
                      href={`/public/teams/${token}/players/${player.athleteId}`}
                      className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 hover:bg-muted/50"
                    >
                      <span className="truncate">{player.name}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {t("footer", { club: page.clubName, timeZone })}
      </p>
    </div>
  );
}
