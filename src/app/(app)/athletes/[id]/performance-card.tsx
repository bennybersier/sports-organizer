import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Activity, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { AthletePerformance } from "@/server/services/performance-service";

/**
 * One player's season.
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
export async function PerformanceCard({
  performance,
  action,
}: {
  performance: AthletePerformance;
  /** Rendered in the header — writing an assessment, where permitted. */
  action?: ReactNode;
}) {
  const t = await getTranslations("attendance");
  const { training, matches, trend, boxScore, evaluations } = performance;

  const nothingYet = training.eligible === 0 && matches.eligible === 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-6">
        {nothingYet ? (
          <p className="text-sm text-muted-foreground">{t("stats.noData")}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat
                label={t("stats.turnout")}
                value={training.turnout === null ? "—" : `${Math.round(training.turnout * 100)}%`}
                hint={`${training.present + training.late}/${training.eligible} ${t("stats.sessions").toLowerCase()}`}
              />
              <Stat
                label={t("stats.absent")}
                value={String(training.unexplained)}
                hint={`${training.excused} ${t("stats.excused").toLowerCase()}`}
                warn={training.unexplained > 0}
              />
              <Stat
                label={t("stats.calledUp")}
                value={
                  matches.eligible === 0
                    ? "—"
                    : `${matches.calledUp}/${matches.eligible}`
                }
                hint={`${matches.started} ${t("stats.started").toLowerCase()}`}
              />
              <Stat
                label={t("stats.played")}
                value={String(matches.played)}
                hint={`${matches.benched} ${t("stats.benched").toLowerCase()}`}
              />
            </div>

            {trend.length > 1 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t("stats.turnout")}</p>
                <div className="space-y-1.5">
                  {trend.map((month) => (
                    <div key={month.month} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {month.month}
                      </span>
                      <Progress value={month.turnout * 100} className="h-2 flex-1" />
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {month.attended}/{month.eligible}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {boxScore ? (
              <>
                <Separator />
                <div className="grid gap-4 sm:grid-cols-4">
                  <Stat
                    label={t("stats.points")}
                    value={boxScore.perGame.points.toFixed(1)}
                    hint={t("stats.perGame")}
                  />
                  <Stat
                    label={t("stats.rebounds")}
                    value={boxScore.perGame.rebounds.toFixed(1)}
                    hint={t("stats.perGame")}
                  />
                  <Stat
                    label={t("stats.assists")}
                    value={boxScore.perGame.assists.toFixed(1)}
                    hint={t("stats.perGame")}
                  />
                  <Stat
                    label={t("stats.efficiency")}
                    value={boxScore.perGame.efficiency.toFixed(1)}
                    hint={`${boxScore.games} ${t("stats.games").toLowerCase()}`}
                  />
                </div>
              </>
            ) : null}
          </>
        )}

        {evaluations.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">{t("evaluation.title")}</p>
              {evaluations.slice(-2).map((evaluation) => (
                <div key={evaluation.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="tabular-nums">
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

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          warn && "text-amber-600 dark:text-amber-500",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Rating({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Star className="size-3 fill-current text-amber-500" aria-hidden />
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      {label}
    </span>
  );
}
