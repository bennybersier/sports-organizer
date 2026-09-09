"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toWallClock } from "@/domain/scheduling/timezone";
import { WeekGrid } from "@/components/calendar/week-grid";
import type { TrainingWeek } from "@/server/services/calendar-service";
import { previewVersionWeekAction } from "@/server/actions/organizer";

/**
 * A draft schedule, week by week, without leaving the organizer.
 *
 * The calendar shows the published schedule only — a draft is not what the club
 * is doing — so previewing one there showed an empty week. Deciding whether to
 * publish means seeing the thing first.
 */
export function VersionPreview({
  versionId,
  versionLabel,
  timezone,
  initialWeek,
  onOpenChange,
}: {
  versionId: string;
  versionLabel: string;
  timezone: string;
  /*
    The first week is fetched before this mounts, so the dialog opens with
    content instead of a spinner — and so no effect is needed to load it.
    Mounting only while previewing keeps this initial state honest.
  */
  initialWeek: TrainingWeek;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("organizer");
  const tCalendar = useTranslations("calendar");
  const format = useFormatter();
  const [week, setWeek] = useState(initialWeek);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = (weekOf: string) => {
    startTransition(async () => {
      const result = await previewVersionWeekAction(versionId, weekOf);
      if (result.ok) {
        setWeek(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  };

  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  /*
    Positioned on the club's wall clock, exactly as the calendar does it — a
    22:00 session in Rome is already tomorrow in UTC, and would otherwise land
    on the wrong column.
  */
  const positioned = week.days.flatMap((entry) =>
    entry.items.map((item) => {
      const start = toWallClock(item.startAt, timezone);
      const end = toWallClock(item.endAt, timezone);
      return {
        ...item,
        date: start.date,
        startMinutes: start.minutes,
        endMinutes: end.date === start.date ? end.minutes : 1440,
      };
    }),
  );

  // The grid spans the hours the club actually uses, with a little air, rather
  // than a fixed 00:00-24:00 that is mostly empty.
  const usedStart = Math.min(...positioned.map((item) => item.startMinutes), 16 * 60);
  const usedEnd = Math.max(...positioned.map((item) => item.endMinutes), 22 * 60);
  const dayStartHour = Math.max(0, Math.floor(usedStart / 60) - 1);
  const dayEndHour = Math.min(24, Math.ceil(usedEnd / 60) + 1);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/*
        Seven columns of real sessions need room: at the default dialog width
        each day is barely wider than a time range, and the hall and coach —
        the two things you check before publishing — truncate to nothing.
        Capped so it stays a dialog rather than becoming a second page.
      */}
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] flex-col sm:max-w-[min(96rem,calc(100vw-3rem))]">
        <DialogHeader>
          <DialogTitle>{versionLabel}</DialogTitle>
          <DialogDescription>{t("previewDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => load(week.previousWeek)}
          >
            <ChevronLeft aria-hidden />
            {tCalendar("previous")}
          </Button>

          <p className="text-sm font-medium tabular-nums">
            {format.dateTimeRange(
              new Date(`${week.weekStart}T12:00:00Z`),
              new Date(`${week.weekEnd}T12:00:00Z`),
              { day: "numeric", month: "short", timeZone: "UTC" },
            )}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => load(week.nextWeek)}
          >
            {tCalendar("next")}
            <ChevronRight aria-hidden />
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div
          className={cn(
            // Dimmed rather than blanked while the next week loads, so the
            // dialog does not jump about as you step through weeks.
            "min-h-0 flex-1 overflow-auto",
            isPending && "opacity-60",
          )}
        >
          <WeekGrid
            days={week.days.map((entry) => ({
              date: entry.date,
              label: day(entry.date),
              isToday: entry.date === today,
            }))}
            items={positioned}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
            timeZone={timezone}
            /*
              Read-only on purpose. Dragging edits the published schedule, and
              this is a draft nobody has agreed to yet — the way to change it is
              to adjust the requirements and generate again.
            */
            canEdit={false}
            onSelect={() => {}}
          />
        </div>

      </DialogContent>
    </Dialog>
  );
}
