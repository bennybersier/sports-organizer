import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Swords } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AthleteMatchLine } from "@/server/services/match-service";

import { PointsChart } from "./points-chart";

/**
 * The matches behind the averages, each one a link back to the match.
 *
 * The counterpart to clicking a name in a match's box score: a per-game average
 * is only trustworthy if you can see the games it is made of, and the game a
 * coach wants is almost always "the one where he got 24".
 *
 * Columns that a game sheet cannot fill show "·" rather than 0 for the rows
 * that came from one. A zero would say the player took no rebounds; the dot
 * says nobody recorded any. The difference is the whole reason
 * `AthleteMatchLine.detail` is nullable.
 */
export async function MatchLogCard({ matches }: { matches: AthleteMatchLine[] }) {
  const t = await getTranslations("attendance");
  const tMatches = await getTranslations("matches");
  const format = await getFormatter();

  if (matches.length === 0) return null;

  // Only worth the columns if at least one match recorded them.
  const anyDetail = matches.some((match) => match.detail !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="size-4" aria-hidden />
          {t("stats.matchLog")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 sm:px-6">
        {/* The chart, and directly beneath it the table it is drawn from —
            which is what keeps every plotted value reachable without hovering. */}
        <PointsChart matches={matches} />

        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tMatches("opponent")}</TableHead>
              <TableHead className="text-end">{tMatches("result")}</TableHead>
              <TableHead className="text-end">{t("stats.points")}</TableHead>
              <TableHead className="text-end">{t("stats.fouls")}</TableHead>
              {anyDetail ? (
                <>
                  <TableHead className="text-end">{t("stats.rebounds")}</TableHead>
                  <TableHead className="text-end">{t("stats.assists")}</TableHead>
                  <TableHead className="text-end">{t("stats.minutes")}</TableHead>
                </>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((match) => (
              <TableRow key={`${match.eventId}:${match.teamId}`}>
                <TableCell variant="primary">
                  <Link
                    href={`/matches/${match.eventId}/${match.teamId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {match.opponent}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(match.startsAt), {
                      day: "numeric",
                      month: "short",
                    })}
                    {match.isHome !== null
                      ? ` · ${tMatches(match.isHome ? "home" : "away")}`
                      : ""}
                    {` · ${match.teamName}`}
                  </p>
                </TableCell>
                <TableCell data-label={tMatches("result")} className="text-end">
                  {match.result ? (
                    <Badge
                      variant={
                        match.result.outcome === "WIN"
                          ? "default"
                          : match.result.outcome === "DRAW"
                            ? "secondary"
                            : "destructive"
                      }
                      className="tabular-nums"
                    >
                      {match.result.ourScore}–{match.result.theirScore}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell data-label={t("stats.points")} className="text-end font-semibold tabular-nums">
                  {match.points}
                </TableCell>
                <TableCell data-label={t("stats.fouls")} className="text-end tabular-nums">
                  {match.fouls}
                </TableCell>
                {anyDetail ? (
                  <>
                    <Unknowable label={t("stats.rebounds")} value={match.detail?.rebounds} />
                    <Unknowable label={t("stats.assists")} value={match.detail?.assists} />
                    <Unknowable
                      label={t("stats.minutes")}
                      value={match.detail ? Math.round(match.detail.minutes) : undefined}
                    />
                  </>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </div>
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
function Unknowable({ label, value }: { label: string; value: number | undefined }) {
  return (
    <TableCell data-label={label} className="text-end tabular-nums">
      {value === undefined ? <span className="text-muted-foreground">·</span> : value}
    </TableCell>
  );
}
