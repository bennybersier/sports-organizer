import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getPublicPlayerPage } from "@/server/services/public-team-service";
import type { AthleteMatchLine } from "@/server/services/match-service";
import { PointsTrendCard } from "@/app/(app)/athletes/[id]/match-log-card";
import { SectionChip, SectionHeader, StatTile } from "@/app/(app)/athletes/[id]/section";

/**
 * One player on the parents' page: their scoring for this team, in the same
 * cards as the athlete page inside the app — only the figures a scoresheet
 * records, and only this team's matches. Who may appear is decided in
 * `public-team-service.ts`.
 */

const load = cache(getPublicPlayerPage);

type Params = Promise<{ token: string; athleteId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token, athleteId } = await params;
  const page = await load(token, athleteId);
  return page ? { title: `${page.name} · ${page.teamName}` } : {};
}

export default async function PublicPlayerPage({ params }: { params: Params }) {
  const { token, athleteId } = await params;
  const page = await load(token, athleteId);
  if (!page) notFound();

  const t = await getTranslations("attendance");
  const tAthletes = await getTranslations("athletes");
  const tMatches = await getTranslations("matches");
  const tPublic = await getTranslations("publicTeam");
  const format = await getFormatter();
  const { matches } = page;
  const teamHref = `/public/teams/${token}`;

  const games = matches.length;
  const sum = (pick: (match: (typeof matches)[number]) => number) =>
    matches.reduce((total, match) => total + pick(match), 0);
  const points = sum((match) => match.points);
  const fouls = sum((match) => match.fouls);
  const best = Math.max(0, ...matches.map((match) => match.points));

  // The app's points chart, fed the same shape the athlete page gives it.
  const chartLines: AthleteMatchLine[] = matches.map((match) => ({
    eventId: match.eventId,
    teamId: "",
    teamName: page.teamName,
    startsAt: match.startsAt,
    opponent: match.opponent,
    isHome: match.isHome,
    result: match.result,
    points: match.points,
    fouls: match.fouls,
    twoPointMade: match.twos,
    threePointMade: match.threes,
    freeThrowMade: match.freeThrows,
    detail: null,
  }));

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="label-caps -ml-2 w-fit">
          <Link href={teamHref}>
            <ArrowLeft aria-hidden />
            {page.teamName}
          </Link>
        </Button>
        <p className="label-caps text-orange-600 dark:text-orange-400">{page.clubName}</p>
      </div>

      <Card className="bg-linear-to-l from-orange-500/10 via-card to-card">
        <CardContent className="flex items-center gap-4">
          {page.shirt !== null ? (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 font-mono text-2xl font-bold text-orange-700 dark:text-orange-400">
              {page.shirt}
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <h1 className="text-[28px] leading-8 font-extrabold tracking-[-0.02em] sm:text-[40px] sm:leading-[44px] sm:tracking-[-0.03em]">
              {page.name}
            </h1>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: page.teamColor }}
                aria-hidden
              />
              {page.teamName}
            </p>
          </div>
        </CardContent>
      </Card>

      {games === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tPublic("noPlayerStats")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="h-full">
              <SectionHeader
                index={1}
                eyebrow={tAthletes("scoringEyebrow")}
                title={tAthletes("scoringTitle")}
                aside={<SectionChip>{tAthletes("gamesLogged", { count: games })}</SectionChip>}
              />
              <CardContent>
                {/* As on the athlete page: averages, then the baskets behind them. */}
                <div className="grid grid-cols-6 gap-2">
                  <div className="col-span-3">
                    <StatTile
                      label={t("stats.points")}
                      value={(points / games).toFixed(1)}
                      hint={`${t("stats.perGame")} · ${points} ${tAthletes("ptsShort")}`}
                      tone="accent"
                    />
                  </div>
                  <div className="col-span-3">
                    <StatTile
                      label={t("stats.fouls")}
                      value={(fouls / games).toFixed(1)}
                      hint={t("stats.perGame")}
                    />
                  </div>
                  <div className="col-span-2">
                    <StatTile
                      label={t("stats.twoPoint")}
                      value={String(sum((match) => match.twos))}
                      hint={t("stats.made")}
                      tone="positive"
                    />
                  </div>
                  <div className="col-span-2">
                    <StatTile
                      label={t("stats.threePoint")}
                      value={String(sum((match) => match.threes))}
                      hint={t("stats.made")}
                      tone="info"
                    />
                  </div>
                  <div className="col-span-2">
                    <StatTile
                      label={tMatches("freeThrows")}
                      value={String(sum((match) => match.freeThrows))}
                      hint={t("stats.made")}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <PointsTrendCard index={2} matches={chartLines} />
          </div>

          <Card>
            <SectionHeader
              index={3}
              eyebrow={tAthletes("logEyebrow")}
              title={t("stats.matchLog")}
              aside={
                <span className="label-caps text-muted-foreground">
                  {tAthletes("matchesCount", { count: games })}
                </span>
              }
            />
            <CardContent>
              {/* The app's match log, with the scoresheet columns only. */}
              <div className="label-caps hidden grid-cols-[minmax(0,1fr)_5rem_3rem_3rem_3rem_3.5rem_3.5rem] items-center gap-x-3 rounded-t-md bg-muted/50 px-3 py-2 text-muted-foreground sm:grid">
                <span>{tMatches("opponent")}</span>
                <span className="text-end">{tMatches("result")}</span>
                <span className="text-end">{tMatches("twos")}</span>
                <span className="text-end">{tMatches("threes")}</span>
                <span className="text-end">{tMatches("freeThrows")}</span>
                <span className="text-end">{t("stats.points")}</span>
                <span className="text-end">{t("stats.fouls")}</span>
              </div>
              <ul className="divide-y rounded-md border sm:rounded-t-none sm:border-t-0">
                {matches.map((match) => (
                  <li key={match.eventId}>
                    <Link
                      href={`${teamHref}/matches/${match.eventId}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2.5 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_5rem_3rem_3rem_3rem_3.5rem_3.5rem]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {match.opponent}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {format.dateTime(new Date(match.startsAt), {
                            day: "numeric",
                            month: "short",
                            timeZone: page.timeZone,
                          })}
                          {match.isHome !== null
                            ? ` · ${tMatches(match.isHome ? "home" : "away")}`
                            : ""}
                        </span>
                      </span>
                      <span className="text-end">
                        {match.result ? (
                          <span
                            className={cn(
                              "inline-block rounded px-2 py-0.5 font-mono text-xs font-semibold",
                              match.result.outcome === "WIN" &&
                                "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                              match.result.outcome === "LOSS" &&
                                "bg-destructive/15 text-destructive",
                              match.result.outcome === "DRAW" && "bg-muted text-muted-foreground",
                            )}
                          >
                            {match.result.ourScore}–{match.result.theirScore}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                      <span className="hidden text-end font-mono text-sm sm:block">
                        {match.twos}
                      </span>
                      <span className="hidden text-end font-mono text-sm sm:block">
                        {match.threes}
                      </span>
                      <span className="hidden text-end font-mono text-sm sm:block">
                        {match.freeThrows}
                      </span>
                      {/* A phone shows the points alone, with the fouls beneath. */}
                      <span className="text-end sm:contents">
                        <span
                          className={cn(
                            "block font-mono text-sm font-semibold sm:text-end",
                            match.points === best &&
                              best > 0 &&
                              "text-orange-600 dark:text-orange-400",
                          )}
                        >
                          {match.points}
                          <span className="label-caps ms-1 text-muted-foreground sm:hidden">
                            {tAthletes("ptsShort")}
                          </span>
                        </span>
                        <span className="block font-mono text-sm text-muted-foreground sm:text-end sm:text-foreground">
                          {match.fouls}
                          <span className="label-caps ms-1 sm:hidden">
                            {tAthletes("foulsShort")}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
