"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MapPin, UserCog } from "lucide-react";

import { cn } from "@/lib/utils";
import { TIME_FORMAT } from "@/lib/time-format";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { EventDialogOptions } from "@/app/(app)/calendar/new-event-button";

import { AddEventButton } from "./add-event-button";

export interface MobileCalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  items: CalendarItem[];
}

/**
 * The phone calendar: dates on top, the chosen day's detail underneath.
 *
 * A month cell on a phone fits a date and little else, so it carries dots
 * rather than truncated names — enough to see where the week is busy — and the
 * day you tap is spelled out in full below. This is the shape every phone
 * calendar has converged on, and for good reason: it answers "which day?" and
 * "what exactly?" without either question crowding the other.
 */
export function MobileCalendar({
  weeks,
  weekdayLabels,
  timeZone,
  onSelect,
  eventOptions,
}: {
  weeks: MobileCalendarDay[][];
  weekdayLabels: string[];
  timeZone: string;
  onSelect: (item: CalendarItem) => void;
  /** Absent when the viewer may not create events; the "+" then never appears. */
  eventOptions?: EventDialogOptions;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const days = weeks.flat();

  /*
    Open on today when it is in view, otherwise the first day that has anything
    on it: landing on an arbitrary empty date makes the calendar look broken
    when the answer is one tap away.
  */
  const [selectedDate, setSelectedDate] = useState(
    () =>
      days.find((day) => day.isToday)?.date ??
      days.find((day) => day.items.length > 0)?.date ??
      days[0]?.date ??
      "",
  );

  const selected = days.find((day) => day.date === selectedDate) ?? days[0];

  const time = (value: string) =>
    format.dateTime(new Date(value), { ...TIME_FORMAT, timeZone });

  const selectedLabel = selected
    ? format.dateTime(new Date(`${selected.date}T12:00:00Z`), {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      })
    : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border p-1">
        <div className="grid grid-cols-7">
          {weekdayLabels.map((label) => (
            <div
              key={label}
              className="pb-1 text-center text-[0.7rem] font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}

          {days.map((day) => {
            const isSelected = day.date === selected?.date;
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(day.date)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md py-1.5",
                  !day.inMonth && "text-muted-foreground/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-sm tabular-nums",
                    day.isToday && !isSelected && "font-semibold text-primary",
                    isSelected && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {day.day}
                </span>

                {/* Three dots is the useful limit: past that it is a smudge. */}
                <span className="flex h-1.5 items-center gap-0.5">
                  {day.items.slice(0, 3).map((item) => (
                    <span
                      key={item.id}
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: item.color ?? "var(--muted-foreground)" }}
                      aria-hidden
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          {/*
            One "+" on the day being read, not one per date in the grid: a month
            of tap targets six pixels apart is a mis-tap waiting to happen, and
            the day you want is the day you already tapped.
          */}
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{selectedLabel}</h3>
            {eventOptions ? (
              <AddEventButton
                date={selected.date}
                label={selectedLabel}
                options={eventOptions}
                className="size-8"
              />
            ) : null}
          </div>

          {selected.items.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("emptyTitle")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selected.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border p-3 text-left",
                      "border-l-3 active:bg-accent",
                      item.status === "CANCELLED" && "opacity-60",
                    )}
                    style={{ borderLeftColor: item.color ?? undefined }}
                  >
                    <span className="w-12 shrink-0 text-sm font-medium tabular-nums">
                      {item.allDay ? t("allDay") : time(item.startAt)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate font-medium",
                          item.status === "CANCELLED" && "line-through",
                        )}
                      >
                        {item.title}
                      </span>

                      {!item.allDay ? (
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {time(item.startAt)}–{time(item.endAt)}
                        </span>
                      ) : null}

                      {item.gymName ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{item.gymName}</span>
                        </span>
                      ) : null}

                      {item.trainerName ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <UserCog className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{item.trainerName}</span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
