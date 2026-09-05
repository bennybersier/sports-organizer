"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  NewEventButton,
  type EventDialogOptions,
} from "@/app/(app)/calendar/new-event-button";

/**
 * The "+" that lives in a day box.
 *
 * Adding something on the 14th should start from the 14th, not from a blank
 * form and a date picker. Every calendar surface — month, week, agenda, the
 * phone layout, a team's training week — puts one of these in each day, and
 * they all open the same editor with that date already filled in.
 *
 * The editor itself is mounted only once the button is pressed. A month grid
 * has forty-two of these, and forty-two idle copies of a twenty-field form is a
 * real cost for something that is used once in a while.
 */
export function AddEventButton({
  date,
  label,
  options,
  teamIds,
  className,
}: {
  /** Club-local `YYYY-MM-DD`, prefilled into the new event. */
  date: string;
  /** How the day reads to a screen reader — "Tuesday 14 October". */
  label?: string;
  options: EventDialogOptions;
  /** Squads to preselect, where the surface already implies one. */
  teamIds?: string[];
  className?: string;
}) {
  const t = useTranslations("calendar");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("newEventOn", { day: label ?? date })}
        title={t("newEventOn", { day: label ?? date })}
        onClick={() => setOpen(true)}
        className={cn("text-muted-foreground hover:text-foreground", className)}
      >
        <Plus aria-hidden />
      </Button>

      {open ? (
        <NewEventButton
          {...options}
          defaultDate={date}
          defaultTeamIds={teamIds}
          open
          onOpenChange={(next) => !next && setOpen(false)}
        />
      ) : null}
    </>
  );
}
