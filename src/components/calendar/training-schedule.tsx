import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MapPin, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TIME_FORMAT } from "@/lib/time-format";
import { AddEventButton } from "@/components/calendar/add-event-button";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { EventDialogOptions } from "@/app/(app)/calendar/new-event-button";

export type TrainingScheduleView = "week" | "month";

export interface TrainingScheduleDay {
  date: string;
  /** False for the padding days a month borrows from its neighbours. */
  inMonth: boolean;
  items: CalendarItem[];
}

/**
 * When a team, or one athlete, is in the hall — a week or a month at a time.
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
 *
 * Shared by the team and athlete pages rather than copied. An athlete who
 * trains up an age group is in two squads, so the only real difference is how
 * many teams the days were gathered from — which is a question for the service,
 * not for the grid.
 */
export async function TrainingSchedule({
  basePath,
  eventTeamIds,
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
  organizerHref,
}: {
  /** Where the previous/next links point — this record's own page. */
  basePath: string;
  /** Teams a new event created from here should be attached to. */
  eventTeamIds: string[];
  view: TrainingScheduleView;
  /** One row for a week; five or six for a month. */
  weeks: TrainingScheduleDay[][];
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
  /** Where to send someone who finds the range empty and may generate a schedule. */
  organizerHref?: string;
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
  const viewHref = (target: TrainingScheduleView) => ({
    pathname: basePath,
    query: { view: target, date: anchor },
  });

  // Today on the club's clock, so the highlighted day is the club's today.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const days = weeks.flat();
  const itemsInRange = days.flatMap((entry) =>
    entry.items.map((item) => ({ date: entry.date, item })),
  );

  const range = isMonth
    ? format.dateTime(at(anchor), { month: "long", year: "numeric", timeZone: "UTC" })
    : format.dateTimeRange(at(rangeStart), at(rangeEnd), {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });

  /** One session, as the orange block the design gives it. */
  const block = (item: CalendarItem, compact = false) => {
    const cancelled = item.status === "CANCELLED";
    return (
      <div
        key={item.id}
        className={cn(
          "rounded border-l-2 border-orange-500 bg-orange-500/10 px-2 py-1 text-xs",
          cancelled && "line-through opacity-60",
        )}
        style={item.color ? { borderLeftColor: item.color } : undefined}
      >
        <p className="font-mono font-semibold text-orange-700 dark:text-orange-400">
          {time(item.startAt)}–{time(item.endAt)}
        </p>
        {!compact && item.gymName ? (
          <p className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{item.gymName}</span>
          </p>
        ) : null}
        {!compact && item.trainerName ? (
          <p className="flex items-center gap-1 text-muted-foreground">
            <UserCog className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{item.trainerName}</span>
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="size-4 text-orange-500" aria-hidden />
            {t("trainingCalendar")}
          </CardTitle>
          <p className="label-caps text-muted-foreground">{range}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isMonth ? (
            <span className="label-caps rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              {t("sessionsThisMonth", { count: scheduledCount })}
            </span>
          ) : requiredPerWeek !== null ? (
            <span
              className={cn(
                "label-caps rounded-full px-2.5 py-1",
                short
                  ? "bg-destructive/15 text-destructive"
                  : "bg-orange-500/15 text-orange-700 dark:text-orange-400",
              )}
            >
              {t("sessionsThisWeek", { count: scheduledCount, required: requiredPerWeek })}
            </span>
          ) : null}

          <div className="inline-flex rounded-md border p-0.5">
            {(["week", "month"] as const).map((target) => (
              <Link
                key={target}
                href={viewHref(target)}
                aria-current={view === target ? "page" : undefined}
                className={cn(
                  "label-caps rounded px-2.5 py-1.5 text-muted-foreground hover:text-foreground",
                  view === target && "bg-orange-500 text-[#0b0f17] hover:text-[#0b0f17]",
                )}
              >
                {tCalendar(target)}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon-sm">
              <Link
                href={{ pathname: basePath, query: { view, date: previous } }}
                aria-label={tCalendar("previous")}
              >
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon-sm">
              <Link
                href={{ pathname: basePath, query: { view, date: next } }}
                aria-label={tCalendar("next")}
              >
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/*
          Seven columns at every width. On a phone a day is a narrow strip — its
          name, its date and a dot where there is training — and the sessions
          themselves are listed beneath the grid, where there is room to read
          them. From sm up each day carries its own sessions.
        */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((entry) => {
            const isToday = entry.date === today;
            const before = coverageStart !== null && entry.date < coverageStart;
            return (
              <div
                key={entry.date}
                className={cn(
                  "group relative flex flex-col gap-1 rounded-md border p-1.5 sm:p-2",
                  isMonth ? "min-h-14 sm:min-h-20" : "min-h-16 sm:min-h-28",
                  entry.items.length === 0 ? "bg-muted/20" : "bg-card",
                  !entry.inMonth && "opacity-50",
                  isToday && "border-orange-500/70 bg-orange-500/5",
                  before && "border-dashed opacity-50",
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <p
                    className={cn(
                      "label-caps leading-tight text-muted-foreground max-sm:flex max-sm:flex-col max-sm:items-center max-sm:w-full",
                      isToday && "text-orange-600 dark:text-orange-400",
                    )}
                  >
                    <span>{day(entry.date)}</span>{" "}
                    <span className="max-sm:font-mono max-sm:text-sm max-sm:font-bold max-sm:text-foreground">
                      {dayNumber(entry.date)}
                    </span>
                  </p>
                  {isToday ? (
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-orange-500 max-sm:hidden" aria-hidden />
                  ) : null}
                  {eventOptions ? (
                    <AddEventButton
                      date={entry.date}
                      label={`${day(entry.date)} ${dayNumber(entry.date)}`}
                      options={eventOptions}
                      // The team whose page this is starts selected: a match added
                      // from here is almost always theirs.
                      teamIds={eventTeamIds}
                      className="max-sm:hidden"
                    />
                  ) : null}
                </div>

                <div className="hidden flex-1 flex-col gap-1 sm:flex">
                  {entry.items.map((item) => block(item))}
                  {entry.items.length === 0 && entry.inMonth && !isMonth ? (
                    <>
                      <p className="flex flex-1 items-center justify-center text-muted-foreground/60">
                        —
                      </p>
                      <p className="label-caps self-end text-muted-foreground/60">{t("rest")}</p>
                    </>
                  ) : null}
                </div>

                {/* The phone's mark for a day with training. */}
                {entry.items.length > 0 ? (
                  <span className="mx-auto mt-auto size-1.5 rounded-full bg-orange-500 sm:hidden" aria-hidden />
                ) : null}
              </div>
            );
          })}
        </div>

        {itemsInRange.length > 0 ? (
          <ul className="space-y-1.5 sm:hidden">
            {itemsInRange.map(({ date, item }) => (
              <li key={item.id} className="flex items-stretch gap-2">
                <span className="label-caps w-16 shrink-0 pt-1.5 text-muted-foreground">
                  {day(date)} {dayNumber(date)}
                </span>
                <div className="min-w-0 flex-1">{block(item)}</div>
              </li>
            ))}
          </ul>
        ) : null}

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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {isMonth ? t("noTrainingThisMonth") : t("noTrainingThisWeek")}
            </p>
            {organizerHref ? (
              <Link
                href={organizerHref}
                className="label-caps flex items-center gap-1 text-orange-600 hover:underline dark:text-orange-400"
              >
                {t("openOrganizer")}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
