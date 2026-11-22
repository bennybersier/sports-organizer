import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AthleteMatchLine } from "@/server/services/match-service";

import { PointsChart } from "./points-chart";
import { SectionChip, SectionHeader } from "./section";

/** Points per match, as a line — the shape of the season before its detail. */
export async function PointsTrendCard({
  index,
  matches,
}: {
  index: number;
  matches: AthleteMatchLine[];
}) {
  const t = await getTranslations("attendance");
  const tAthletes = await getTranslations("athletes");
  const format = await getFormatter();

  // The chart needs two points to be a line.
  if (matches.length < 2) return null;

  const mean = matches.reduce((sum, match) => sum + match.points, 0) / matches.length;
  // Most recent first, as the service returns them.
  const latest = matches[0];
  const earliest = matches[matches.length - 1];
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: "numeric", month: "short" });

  return (
    <Card className="h-full">
      <SectionHeader
        index={index}
        eyebrow={tAthletes("trendEyebrow")}
        title={t("stats.pointsPerMatch")}
        aside={
          <span className="flex items-center gap-2">
            <span className="label-caps text-muted-foreground">{tAthletes("avg")}</span>
            <SectionChip>{mean.toFixed(1)}</SectionChip>
          </span>
        }
      />
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/20 p-2">
          <PointsChart matches={matches} />
        </div>
        <div className="label-caps flex flex-wrap justify-between gap-2 text-muted-foreground">
          <span>{tAthletes("range", { from: day(earliest.startsAt), to: day(latest.startsAt) })}</span>
          <span>{tAthletes("latest", { points: latest.points })}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The matches behind the averages, each one a link back to the match.
 *
 * The counterpart to clicking a name in a match's box score: a per-game average
 * is only trustworthy if you can see the games it is made of, and the game a
 * coach wants is almost always "the one where he got 24" — which is why the
 * best night is picked out in orange.
 *
 * Columns that a game sheet cannot fill show "·" rather than 0 for the rows
 * that came from one. A zero would say the player took no rebounds; the dot
 * says nobody recorded any. The difference is the whole reason
 * `AthleteMatchLine.detail` is nullable.
 */
export async function MatchLogCard({
  index,
  matches,
}: {
  index: number;
  matches: AthleteMatchLine[];
}) {
  const t = await getTranslations("attendance");
  const tMatches = await getTranslations("matches");
  const tAthletes = await getTranslations("athletes");
  const format = await getFormatter();

  if (matches.length === 0) return null;

  // Only worth the columns if at least one match recorded them.
  const anyDetail = matches.some((match) => match.detail !== null);
  const best = Math.max(...matches.map((match) => match.points));

  /*
    One grid for the header and every row, so the columns line up without a
    table. On a phone the points and fouls share a column, stacked, and the
    full-stat columns are left to the wider layout.
  */
  const columns = cn(
    "grid items-center gap-x-3",
    "grid-cols-[minmax(0,1fr)_auto_auto]",
    anyDetail
      ? "sm:grid-cols-[minmax(0,1fr)_5rem_3.5rem_3.5rem] lg:grid-cols-[minmax(0,1fr)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_3.5rem]"
      : "sm:grid-cols-[minmax(0,1fr)_5rem_3.5rem_3.5rem]",
  );
  const detailCell = "hidden text-end font-mono text-sm lg:block";

  return (
    <Card className="h-full">
      <SectionHeader
        index={index}
        eyebrow={tAthletes("logEyebrow")}
        title={t("stats.matchLog")}
        aside={
          <span className="label-caps text-muted-foreground">
            {tAthletes("matchesCount", { count: matches.length })}
          </span>
        }
      />
      <CardContent>
        <div
          className={cn(
            columns,
            "label-caps hidden rounded-t-md bg-muted/50 px-3 py-2 text-muted-foreground sm:grid",
          )}
        >
          <span>{tMatches("opponent")}</span>
          <span className="text-end">{tMatches("result")}</span>
          <span className="text-end">{t("stats.points")}</span>
          <span className="text-end">{t("stats.fouls")}</span>
          {anyDetail ? (
            <>
              <span className="hidden text-end lg:block">{t("stats.rebounds")}</span>
              <span className="hidden text-end lg:block">{t("stats.assists")}</span>
              <span className="hidden text-end lg:block">{t("stats.minutes")}</span>
            </>
          ) : null}
        </div>

        <ul className="divide-y rounded-md border sm:rounded-t-none sm:border-t-0">
          {matches.map((match) => (
            <li key={`${match.eventId}:${match.teamId}`}>
              <Link
                href={`/matches/${match.eventId}/${match.teamId}`}
                className={cn(columns, "px-3 py-2.5 transition-colors hover:bg-muted/40")}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{match.opponent}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {format.dateTime(new Date(match.startsAt), { day: "numeric", month: "short" })}
                    {match.isHome !== null
                      ? ` · ${tMatches(match.isHome ? "home" : "away")}`
                      : ""}
                    <span className="hidden sm:inline">{` · ${match.teamName}`}</span>
                  </span>
                </span>

                <span className="text-end">
                  {match.result ? (
                    <span
                      className={cn(
                        "inline-block rounded px-2 py-0.5 font-mono text-xs font-semibold",
                        match.result.outcome === "WIN" &&
                          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                        match.result.outcome === "LOSS" && "bg-destructive/15 text-destructive",
                        match.result.outcome === "DRAW" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {/* Ours first: this is the player's own record. */}
                      {match.result.ourScore}–{match.result.theirScore}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>

                {/* A phone stacks the two figures in one column. */}
                <span className="text-end sm:contents">
                  <span
                    className={cn(
                      "block font-mono text-sm font-semibold sm:text-end",
                      match.points === best && best > 0 && "text-orange-600 dark:text-orange-400",
                    )}
                  >
                    {match.points}
                    <span className="label-caps ms-1 text-muted-foreground sm:hidden">
                      {tAthletes("ptsShort")}
                    </span>
                  </span>
                  <span className="block font-mono text-sm text-muted-foreground sm:text-end sm:text-foreground">
                    {match.fouls}
                    <span className="label-caps ms-1 sm:hidden">{tAthletes("foulsShort")}</span>
                  </span>
                </span>

                {anyDetail ? (
                  <>
                    <Unknowable className={detailCell} value={match.detail?.rebounds} />
                    <Unknowable className={detailCell} value={match.detail?.assists} />
                    <Unknowable
                      className={detailCell}
                      value={match.detail ? Math.round(match.detail.minutes) : undefined}
                    />
                  </>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * A figure this row's source could not record.
 *
 * "·" rather than "0" or an empty cell: a zero is a claim about the player, and
 * a blank reads as a rendering bug.
 */
function Unknowable({ value, className }: { value: number | undefined; className: string }) {
  return (
    <span className={className}>
      {value === undefined ? <span className="text-muted-foreground">·</span> : value}
    </span>
  );
}
