import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SCROLLING_GRID } from "@/components/attendance/scrolling-grid";
import { cn } from "@/lib/utils";
import { getPublicMatchPage } from "@/server/services/public-team-service";
import { Scoreboard } from "@/app/(app)/matches/[eventId]/[teamId]/match-summary";

import { Venue } from "../../venue";

/**
 * One match on the parents' page: the app's own scoreboard, then the box
 * score with players named as on the squad list. What may appear is decided
 * in `public-team-service.ts`.
 */

const load = cache(getPublicMatchPage);

type Params = Promise<{ token: string; eventId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token, eventId } = await params;
  const page = await load(token, eventId);
  if (!page) return {};
  const t = await getTranslations("matches");
  return { title: `${page.teamName} ${t("versus", { opponent: page.match.opponent })}` };
}

export default async function PublicMatchPage({ params }: { params: Params }) {
  const { token, eventId } = await params;
  const page = await load(token, eventId);
  if (!page) notFound();

  const t = await getTranslations("publicTeam");
  const tMatches = await getTranslations("matches");
  const format = await getFormatter();
  const { match, boxScore } = page;
  const teamHref = `/public/teams/${token}`;

  const kickoff = format.dateTime(new Date(match.startsAt), {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: page.timeZone,
  });

  const top = Math.max(0, ...boxScore.filter((line) => line.name).map((line) => line.points));
  /*
    As in the app's table: the shirt column is as wide as its widest number,
    and on a phone the shirt and the name stay pinned while the figures scroll.
  */
  const digits = Math.max(1, ...boxScore.map((line) => String(line.shirt ?? "").length));
  const shirtWidth = `${digits * 0.5 + 0.75}rem`;
  const shirtStyle = {
    width: shirtWidth,
    minWidth: shirtWidth,
    maxWidth: shirtWidth,
    paddingInline: "0.375rem",
  };
  const nameStyle = { left: shirtWidth };
  const pinned = "max-sm:sticky max-sm:z-10 max-sm:bg-card";

  const total = (pick: (line: (typeof boxScore)[number]) => number) =>
    boxScore.reduce((sum, line) => sum + pick(line), 0);

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

      <Scoreboard
        teamName={page.teamName}
        teamHref={teamHref}
        opponent={match.opponent}
        isHome={match.isHome}
        // The coach's note on the result stays in the app.
        result={match.result ? { ...match.result, notes: null } : null}
        kickoff={kickoff}
      />

      {match.venue || match.competition ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
            {match.venue ? <Venue venue={match.venue} /> : null}
            {match.competition ? (
              <span className="label-caps text-muted-foreground">{match.competition}</span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {boxScore.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Table2 className="size-4 text-orange-500" aria-hidden />
              {tMatches("boxScore")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* A grid on a phone too, scrolling sideways: see SCROLLING_GRID. */}
            <div className={SCROLLING_GRID}>
              <Table className="[&_th]:label-caps">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className={cn("text-end max-sm:left-0", pinned)} style={shirtStyle}>
                      {tMatches("shirt")}
                    </TableHead>
                    <TableHead className={pinned} style={nameStyle}>
                      {tMatches("player")}
                    </TableHead>
                    <TableHead className="text-end">{tMatches("twos")}</TableHead>
                    <TableHead className="text-end">{tMatches("threes")}</TableHead>
                    <TableHead className="text-end">{tMatches("freeThrows")}</TableHead>
                    <TableHead className="text-end">{tMatches("points")}</TableHead>
                    <TableHead className="text-end">{tMatches("fouls")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boxScore.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell
                        className={cn("text-end font-mono text-muted-foreground max-sm:left-0", pinned)}
                        style={shirtStyle}
                      >
                        {line.shirt ?? (line.name ? "—" : "")}
                      </TableCell>
                      <TableCell className={cn("whitespace-nowrap", pinned)} style={nameStyle}>
                        <span className="flex items-center gap-1.5">
                          {line.name && line.athleteId ? (
                            <Link
                              href={`/public/teams/${token}/players/${line.athleteId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {line.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground italic">
                              {t("otherPlayers", { count: line.players })}
                            </span>
                          )}
                          {line.name && top > 0 && line.points === top ? (
                            <Badge className="label-caps bg-orange-500/15 text-orange-700 max-sm:hidden dark:text-orange-400">
                              {tMatches("topScorer")}
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-end font-mono">{line.twos}</TableCell>
                      <TableCell className="text-end font-mono">{line.threes}</TableCell>
                      <TableCell className="text-end font-mono">{line.freeThrows}</TableCell>
                      <TableCell className="text-end font-mono font-semibold">
                        {line.points}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        <span
                          className={cn(
                            line.players === 1 &&
                              line.fouls >= 5 &&
                              "font-semibold text-destructive",
                          )}
                        >
                          {line.fouls}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-semibold">
                    <TableCell className={cn("max-sm:left-0", pinned)} style={shirtStyle} />
                    <TableCell className={pinned} style={nameStyle}>
                      {tMatches("totals")}
                    </TableCell>
                    <TableCell className="text-end font-mono">{total((l) => l.twos)}</TableCell>
                    <TableCell className="text-end font-mono">{total((l) => l.threes)}</TableCell>
                    <TableCell className="text-end font-mono">
                      {total((l) => l.freeThrows)}
                    </TableCell>
                    <TableCell className="text-end font-mono">{total((l) => l.points)}</TableCell>
                    <TableCell className="text-end font-mono">{total((l) => l.fouls)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : match.result && match.result.state !== "PENDING" ? (
        <p className="text-center text-sm text-muted-foreground">{t("noBoxScore")}</p>
      ) : null}
    </div>
  );
}
