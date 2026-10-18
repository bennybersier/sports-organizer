import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamSeasonRecord } from "@/server/services/match-service";

/**
 * A team's record and form.
 *
 * Shown on both a team's page and a competition's, because "how are we doing"
 * is asked in both places and the answer is the same shape.
 *
 * The footnote is not boilerplate. Anybody looking at a won/lost column in a
 * league expects it to be part of a table, and it cannot be: a club sees only
 * its own fixtures, so every other club's record is unknown. Saying so once,
 * here, is cheaper than explaining it every season.
 */
export async function RecordCard({
  record,
  teamId,
  competitionId,
}: {
  record: TeamSeasonRecord;
  /** Links through to the filtered match list. */
  teamId: string;
  competitionId?: string;
}) {
  const t = await getTranslations("matches");

  const query = new URLSearchParams({
    team: teamId,
    ...(competitionId ? { competition: competitionId } : {}),
    scope: "played",
  });

  if (record.played === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="size-4" aria-hidden />
            {t("record")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("recordEmpty")}</CardContent>
      </Card>
    );
  }

  const perGame = record.perGame;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4" aria-hidden />
          {t("record")}
        </CardTitle>
        <CardDescription>
          {record.drawn > 0
            ? t("recordLineWithDraws", {
                won: record.won,
                lost: record.lost,
                drawn: record.drawn,
              })
            : t("recordLine", { won: record.won, lost: record.lost })}
          {record.streak && record.streak.length > 1
            ? ` · ${
                record.streak.outcome === "WIN"
                  ? t("streakWin", { length: record.streak.length })
                  : record.streak.outcome === "LOSS"
                    ? t("streakLoss", { length: record.streak.length })
                    : t("streakDraw", { length: record.streak.length })
              }`
            : ""}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-4">
          <Figure label={t("pointsFor")} value={record.pointsFor} />
          <Figure label={t("pointsAgainst")} value={record.pointsAgainst} />
          <Figure
            label={t("pointDifference")}
            value={record.pointDifference > 0 ? `+${record.pointDifference}` : record.pointDifference}
          />
        </dl>

        {perGame ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {t("perGame", {
              scored: perGame.scored.toFixed(1),
              conceded: perGame.conceded.toFixed(1),
            })}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {t("form")} · {t("formHint")}
          </p>
          <div className="flex flex-wrap gap-1">
            {record.form.map((outcome, index) => (
              <Badge
                key={index}
                variant={
                  outcome === "WIN" ? "default" : outcome === "DRAW" ? "secondary" : "destructive"
                }
                className="w-7 justify-center font-semibold"
                title={t(outcome)}
              >
                {t(outcome).charAt(0)}
              </Badge>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t("noLeagueTable")}</p>

        <Button variant="link" size="sm" asChild className="h-auto p-0">
          <Link href={`/matches?${query}`}>{t("scopePlayed")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
