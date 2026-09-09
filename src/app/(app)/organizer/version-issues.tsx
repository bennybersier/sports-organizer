"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GenerationResult } from "@/domain/scheduling/types";
import type { SkippedOccurrence } from "@/server/services/schedule-generation-service";

import { GenerationSummary } from "./generation-summary";

/**
 * Why a saved run came up short, read after the fact.
 *
 * The engine's verdict was only ever visible in the minutes after generating —
 * scroll past it, or come back tomorrow, and the shortfall was gone even though
 * the draft it belongs to is still sitting there waiting to be published.
 *
 * Nothing new is computed here. `schedule_versions.result_summary` has held the
 * score, the statistics, the unmet requirements and the skipped dates since the
 * run happened; this is the reader that was missing.
 *
 * It carries the same "Adjust" buttons as a fresh run, because reviewing a
 * shortfall and fixing it are the same sitting.
 */
export interface StoredSummary {
  score?: number;
  stats?: GenerationResult["stats"];
  unmet?: GenerationResult["unmet"];
  skipped?: SkippedOccurrence[];
}

export function VersionIssues({
  versionLabel,
  summary,
  seasonId,
  teamNames,
  canEditRequirements,
  onOpenChange,
}: {
  versionLabel: string;
  summary: StoredSummary;
  seasonId: string;
  teamNames: Record<string, string>;
  canEditRequirements: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("organizer");

  /*
    A run saved before a field existed simply lacks it. Filling the gaps here
    rather than making every reader defensive: an old version should render as
    "nothing recorded", never as a crash.
  */
  const result: GenerationResult = {
    assignments: [],
    unmet: summary.unmet ?? [],
    score: summary.score ?? 0,
    stats: summary.stats ?? {
      teams: 0,
      sessionsRequested: 0,
      sessionsScheduled: 0,
      candidatesConsidered: 0,
      gymUtilisation: {},
      elapsedMs: 0,
    },
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[90vw] max-w-none flex-col sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{versionLabel}</DialogTitle>
          <DialogDescription>{t("issuesDescription")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <GenerationSummary
            result={result}
            skipped={summary.skipped ?? []}
            teamNames={teamNames}
            seasonId={seasonId}
            canEditRequirements={canEditRequirements}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
