import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Info, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { AthletePerformance } from "@/server/services/performance-service";

import { SectionChip, SectionHeader, StatTile } from "./section";

/**
 * One player's season, as two cards: how often they come and are picked, and
 * what they do when they play.
 *
 * Deliberately three readings rather than one score: how often they come, how
 * often they are picked, and how the first of those has moved month by month.
 * A single "82%" tells a coach nothing they can act on; a bar that was full
 * until Christmas and half-empty since is a conversation with a parent.
 *
 * Every ratio renders as "—" when its denominator is zero. A player who joined
 * a fortnight ago has no turnout, and showing 0% is how a report loses its
 * reader.
 */
export async function AttendanceCard({
  index,
  performance,
  action,
}: {
  index: number;
  performance: AthletePerformance;
  /** Rendered in the header — writing an assessment, where permitted. */
  action?: ReactNode;
}) {
  const t = await getTranslations("attendance");
  const tAthletes = await getTranslations("athletes");
  const { training, matches, trend, evaluations } = performance;

  const nothingYet = training.eligible === 0 && matches.eligible === 0;

  return (
    <Card className="h-full">
      <SectionHeader
        index={index}
        eyebrow={tAthletes("attendanceEyebrow")}
        title={tAthletes("availabilityTitle")}
        aside={action}
      />
      <CardContent className="space-y-6">
        {nothingYet ? (
          <p className="text-sm text-muted-foreground">{t("stats.noData")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label={t("stats.turnout")}
                value={training.turnout === null ? "—" : `${Math.round(training.turnout * 100)}%`}
                hint={`${training.present + training.late}/${training.eligible} ${t("stats.sessions").toLowerCase()}`}
              />
              <StatTile
                label={t("stats.absent")}
                value={String(training.unexplained)}
                hint={`${training.excused} ${t("stats.excused").toLowerCase()}`}
                tone={training.unexplained > 0 ? "warn" : "default"}
              />
              <StatTile
                label={t("stats.calledUp")}
                value={matches.eligible === 0 ? "—" : `${matches.calledUp}/${matches.eligible}`}
                hint={`${matches.started} ${t("stats.started").toLowerCase()}`}
                tone="positive"
              />
              <StatTile
                label={t("stats.played")}
                value={String(matches.played)}
                hint={`${matches.benched} ${t("stats.benched").toLowerCase()}`}
              />
            </div>

            {trend.length > 1 ? (
              <div className="space-y-2">
                <p className="label-caps text-muted-foreground">{t("stats.turnout")}</p>
                <div className="space-y-1.5">
                  {trend.map((month) => (
                    <div key={month.month} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                        {month.month}
                      </span>
                      <Progress
                        value={month.turnout * 100}
                        className="h-1.5 flex-1 *:data-[slot=progress-indicator]:bg-orange-500"
                      />
                      <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {month.attended}/{month.eligible}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        {evaluations.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="label-caps text-muted-foreground">{t("evaluation.title")}</p>
              {evaluations.slice(-2).map((evaluation) => (
                <div key={evaluation.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {evaluation.period_start} → {evaluation.period_end}
                    </Badge>
                    <Rating label={t("evaluation.technique")} value={evaluation.technique} />
                    <Rating label={t("evaluation.tactical")} value={evaluation.tactical} />
                    <Rating label={t("evaluation.physical")} value={evaluation.physical} />
                    <Rating label={t("evaluation.attitude")} value={evaluation.attitude} />
                  </div>
                  {evaluation.strengths ? (
                    <p className="mt-2 text-sm">{evaluation.strengths}</p>
                  ) : null}
                  {evaluation.development ? (
                    <p className="mt-1 text-sm text-muted-foreground">{evaluation.development}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * What they do when they play.
 *
 * Two blocks, and the split is the point. The first holds what a game sheet
 * can tell you, so it is averaged over every match. The second holds what only
 * a full stat entry can, and is averaged over just those matches — showing a
 * rebound average that includes ten referto games would be a claim about the
 * player rather than about the paperwork.
 */
export async function ScoringCard({
  index,
  boxScore,
}: {
  index: number;
  boxScore: NonNullable<AthletePerformance["boxScore"]>;
}) {
  const t = await getTranslations("attendance");
  const tAthletes = await getTranslations("athletes");

  return (
    <Card className="h-full">
      <SectionHeader
        index={index}
        eyebrow={tAthletes("scoringEyebrow")}
        title={tAthletes("scoringTitle")}
        aside={<SectionChip>{tAthletes("gamesLogged", { count: boxScore.games })}</SectionChip>}
      />
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            label={t("stats.points")}
            value={boxScore.perGame.points.toFixed(1)}
            hint={`${t("stats.perGame")} · ${boxScore.games} ${t("stats.games").toLowerCase()}`}
            tone="accent"
          />
          <StatTile
            label={t("stats.fouls")}
            value={boxScore.perGame.fouls.toFixed(1)}
            hint={t("stats.perGame")}
          />
          <StatTile
            label={t("stats.twoPoint")}
            value={String(boxScore.basic.twoPointMade)}
            hint={t("stats.made")}
            tone="positive"
          />
          <StatTile
            label={t("stats.threePoint")}
            value={String(boxScore.basic.threePointMade)}
            hint={t("stats.made")}
            tone="info"
          />
        </div>

        {boxScore.detail ? (
          <div className="space-y-2">
            <p className="label-caps text-muted-foreground">
              {boxScore.detail.games === 1
                ? t("stats.fullStatsOne")
                : t("stats.fullStats", {
                    games: boxScore.detail.games,
                    total: boxScore.games,
                  })}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                label={t("stats.rebounds")}
                value={boxScore.detail.perGame.rebounds.toFixed(1)}
                hint={t("stats.perGame")}
              />
              <StatTile
                label={t("stats.assists")}
                value={boxScore.detail.perGame.assists.toFixed(1)}
                hint={t("stats.perGame")}
              />
              <StatTile
                label={t("stats.steals")}
                value={boxScore.detail.perGame.steals.toFixed(1)}
                hint={t("stats.perGame")}
              />
              <StatTile
                label={t("stats.turnovers")}
                value={boxScore.detail.perGame.turnovers.toFixed(1)}
                hint={t("stats.perGame")}
              />
              <StatTile
                label={t("stats.minutes")}
                value={boxScore.detail.perGame.minutes.toFixed(0)}
                hint={t("stats.perGame")}
              />
              <StatTile
                label={t("stats.efficiency")}
                value={boxScore.detail.perGame.efficiency.toFixed(1)}
                hint={t("stats.perGame")}
              />
              <StatTile
                label={t("stats.twoPoint")}
                value={percent(boxScore.detail.shooting.twoPoint)}
                hint={t("stats.shooting")}
              />
              <StatTile
                label={t("stats.threePoint")}
                value={percent(boxScore.detail.shooting.threePoint)}
                hint={t("stats.shooting")}
              />
            </div>
          </div>
        ) : null}

        {/*
          Why some figures are missing. Every game off a sheet means no rebound
          average, no percentage and no valutazione; saying so is the point — an
          empty space reads as a bug, and a "0.0" reads as a fact.
        */}
        {!boxScore.detail || boxScore.sheetGames > 0 ? (
          <p className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {boxScore.detail
              ? t("stats.sheetSome", { sheetGames: boxScore.sheetGames, games: boxScore.games })
              : t("stats.sheetOnly")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A fraction as a percentage, or nothing where there is no denominator. */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function Rating({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Star className="size-3 fill-current text-amber-500" aria-hidden />
      <span className="font-mono font-medium text-foreground">{value}</span>
      {label}
    </span>
  );
}
