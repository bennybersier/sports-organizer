"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { GenerationResult } from "@/domain/scheduling/types";

/**
 * What the run produced.
 *
 * Leads with the shortfall rather than the score, because an organizer's first
 * question is "did everyone get their sessions?", not "what did it score". Each
 * unmet requirement carries the engine's reasons, which is what turns
 * "impossible" into something actionable.
 */
export function GenerationSummary({ result }: { result: GenerationResult }) {
  const t = useTranslations("organizer");
  const { stats } = result;

  const completion =
    stats.sessionsRequested === 0
      ? 0
      : Math.round((stats.sessionsScheduled / stats.sessionsRequested) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("results")}</CardTitle>
        <CardDescription>
          {t("considered", { count: stats.candidatesConsidered })} · {t("elapsed", { ms: stats.elapsedMs })}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("scheduled")}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {stats.sessionsScheduled}
              <span className="text-base font-normal text-muted-foreground">
                {" / "}
                {stats.sessionsRequested}
              </span>
            </p>
            <Progress value={completion} className="mt-2" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("score")}</p>
            <p className="text-2xl font-semibold tabular-nums">{result.score}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("gymUse")}</p>
            <ul className="space-y-0.5 pt-1">
              {Object.entries(stats.gymUtilisation).map(([gymId, count]) => (
                <li key={gymId} className="text-sm tabular-nums">
                  {t("sessions", { count })}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("unmet")}</h3>
          {result.unmet.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              {t("noUnmet")}
            </p>
          ) : (
            <ul className="space-y-3">
              {result.unmet.map((shortfall) => (
                <li key={shortfall.teamId} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle
                      className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                    <span className="font-medium">
                      {t("unmetLine", {
                        team: shortfall.teamName,
                        scheduled: shortfall.scheduled,
                        requested: shortfall.requested,
                      })}
                    </span>
                    <Badge variant="secondary">
                      {shortfall.requested - shortfall.scheduled}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 pl-6">
                    <p className="text-xs font-medium text-muted-foreground">{t("whyUnmet")}</p>
                    <ul className="space-y-0.5">
                      {shortfall.reasons.map((reason, index) => (
                        <li key={index} className="text-sm text-muted-foreground">
                          {/* Known engine diagnoses get a sentence; anything
                              else falls back to the raw code rather than a
                              blank line. */}
                          {reasonText(t, reason.code)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const KNOWN = [
  "NO_ELIGIBLE_GYM",
  "NO_GYM_AVAILABILITY",
  "NO_ASSIGNED_TRAINER",
  "NO_TRAINER_AVAILABILITY",
  "SESSION_LONGER_THAN_WINDOW",
  "NO_OVERLAPPING_AVAILABILITY",
] as const;

function reasonText(
  t: ReturnType<typeof useTranslations<"organizer">>,
  code: string,
): string {
  return (KNOWN as readonly string[]).includes(code)
    ? t(code as (typeof KNOWN)[number])
    : t("NO_OVERLAPPING_AVAILABILITY");
}
