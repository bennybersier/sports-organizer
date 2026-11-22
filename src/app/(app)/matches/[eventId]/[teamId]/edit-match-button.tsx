"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { getEventAction, getEventDialogOptionsAction } from "@/server/actions/calendar";
import {
  NewEventButton,
  type EventDialogOptions,
  type EventFormValues,
} from "@/app/(app)/calendar/new-event-button";

/**
 * Editing the match itself — its opponent, date, hall and buffers.
 *
 * The calendar's event dialog, reached from the match page. A match *is* a
 * calendar event, so a second form for one would be a second set of rules
 * about what a fixture may contain, and the two would drift. This is the same
 * dialog the calendar opens, loaded with the same event.
 *
 * The event and the dialog's pickers are fetched on click rather than with
 * the page: most visits to a match are to read it.
 */
export function EditMatchButton({ eventId }: { eventId: string }) {
  const t = useTranslations("matches");
  const { run, isPending } = useAction();
  const [event, setEvent] = useState<EventFormValues | null>(null);
  const [options, setOptions] = useState<EventDialogOptions | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          run(
            async () => {
              const [found, pickers] = await Promise.all([
                getEventAction(eventId),
                getEventDialogOptionsAction(),
              ]);
              if (!found.ok) return found;
              if (!pickers.ok) return pickers;
              return { ok: true as const, data: { event: found.data, options: pickers.data } };
            },
            {
              onSuccess: (data) => {
                setEvent(data.event);
                setOptions(data.options);
                setOpen(true);
              },
            },
          )
        }
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Pencil aria-hidden />}
        {t("editMatch")}
      </Button>

      {event && options ? (
        <NewEventButton {...options} event={event} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
