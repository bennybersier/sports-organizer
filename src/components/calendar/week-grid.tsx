"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { SHORT_TIME_FORMAT } from "@/lib/time-format";
import { useAction } from "@/hooks/use-action";
import { moveCalendarItemAction } from "@/server/actions/calendar";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { EventDialogOptions } from "@/app/(app)/calendar/new-event-button";

import { bucketByHour, rowDepths } from "@/domain/calendar-layout";

import { AddEventButton } from "./add-event-button";

export interface WeekGridProps {
  days: { date: string; label: string; isToday: boolean }[];
  items: (CalendarItem & { startMinutes: number; endMinutes: number; date: string })[];
  /** First and last hour shown, derived from what the club actually uses. */
  dayStartHour: number;
  dayEndHour: number;
  timeZone: string;
  canEdit: boolean;
  onSelect: (item: CalendarItem) => void;
  /** Absent when the viewer may not create events; the "+" then never appears. */
  eventOptions?: EventDialogOptions;
}

/** A card carrying a team, its times and its hall on two lines. */
const CARD_HEIGHT = 44;
const CARD_GAP = 4;
/** Breathing room so an empty hour is still a visible row. */
const ROW_PADDING = 8;

/**
 * The week view.
 *
 * A time grid rather than a list, because the question an organizer is asking
 * is "what is free on Tuesday evening" — which is a spatial question.
 *
 * Sessions are stacked inside the hour they start in, at the full width of the
 * day, and the hour row grows to fit them. The usual approach — position by
 * start and duration, share the width between whatever overlaps — assumes a
 * handful at a time; this club runs seven concurrent sessions on an ordinary
 * evening, where a shared column is twenty-five pixels of truncated team name.
 * Height is cheap and scrolls; width is not.
 *
 * What that costs is duration-as-height: a two-hour session is the same size as
 * a one-hour one, so every card states its own times. What it buys is that
 * every session is legible, which is the only property that matters when the
 * question is which evening is already full.
 *
 * Dragging moves a session to another day or time. The drop is validated server
 * side before it is saved, and a refusal explains itself rather than silently
 * snapping back.
 *
 * Accessibility: dragging is pointer-only, so every session is also a real
 * button that opens its detail panel with the keyboard — reading and inspecting
 * the schedule never requires a mouse. *Moving* one currently does; the
 * keyboard route is to edit the session directly, and a keyboard drag
 * alternative is still owed here.
 */
export function WeekGrid({
  days,
  items,
  dayStartHour,
  dayEndHour,
  timeZone,
  canEdit,
  onSelect,
  eventOptions,
}: WeekGridProps) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const { run, isPending } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const hours = Array.from({ length: dayEndHour - dayStartHour }, (_, i) => dayStartHour + i);

  // One bucket map per day, and one depth per hour shared across the week, so
  // the same hour lines up on every day.
  const byDay = new Map(
    days.map((day) => [
      day.date,
      bucketByHour(
        items.filter((item) => item.date === day.date),
        dayStartHour,
        dayEndHour,
      ),
    ]),
  );
  const depths = rowDepths(
    days.map((day) => ({
      date: day.date,
      items: items.filter((item) => item.date === day.date),
    })),
    dayStartHour,
    dayEndHour,
  );
  const rowHeight = (hour: number) =>
    (depths.get(hour) ?? 1) * (CARD_HEIGHT + CARD_GAP) + ROW_PADDING;

  /** Dropping onto an hour row moves the session to the top of that hour. */
  function handleDrop(date: string, hour: number) {
    const id = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!id) return;

    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;

    const duration = item.endMinutes - item.startMinutes;
    const newStart = hour * 60;

    // Local dates and times, converted to instants by the server, which is the
    // only place that knows the club's timezone authoritatively.
    run(
      () =>
        moveCalendarItemAction({
          id: item.id,
          source: item.source,
          startAt: localToIso(date, newStart),
          endAt: localToIso(date, newStart + duration),
        }),
      {
        success: (data) =>
          data.severity === "WARNING" ? t("movedWithWarnings") : t("moved"),
      },
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div
        className="grid min-w-5xl"
        style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {/* Header */}
        <div className="sticky left-0 z-10 border-b border-r bg-muted/40" />
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              "flex items-center justify-center gap-1 border-b border-r p-2 text-center text-sm font-medium last:border-r-0",
              day.isToday && "bg-primary/5 text-primary",
            )}
          >
            {day.label}
            {/*
              In the day header rather than in an hour cell: the hour grid is a
              drop target for dragging sessions, and a button inside it would
              fight that. The time is a field in the form anyway.
            */}
            {eventOptions ? (
              <AddEventButton date={day.date} label={day.label} options={eventOptions} />
            ) : null}
          </div>
        ))}

        {/* Hour rows. Each is as deep as the week's busiest day for that hour. */}
        {hours.map((hour) => (
          <div key={hour} className="contents">
            <div
              className="sticky left-0 z-10 border-r border-b bg-background p-1 text-right text-xs tabular-nums text-muted-foreground"
              style={{ height: rowHeight(hour) }}
            >
              {String(hour).padStart(2, "0")}:00
            </div>

            {days.map((day) => {
              const key = `${day.date}-${hour}`;
              const sessions = byDay.get(day.date)?.get(hour) ?? [];

              return (
                <div
                  key={day.date}
                  className={cn(
                    "flex flex-col gap-1 border-r border-b p-1 last:border-r-0",
                    day.isToday && "bg-primary/[0.02]",
                    dropTarget === key && "bg-primary/10",
                  )}
                  style={{ height: rowHeight(hour) }}
                  onDragOver={(event) => {
                    if (!canEdit || !dragging) return;
                    event.preventDefault();
                    setDropTarget(key);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === key ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(day.date, hour);
                  }}
                >
                  {sessions.map((item) => {
                    const cancelled = item.status === "CANCELLED";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        draggable={canEdit && item.editable && !cancelled}
                        onDragStart={() => setDragging(item.id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        onClick={() => onSelect(item)}
                        disabled={isPending}
                        className={cn(
                          "w-full shrink-0 overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-xs shadow-sm transition-opacity",
                          cancelled && "line-through opacity-50",
                          dragging === item.id && "opacity-40",
                          canEdit && item.editable && !cancelled && "cursor-grab",
                          item.validationState === "CONFLICT"
                            ? "bg-destructive/10 border-l-destructive"
                            : item.validationState === "WARNING"
                              ? "bg-amber-500/10 border-l-amber-500"
                              : "bg-card",
                        )}
                        style={{
                          height: CARD_HEIGHT,
                          borderLeftColor:
                            item.validationState === "VALID" ? (item.color ?? undefined) : undefined,
                        }}
                      >
                        <span className="block truncate font-medium">{item.title}</span>
                        {/*
                          Height no longer says how long a session runs, so the
                          card has to. Both ends, not just the start.
                        */}
                        <span className="block truncate text-muted-foreground">
                          {format.dateTime(new Date(item.startAt), {
                            ...SHORT_TIME_FORMAT,
                            timeZone,
                          })}
                          –
                          {format.dateTime(new Date(item.endAt), {
                            ...SHORT_TIME_FORMAT,
                            timeZone,
                          })}
                          {item.gymName ? ` · ${item.gymName}` : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {canEdit ? (
        <p className="border-t p-2 text-xs text-muted-foreground">{t("dragHint")}</p>
      ) : null}
    </div>
  );
}

/**
 * A local date and minute-of-day as an ISO string with the browser's offset.
 * The server re-interprets it in the club's timezone, which is authoritative.
 */
function localToIso(date: string, minutes: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  return value.toISOString();
}
