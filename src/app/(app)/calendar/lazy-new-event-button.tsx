"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { getEventDialogOptionsAction } from "@/server/actions/calendar";

import { NewEventButton, type EventDialogOptions } from "./new-event-button";

/**
 * The "New event" button, for a page that should not pay for the dialog's
 * pickers on every visit. The seasons, halls, trainers and teams are fetched
 * on the first click and kept for the rest of the visit.
 */
export function LazyNewEventButton({ defaultTeamIds }: { defaultTeamIds?: string[] }) {
  const t = useTranslations("calendar");
  const { run, isPending } = useAction();
  const [options, setOptions] = useState<EventDialogOptions | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        disabled={isPending}
        onClick={() => {
          if (options) {
            setOpen(true);
            return;
          }
          run(() => getEventDialogOptionsAction(), {
            onSuccess: (data) => {
              setOptions(data);
              setOpen(true);
            },
          });
        }}
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        {t("newEvent")}
      </Button>

      {options ? (
        <NewEventButton
          {...options}
          defaultTeamIds={defaultTeamIds}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
