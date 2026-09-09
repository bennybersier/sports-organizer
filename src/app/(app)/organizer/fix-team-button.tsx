"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { getTeamRequirementAction } from "@/server/actions/requirements-read";
import type { TrainingRequirement } from "@/server/services/training-requirement-service";
import type { MultiSelectOption } from "@/components/data/multi-select";

import { RequirementsDialog } from "@/app/(app)/teams/[id]/requirements-form";

/**
 * Acting on a shortfall where it is read.
 *
 * The engine already says what to change — "add hall hours, allow more weekdays
 * for it, or lower its weekly sessions" — and every one of those is a field on
 * the team's requirements. Sending an organizer to the team's page to find them
 * loses the list they were working through, and with it which of a dozen sides
 * they had got to.
 *
 * Loaded on click rather than with the page: a run can name a dozen teams and
 * an organizer opens at most one or two.
 */
export function FixTeamButton({
  teamId,
  seasonId,
  teamName,
  canEdit,
}: {
  teamId: string;
  seasonId: string;
  teamName: string;
  canEdit: boolean;
}) {
  const t = useTranslations("organizer");
  const { run, isPending } = useAction();

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{
    requirement: TrainingRequirement;
    gyms: MultiSelectOption[];
  } | null>(null);

  function openFor() {
    // Re-read every time. The point of this dialog is to change the numbers and
    // run again, so the second visit must not show the first visit's values.
    run(() => getTeamRequirementAction(teamId, seasonId), {
      onSuccess: (data) => {
        setLoaded({ requirement: data.requirement, gyms: data.gyms });
        setOpen(true);
      },
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={isPending}
        onClick={openFor}
        aria-label={t("fixTeam", { team: teamName })}
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <SlidersHorizontal className="size-3.5" aria-hidden />
        )}
        {t("adjust")}
      </Button>

      {loaded ? (
        <RequirementsDialog
          requirement={loaded.requirement}
          gyms={loaded.gyms}
          canEdit={canEdit}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
