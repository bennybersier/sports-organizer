import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { MapPin, Swords } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MatchListItem } from "@/server/services/match-service";

/**
 * A team's whole season of matches, played and still to come.
 *
 * It replaced a card that said "18" and listed eight of them. Truncating a
 * list whose own heading states its length is the worst of both: the number
 * tells you something is missing without saying what, and there was nowhere
 * to go and see the rest.
 *
 * So every match is here, in date order, with the two things that decide
 * whether a row is worth clicking — which competition it belongs to, and how
 * it finished.
 */
export async function TeamMatchTable({ matches }: { matches: MatchListItem[] }) {
  const t = await getTranslations("matches");
  const format = await getFormatter();

  if (matches.length === 0) return null;

  // Oldest first: a fixture list is read forwards, unlike a player's form.
  const ordered = [...matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const played = ordered.filter((match) => match.result?.outcome).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("seasonSummary", { total: ordered.length, played })}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t("date")}</TableHead>
              <TableHead>{t("opponent")}</TableHead>
              <TableHead>{t("competitionColumn")}</TableHead>
              <TableHead className="w-16 text-center">{t("venue")}</TableHead>
              <TableHead className="text-end">{t("result")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((match) => {
              const result = match.result;
              const decided = result?.ourScore != null && result.theirScore != null;
              return (
                <TableRow key={`${match.eventId}:${match.teamId}`}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                    {format.dateTime(new Date(match.startsAt), {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
                  </TableCell>

                  <TableCell>
                    <Link
                      href={`/matches/${match.eventId}/${match.teamId}`}
                      className="font-medium hover:underline"
                    >
                      {match.opponent}
                    </Link>
                    {match.gymName ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden />
                        {match.gymName}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {match.competition ?? "—"}
                  </TableCell>

                  <TableCell className="text-center">
                    {match.isHome === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Badge variant="outline" className="font-normal">
                        {match.isHome ? t("homeShort") : t("awayShort")}
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-end whitespace-nowrap">
                    {/* Not yet played is the normal state for most of a season. */}
                    {!decided ? (
                      <span className="text-sm text-muted-foreground">{t("notPlayedYet")}</span>
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        <span
                          className={cn(
                            "tabular-nums",
                            result!.outcome === "WIN" && "font-semibold",
                          )}
                        >
                          {result!.ourScore}–{result!.theirScore}
                        </span>
                        {result!.outcome ? (
                          <Badge
                            variant={
                              result!.outcome === "WIN"
                                ? "default"
                                : result!.outcome === "DRAW"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {t(result!.outcome)}
                          </Badge>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
