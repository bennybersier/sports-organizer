"use client";

import { useFormatter, useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/data/empty-state";
import { cn } from "@/lib/utils";
import { SHORT_TIME_FORMAT } from "@/lib/time-format";
import type { CalendarItem } from "@/server/services/calendar-service";

/**
 * Agenda: a chronological list grouped by day.
 *
 * This is also the mobile experience — a time grid on a phone is unreadable, so
 * small screens get the list rather than a shrunken grid.
 */
export function AgendaView({
  groups,
  timeZone,
  onSelect,
}: {
  groups: { date: string; label: string; isToday: boolean; items: CalendarItem[] }[];
  /**
   * The club's scheduling timezone. Passed explicitly because a formatter with
   * no timezone falls back to whatever the *server* is set to — which silently
   * shifts every time on the calendar.
   */
  timeZone: string;
  onSelect: (item: CalendarItem) => void;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();

  const withItems = groups.filter((group) => group.items.length > 0);

  if (withItems.length === 0) {
    return <EmptyState icon={CalendarDays} title={t("emptyTitle")} description={t("emptyBody")} />;
  }

  return (
    <div className="space-y-5">
      {withItems.map((group) => (
        <section key={group.date}>
          <h3
            className={cn(
              "sticky top-14 z-10 bg-background/95 py-1 text-sm font-medium backdrop-blur",
              group.isToday && "text-primary",
            )}
          >
            {group.label}
          </h3>
          <ul className="divide-y rounded-lg border">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color ?? "var(--muted-foreground)" }}
                    aria-hidden
                  />
                  <span className="w-28 shrink-0 text-sm tabular-nums">
                    {item.allDay
                      ? t("allDay")
                      : `${format.dateTime(new Date(item.startAt), { ...SHORT_TIME_FORMAT, timeZone })}–${format.dateTime(new Date(item.endAt), { ...SHORT_TIME_FORMAT, timeZone })}`}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-medium",
                      item.status === "CANCELLED" && "line-through opacity-60",
                    )}
                  >
                    {item.title}
                  </span>
                  {item.gymName ? (
                    <span className="truncate text-sm text-muted-foreground">{item.gymName}</span>
                  ) : null}
                  {item.validationState !== "VALID" ? (
                    <Badge variant={item.validationState === "CONFLICT" ? "destructive" : "secondary"}>
                      {item.validationState}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">{t(item.type as "TRAINING")}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
