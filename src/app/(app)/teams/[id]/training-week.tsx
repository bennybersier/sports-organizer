import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TIME_FORMAT } from "@/lib/time-format";
import type { TrainingWeek } from "@/server/services/calendar-service";

/**
 * When this team trains, week by week.
 *
 * Deliberately a plain grid of seven days rather than the hour-scaled calendar:
 * one team trains a handful of times a week, and an hour grid spends most of
 * its height on empty evenings. Days without training are shown rather than
 * skipped, because "no session on Wednesday" is itself the answer to the
 * question being asked.
 */
export async function TrainingWeek({
  teamId,
  week,
  timezone,
  requiredPerWeek,
}: {
  teamId: string;
  week: TrainingWeek;
  timezone: string;
  requiredPerWeek: number | null;
}) {
  const t = await getTranslations("teams");
  const tCalendar = await getTranslations("calendar");
  const format = await getFormatter();

  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "short", timeZone: "UTC" });
  const dayNumber = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), { day: "numeric", timeZone: "UTC" });
  const time = (value: string) =>
    format.dateTime(new Date(value), { ...TIME_FORMAT, timeZone: timezone });

  const short = requiredPerWeek !== null && week.scheduledCount < requiredPerWeek;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4" aria-hidden />
          {t("trainingWeek")}
        </CardTitle>

        <div className="flex items-center gap-2">
          {requiredPerWeek !== null ? (
            <Badge variant={short ? "destructive" : "secondary"}>
              {t("sessionsThisWeek", {
                count: week.scheduledCount,
                required: requiredPerWeek,
              })}
            </Badge>
          ) : null}

          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon-sm">
              <Link
                href={{ pathname: `/teams/${teamId}`, query: { week: week.previousWeek } }}
                aria-label={tCalendar("previous")}
              >
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon-sm">
              <Link
                href={{ pathname: `/teams/${teamId}`, query: { week: week.nextWeek } }}
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
          {format.dateTimeRange(
            new Date(`${week.weekStart}T12:00:00Z`),
            new Date(`${week.weekEnd}T12:00:00Z`),
            { day: "numeric", month: "short", timeZone: "UTC" },
          )}
        </p>

        <div className="grid gap-2 sm:grid-cols-7">
          {week.days.map((entry) => (
            <div
              key={entry.date}
              className={cn(
                "flex min-h-24 flex-col gap-1 rounded-lg border p-2",
                entry.items.length === 0 && "bg-muted/30",
                week.coverageStart !== null &&
                  entry.date < week.coverageStart &&
                  "border-dashed opacity-50",
              )}
            >
              <p className="text-xs font-medium text-muted-foreground">
                {day(entry.date)} {dayNumber(entry.date)}
              </p>

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
          <p className="text-sm text-muted-foreground">{t("noTrainingThisWeek")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
