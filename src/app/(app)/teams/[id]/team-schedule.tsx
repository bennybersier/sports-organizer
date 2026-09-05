import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TIME_FORMAT } from "@/lib/time-format";
import { AddEventButton } from "@/components/calendar/add-event-button";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { EventDialogOptions } from "@/app/(app)/calendar/new-event-button";

export type TeamScheduleView = "week" | "month";

export interface TeamScheduleDay {
  date: string;
  /** False for the padding days a month borrows from its neighbours. */
  inMonth: boolean;
  items: CalendarItem[];
}

/**
 * When this team trains — a week at a time, or a month at a time.
 *
 * Deliberately a plain grid of days rather than the hour-scaled calendar: one
 * team trains a handful of times a week, and an hour grid spends most of its
 * height on empty evenings. Days without training are shown rather than
 * skipped, because "no session on Wednesday" is itself the answer to the
 * question being asked.
 *
 * The two views answer different questions and are the same component because
 * the cell is the same cell: the week is "when are we in the hall on
 * Thursday", the month is "how much are we training in November, and where are
 * the gaps" — which is what gets asked when a fixture needs moving.
 */
export async function TeamSchedule({
  teamId,
  view,
  weeks,
  anchor,
  rangeStart,
  rangeEnd,
  previous,
  next,
  scheduledCount,
  coverageStart,
  requiredPerWeek,
  timezone,
  eventOptions,
}: {
  teamId: string;
  view: TeamScheduleView;
  /** One row for a week; five or six for a month. */
  weeks: TeamScheduleDay[][];
  /**
   * The date the view is *about* — the Monday, or the first of the month.
   * Distinct from `rangeStart`, which for a month is the padding day the grid
   * starts on and may belong to the month before.
   */
  anchor: string;
  rangeStart: string;
  rangeEnd: string;
  /** Anchor dates for the previous/next links, in the current view's step. */
  previous: string;
  next: string;
  scheduledCount: number;
  coverageStart: string | null;
  requiredPerWeek: number | null;
  timezone: string;
  /** Absent when the viewer may not create events; the "+" then never appears. */
  eventOptions?: EventDialogOptions;
}) {
  const t = await getTranslations("teams");
  const tCalendar = await getTranslations("calendar");
  const format = await getFormatter();

  const at = (date: string) => new Date(`${date}T12:00:00Z`);
  const day = (date: string) => format.dateTime(at(date), { weekday: "short", timeZone: "UTC" });
  const dayNumber = (date: string) => format.dateTime(at(date), { day: "numeric", timeZone: "UTC" });
  const time = (value: string) =>
    format.dateTime(new Date(value), { ...TIME_FORMAT, timeZone: timezone });

  const isMonth = view === "month";
  // A weekly target says nothing about a month, so the month shows a plain
  // total rather than "8 of 2 sessions".
  const short = !isMonth && requiredPerWeek !== null && scheduledCount < requiredPerWeek;

  /** Switches view while staying on the range currently being read. */
  const viewHref = (target: TeamScheduleView) => ({
    pathname: `/teams/${teamId}`,
    query: { view: target, date: anchor },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4" aria-hidden />
          {t("trainingCalendar")}
        </CardTitle>

        <div className="flex items-center gap-2">
          {isMonth ? (
            <Badge variant="secondary">{t("sessionsThisMonth", { count: scheduledCount })}</Badge>
          ) : requiredPerWeek !== null ? (
            <Badge variant={short ? "destructive" : "secondary"}>
              {t("sessionsThisWeek", { count: scheduledCount, required: requiredPerWeek })}
            </Badge>
          ) : null}

          <div className="flex items-center gap-1">
            <Button asChild variant={isMonth ? "ghost" : "secondary"} size="sm">
              <Link href={viewHref("week")}>{tCalendar("week")}</Link>
            </Button>
            <Button asChild variant={isMonth ? "secondary" : "ghost"} size="sm">
              <Link href={viewHref("month")}>{tCalendar("month")}</Link>
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon-sm">
              <Link
                href={{ pathname: `/teams/${teamId}`, query: { view, date: previous } }}
                aria-label={tCalendar("previous")}
              >
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon-sm">
              <Link
                href={{ pathname: `/teams/${teamId}`, query: { view, date: next } }}
                aria-label={tCalendar("next")}
              >
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {isMonth
            ? format.dateTime(at(anchor), { month: "long", year: "numeric", timeZone: "UTC" })
            : format.dateTimeRange(at(rangeStart), at(rangeEnd), {
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              })}
        </p>

        <div className="grid gap-2 sm:grid-cols-7">
          {weeks.flat().map((entry) => (
            <div
              key={entry.date}
              className={cn(
                "group flex flex-col gap-1 rounded-lg border p-2",
                isMonth ? "min-h-20" : "min-h-24",
                entry.items.length === 0 && "bg-muted/30",
                !entry.inMonth && "text-muted-foreground/60",
                coverageStart !== null && entry.date < coverageStart && "border-dashed opacity-50",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {day(entry.date)} {dayNumber(entry.date)}
                </p>
                {eventOptions ? (
                  <AddEventButton
                    date={entry.date}
                    label={`${day(entry.date)} ${dayNumber(entry.date)}`}
                    options={eventOptions}
                    // The team whose page this is starts selected: a match added
                    // from here is almost always theirs.
                    teamIds={[teamId]}
                  />
                ) : null}
              </div>

              {entry.items.map((item) => {
                const cancelled = item.status === "CANCELLED";
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-md border-l-2 bg-card px-2 py-1 text-xs",
                      cancelled && "line-through opacity-60",
                    )}
                    style={{ borderLeftColor: item.color ?? undefined }}
                  >
                    <p className="font-medium">
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
                );
              })}
            </div>
          ))}
        </div>

        {coverageStart !== null && rangeStart < coverageStart ? (
          <p className="text-xs text-muted-foreground">
            {tCalendar("scheduleStartsOn", {
              date: format.dateTime(at(coverageStart), {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }),
            })}
          </p>
        ) : null}

        {scheduledCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isMonth ? t("noTrainingThisMonth") : t("noTrainingThisWeek")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
