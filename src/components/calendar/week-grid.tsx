"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { SHORT_TIME_FORMAT } from "@/lib/time-format";
import { useAction } from "@/hooks/use-action";
import { moveCalendarItemAction } from "@/server/actions/calendar";
import type { CalendarItem } from "@/server/services/calendar-service";

export interface WeekGridProps {
  days: { date: string; label: string; isToday: boolean }[];
  items: (CalendarItem & { startMinutes: number; endMinutes: number; date: string })[];
  /** First and last hour shown, derived from what the club actually uses. */
  dayStartHour: number;
  dayEndHour: number;
  timeZone: string;
  canEdit: boolean;
  onSelect: (item: CalendarItem) => void;
}

const SLOT_MINUTES = 30;
const SLOT_HEIGHT = 24; // px per 30 minutes

/**
 * The week view.
 *
 * A time grid rather than a list, because the question an organizer is asking
 * is "what is free on Tuesday evening" — which is a spatial question. Sessions
 * are positioned by their real start and duration, so gaps are visible as gaps.
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
}: WeekGridProps) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const { run, isPending } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const startMinutes = dayStartHour * 60;
  const totalSlots = ((dayEndHour - dayStartHour) * 60) / SLOT_MINUTES;
  const hours = Array.from({ length: dayEndHour - dayStartHour }, (_, i) => dayStartHour + i);

  function handleDrop(date: string, slotIndex: number) {
    const id = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!id) return;

    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;

    const duration = item.endMinutes - item.startMinutes;
    const newStart = startMinutes + slotIndex * SLOT_MINUTES;

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
        className="grid min-w-3xl"
        style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {/* Header */}
        <div className="sticky left-0 z-10 border-b border-r bg-muted/40" />
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              "border-b border-r p-2 text-center text-sm font-medium last:border-r-0",
              day.isToday && "bg-primary/5 text-primary",
            )}
          >
            {day.label}
          </div>
        ))}

        {/* Hour rows */}
        {hours.map((hour, hourIndex) => (
          <div key={hour} className="contents">
            <div className="sticky left-0 z-10 border-r bg-background p-1 text-right text-xs tabular-nums text-muted-foreground">
              {String(hour).padStart(2, "0")}:00
            </div>
            {days.map((day) => {
              const slotIndex = hourIndex * 2;
              const key = `${day.date}-${slotIndex}`;
              return (
                <div
                  key={day.date}
                  className={cn(
                    "relative border-r border-b last:border-r-0",
                    day.isToday && "bg-primary/[0.02]",
                    dropTarget === key && "bg-primary/10",
                  )}
                  style={{ height: SLOT_HEIGHT * 2 }}
                  onDragOver={(event) => {
                    if (!canEdit || !dragging) return;
                    event.preventDefault();
                    setDropTarget(key);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === key ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(day.date, slotIndex);
                  }}
                >
                  {/* Half-hour guide */}
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Positioned events, overlaid on the grid */}
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 grid min-w-3xl"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`,
            // Sits above the grid it was measured against.
            top: `-${totalSlots * SLOT_HEIGHT}px`,
            height: `${totalSlots * SLOT_HEIGHT}px`,
          }}
        >
          <div />
          {days.map((day) => (
            <div key={day.date} className="relative">
              {items
                .filter((item) => item.date === day.date)
                .map((item) => {
                  const top = ((item.startMinutes - startMinutes) / SLOT_MINUTES) * SLOT_HEIGHT;
                  const height = Math.max(
                    18,
                    ((item.endMinutes - item.startMinutes) / SLOT_MINUTES) * SLOT_HEIGHT,
                  );
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
                        "pointer-events-auto absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs shadow-sm transition-opacity",
                        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                        cancelled && "line-through opacity-50",
                        dragging === item.id && "opacity-40",
                        item.validationState === "CONFLICT"
                          ? "bg-destructive/10 border-l-destructive"
                          : item.validationState === "WARNING"
                            ? "bg-amber-500/10 border-l-amber-500"
                            : "bg-card",
                      )}
                      style={{
                        top,
                        height,
                        borderLeftColor:
                          item.validationState === "VALID" ? (item.color ?? undefined) : undefined,
                      }}
                    >
                      <span className="block truncate font-medium">{item.title}</span>
                      {height > 34 ? (
                        <span className="block truncate text-muted-foreground">
                          {format.dateTime(new Date(item.startAt), {
                            ...SHORT_TIME_FORMAT,
                            timeZone,
                          })}
                          {item.gymName ? ` · ${item.gymName}` : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
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
