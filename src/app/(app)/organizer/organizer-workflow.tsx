"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { generateScheduleAction } from "@/server/actions/organizer";
import type { GenerationResult } from "@/domain/scheduling/types";

import { GenerationSummary } from "./generation-summary";

/**
 * Configure, generate, review.
 *
 * The readiness panel is the important part: it answers "will this work?"
 * before the run rather than after. A club whose gyms have no opening hours
 * gets told that here, not shown an empty schedule and left to guess.
 */
export function OrganizerWorkflow({
  seasons,
  selectedSeasonId,
  teams,
  gyms,
  readiness,
}: {
  seasons: (MultiSelectOption & { isActive: boolean })[];
  selectedSeasonId: string;
  teams: MultiSelectOption[];
  gyms: MultiSelectOption[];
  readiness: {
    teams: number;
    teamsWithRequirements: number;
    gyms: number;
    trainers: number;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("organizer");
  const tErrors = useTranslations("errors");

  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [gymIds, setGymIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

  function changeSeason(seasonId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("season", seasonId);
    setResult(null);
    router.replace(`/organizer?${next.toString()}`);
  }

  async function generate() {
    setPending(true);
    setResult(null);

    const response = await generateScheduleAction({
      seasonId: selectedSeasonId,
      teamIds,
      gymIds,
    });

    setPending(false);
    if (!response.ok) {
      toast.error(response.error.message || tErrors(response.error.code));
      return;
    }

    setResult(response.data.result);
    toast.success(t("generated"));
    router.refresh();
  }

  const checks = [
    {
      ok: readiness.teams > 0,
      good: t("readyTeams", { count: readiness.teamsWithRequirements || readiness.teams }),
      bad: t("notReadyTeams"),
    },
    { ok: readiness.gyms > 0, good: t("readyGyms", { count: readiness.gyms }), bad: t("notReadyGyms") },
    {
      ok: readiness.trainers > 0,
      good: t("readyTrainers", { count: readiness.trainers }),
      bad: t("notReadyTrainers"),
    },
  ];

  // Only a gym with hours is genuinely required — a session can be placed
  // unstaffed, but it cannot be placed nowhere.
  const canGenerate = readiness.teams > 0 && readiness.gyms > 0 && !pending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            {t("configure")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-1">
            <Label htmlFor="organizer-season">{t("season")}</Label>
            <Select value={selectedSeasonId} onValueChange={changeSeason}>
              <SelectTrigger id="organizer-season">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((season) => (
                  <SelectItem key={season.value} value={season.value}>
                    {season.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {teams.length > 0 ? (
            <div className="grid gap-1">
              <Label>{t("teams")}</Label>
              <MultiSelect
                options={teams}
                value={teamIds}
                onChange={setTeamIds}
                placeholder={t("teams")}
                emptyText={t("notReadyTeams")}
              />
              <p className="text-xs text-muted-foreground">{t("teamsHint")}</p>
            </div>
          ) : null}

          {gyms.length > 0 ? (
            <div className="grid gap-1">
              <Label>{t("gyms")}</Label>
              <MultiSelect
                options={gyms}
                value={gymIds}
                onChange={setGymIds}
                placeholder={t("gyms")}
                emptyText={t("notReadyGyms")}
              />
              <p className="text-xs text-muted-foreground">{t("gymsHint")}</p>
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">{t("readiness")}</p>
            <ul className="space-y-1">
              {checks.map((check, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  {check.ok ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                  )}
                  <span className={check.ok ? undefined : "text-muted-foreground"}>
                    {check.ok ? check.good : check.bad}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <Button onClick={generate} disabled={!canGenerate}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                {t("generating")}
              </>
            ) : (
              <>
                <Sparkles aria-hidden />
                {t("generate")}
              </>
            )}
          </Button>

          {!canGenerate && !pending ? (
            <Alert>
              <AlertDescription>{t("notReadyGyms")}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {result ? <GenerationSummary result={result} /> : null}
    </div>
  );
}
