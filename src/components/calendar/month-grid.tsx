"use client";

import { useFormatter, useTranslations } from "next-intl";
import { MapPin, UserCog } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TIME_FORMAT } from "@/lib/time-format";
import type { CalendarItem } from "@/server/services/calendar-service";

/**
 * Month overview: density at a glance, detail on click.
 *
 * Each entry leads with its start time, because "is there anything on the 14th"
 * is rarely the real question — "what time are we in the hall" is. Hall and
 * coach follow on hover, which keeps the cell readable while still answering
 * the follow-up without a click.
 */
export function MonthGrid({
  weeks,
  weekdayLabels,
  timeZone,
  onSelect,
}: {
  weeks: {
    date: string;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    items: CalendarItem[];
  }[][];
  weekdayLabels: string[];
  /** The club's zone: a session is at the club's clock, not the viewer's. */
  timeZone: string;
  onSelect: (item: CalendarItem) => void;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();

  const time = (value: string) =>
    format.dateTime(new Date(value), { ...TIME_FORMAT, timeZone });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="grid min-w-2xl grid-cols-7">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="border-b border-r p-2 text-center text-xs font-medium text-muted-foreground last:border-r-0"
          >
            {label}
          </div>
        ))}

        {weeks.flat().map((day) => (
          <div
            key={day.date}
            className={cn(
              "min-h-24 border-b border-r p-1 last:border-r-0",
              !day.inMonth && "bg-muted/30 text-muted-foreground",
              day.isToday && "bg-primary/5",
            )}
          >
            <div
              className={cn(
                "px-1 text-xs tabular-nums",
                day.isToday && "font-semibold text-primary",
              )}
            >
              {day.day}
            </div>
            <ul className="space-y-0.5">
              {day.items.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        className={cn(
                          "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
                          item.status === "CANCELLED" && "line-through opacity-60",
                        )}
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color ?? "var(--muted-foreground)" }}
                          aria-hidden
                        />
                        {item.allDay ? null : (
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {time(item.startAt)}
                          </span>
                        )}
                        <span className="truncate">{item.title}</span>
                      </button>
                    </TooltipTrigger>

                    <TooltipContent side="right" className="max-w-64">
                      <p className="font-medium">{item.title}</p>
                      <p className="tabular-nums">
                        {item.allDay
                          ? t("allDay")
                          : `${time(item.startAt)}–${time(item.endAt)}`}
                      </p>
                      {item.gymName ? (
                        <p className="flex items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          {item.gymName}
                        </p>
                      ) : null}
                      {item.trainerName ? (
                        <p className="flex items-center gap-1">
                          <UserCog className="size-3 shrink-0" aria-hidden />
                          {item.trainerName}
                        </p>
                      ) : null}
                      {item.status === "CANCELLED" ? <p>{t("CANCELLED")}</p> : null}
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
              {day.items.length > 3 ? (
                <li className="px-1 text-xs text-muted-foreground">
                  +{day.items.length - 3}
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <p className="sr-only">{t("subtitle")}</p>
    </div>
  );
}
