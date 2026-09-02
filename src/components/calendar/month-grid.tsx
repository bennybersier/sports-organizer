"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { CalendarItem } from "@/server/services/calendar-service";

/** Month overview: density at a glance, detail on click. */
export function MonthGrid({
  weeks,
  weekdayLabels,
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
  onSelect: (item: CalendarItem) => void;
}) {
  const t = useTranslations("calendar");

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
                    <span className="truncate">{item.title}</span>
                  </button>
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
