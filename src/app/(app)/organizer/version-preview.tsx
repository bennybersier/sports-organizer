"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, MapPin, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TIME_FORMAT } from "@/lib/time-format";
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
  const time = (value: string) =>
    format.dateTime(new Date(value), { ...TIME_FORMAT, timeZone: timezone });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/*
        Seven columns of real sessions need room: at the default dialog width
        each day is barely wider than a time range, and the hall and coach —
        the two things you check before publishing — truncate to nothing.
        Capped so it stays a dialog rather than becoming a second page.
      */}
      <DialogContent className="sm:max-w-[min(96rem,calc(100vw-3rem))]">
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
              "grid gap-2 sm:grid-cols-7",
              // Dimmed rather than blanked while the next week loads, so the
              // dialog does not jump about as you step through weeks.
              isPending && "opacity-60",
            )}
          >
            {week.days.map((entry) => (
              <div
                key={entry.date}
                className={cn(
                  "flex min-h-40 flex-col gap-1.5 rounded-lg border p-2",
                  entry.items.length === 0 && "bg-muted/30",
                  // A day the schedule does not cover yet is not an empty day.
                  week.coverageStart !== null &&
                    entry.date < week.coverageStart &&
                    "border-dashed opacity-50",
                )}
                title={
                  week.coverageStart !== null && entry.date < week.coverageStart
                    ? tCalendar("beforeStart")
                    : undefined
                }
              >
                <p className="text-xs font-medium text-muted-foreground">{day(entry.date)}</p>

                {entry.items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-md border-l-2 bg-card px-2 py-1 text-xs",
                      item.status === "CANCELLED" && "line-through opacity-60",
                    )}
                    style={{ borderLeftColor: item.color ?? undefined }}
                  >
                    <p className="font-medium">{item.teamName}</p>
                    {/* One line: a wrapped time range reads as two events. */}
                    <p className="whitespace-nowrap tabular-nums">
                      {time(item.startAt)}–{time(item.endAt)}
                    </p>
                    {item.gymName ? (
                      <p className="flex items-center gap-1 text-muted-foreground">
                        <MapPin className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{item.gymName}</span>
                      </p>
                    ) : null}
                    {item.trainerName ? (
                      <p className="flex items-center gap-1 text-muted-foreground">
                        <UserCog className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{item.trainerName}</span>
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
        </div>

        {/*
          The first week of a schedule generated mid-week is genuinely partial.
          Saying so beats leaving an organizer to conclude the optimizer
          skipped Monday.
        */}
        {week.coverageStart !== null && week.weekStart < week.coverageStart ? (
          <p className="text-xs text-muted-foreground">
            {tCalendar("scheduleStartsOn", {
              date: format.dateTime(new Date(`${week.coverageStart}T12:00:00Z`), {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }),
            })}
          </p>
        ) : null}

        {week.scheduledCount === 0 ? (
          <p className="text-sm text-muted-foreground">{t("previewEmptyWeek")}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
