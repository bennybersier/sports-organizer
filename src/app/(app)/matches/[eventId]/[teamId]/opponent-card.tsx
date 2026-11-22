import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";

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
import { SCROLLING_GRID } from "@/components/attendance/scrolling-grid";
import { readTeam } from "@/domain/referto/reading";
import type { SheetView } from "@/server/services/match-sheet-service";

import { TabLink } from "@/components/data/page-tabs";

/**
 * How the other side scored, read off the same sheet.
 *
 * ## Why this reads the sheet rather than the database
 *
 * There are no rows to query. docs/referto-import.md §7 is deliberate about
 * it: only our own squadra is ever imported, because the opponent's block is a
 * list of another club's children and creating athlete records for them is not
 * ours to do. Their numbers exist only inside the transcription stored against
 * the photograph, and they are derived here, on the way to the screen.
 *
 * That has a consequence worth stating rather than hiding: a match whose
 * result was typed in by hand has no opponent detail, because there is no
 * sheet behind it. The card simply does not appear.
 *
 * ## Why the arithmetic is run again
 *
 * `readTeam` is pure and cheap, so the opponent's side gets the same treatment
 * ours did — the same nine checks, the same ladder arithmetic. A sheet can
 * reconcile for one team and not the other (a scorer's attention wanders down
 * one column, not both), and quoting an opponent total that the sheet
 * contradicts would be worse than quoting nothing. Where it fails, the figures
 * are withheld and the reason is shown.
 *
 * `readOpponent` derives their half; the two components below show it.
 */
export function readOpponent(sheet: SheetView | undefined) {
  if (!sheet?.transcription || !sheet.reading) return null;

  const theirSide = sheet.reading.side === "a" ? "b" : "a";
  const block = sheet.transcription.teams[theirSide];
  if (block.players.length === 0 && block.ladder.length === 0) return null;

  const reading = readTeam(block);
  const failures = reading.checks.filter((c) => c.severity === "HARD" && !c.passed);
  const scorers = reading.lines
    .filter((line) => line.points > 0)
    .map((line) => {
      const player = block.players.find((p) => p.shirt === line.shirt);
      return {
        ...line,
        name: player ? [player.surname, player.givenName].filter(Boolean).join(" ") : null,
      };
    });
  return { clubName: block.clubName, reading, failures, scorers };
}

export type OpponentReading = NonNullable<ReturnType<typeof readOpponent>>;

/** Their whole box score, for the opponent tab. */
export async function OpponentBoxScore({
  opponent,
  opponentName,
}: {
  opponent: OpponentReading;
  opponentName: string;
}) {
  const t = await getTranslations("matches");
  const { reading, failures, scorers } = opponent;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t("opponentSheet", { club: opponent.clubName ?? opponentName })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {failures.length > 0 ? (
          /*
            Their half of the sheet does not add up. Their players' lines are
            not shown at all rather than shown with a warning: a number nobody
            can stand behind is worse than an absence, and nothing here is ours
            to correct against the paper.
          */
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("opponentUnreadable")}</p>
            <ul className="list-disc space-y-1 ps-4 text-xs">
              {failures.map((check) => (
                <li key={check.id}>{check.detail}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            {/*
              A grid on a phone too, scrolling sideways, exactly as our own box
              score is: see SCROLLING_GRID. The shared Table turns into a stack
              of cards below lg, which is right for a list of records and wrong
              for this — a box score is read across a row and down a column at
              once, and twelve cards of six labelled numbers cannot be compared.
            */}
            <div className={SCROLLING_GRID}>
              <Table className="[&_th]:label-caps">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-px text-end">{t("shirt")}</TableHead>
                    <TableHead>{t("onSheet")}</TableHead>
                    <TableHead className="text-end">{t("twos")}</TableHead>
                    <TableHead className="text-end">{t("threes")}</TableHead>
                    <TableHead className="text-end">{t("freeThrows")}</TableHead>
                    <TableHead className="text-end">{t("points")}</TableHead>
                    <TableHead className="text-end">{t("fouls")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scorers
                    .slice()
                    .sort((a, b) => b.points - a.points)
                    .map((line) => (
                      <TableRow key={line.shirt}>
                        <TableCell className="text-end font-mono font-medium">
                          {line.shirt}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {line.name ?? "—"}
                          {line.starter ? (
                            <Badge variant="outline" className="ms-1.5 font-normal">
                              {t("starter")}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-end font-mono">{line.twoPointMade}</TableCell>
                        <TableCell className="text-end font-mono">
                          {line.threePointMade}
                        </TableCell>
                        <TableCell className="text-end font-mono">{line.freeThrowMade}</TableCell>
                        <TableCell className="text-end font-mono font-semibold">
                          {line.points}
                        </TableCell>
                        <TableCell className="text-end font-mono">
                          {line.foulsCommitted}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("opponentNotKept")}
              {reading.periods.length > 0
                ? ` · ${t("quarters")}: ${reading.periods.join(" · ")}`
                : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Their three leading scorers, beside our box score. */
export async function OpponentThreats({
  opponent,
  opponentName,
}: {
  opponent: OpponentReading;
  opponentName: string;
}) {
  const t = await getTranslations("matches");
  if (opponent.failures.length > 0) return null;
  const top = opponent.scorers
    .slice()
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);
  if (top.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-4 text-orange-500" aria-hidden />
          {t("opponentThreats")}
        </CardTitle>
        <span className="font-mono text-xs text-muted-foreground">
          {t("pointsTotal", { points: opponent.reading.points })}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">{opponent.clubName ?? opponentName}</p>
        <ul className="space-y-1.5">
          {top.map((line) => (
            <li
              key={line.shirt}
              className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <span className="w-8 font-mono text-xs text-muted-foreground">#{line.shirt}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{line.name ?? "—"}</span>
              <span className="font-mono font-semibold text-orange-600 dark:text-orange-400">
                {t("pointsTotal", { points: line.points })}
              </span>
            </li>
          ))}
        </ul>
        <TabLink
          value="opponent"
          className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
        >
          {t("viewOpponent")}
        </TabLink>
      </CardContent>
    </Card>
  );
}
