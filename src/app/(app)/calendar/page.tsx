import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { CalendarShell } from "@/components/calendar/calendar-shell";
import { CalendarToolbar, type CalendarView } from "@/components/calendar/calendar-toolbar";
import { WEEKDAY_KEYS, type IsoWeekday } from "@/domain/availability";
import {
  addDays,
  eachDay,
  endOfMonth,
  startOfMonth,
  startOfWeek,
  todayInZone,
  toWallClock,
} from "@/domain/scheduling/timezone";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listCalendarItems } from "@/server/services/calendar-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTeamOptions } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";

import { NewEventButton } from "./new-event-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendar");
  return { title: t("title") };
}

const VIEWS: CalendarView[] = ["day", "week", "month", "agenda"];
const EVENT_TYPES = [
  "TRAINING",
  "MATCH",
  "TOURNAMENT",
  "HOLIDAY",
  "BLACKOUT",
  "SPECIAL_EVENT",
  "MEETING",
] as const;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "calendar.read")) return <AccessDenied />;

  const t = await getTranslations("calendar");
  const tWeekdays = await getTranslations("weekdays");
  const format = await getFormatter();

  const raw = await searchParams;
  const pick = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);

  const zone = context.tenant.timezone;
  const today = todayInZone(zone);
  const view = (VIEWS.includes(pick("view") as CalendarView) ? pick("view") : "week") as CalendarView;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(pick("date") ?? "") ? pick("date")! : today;
  const weekStart = context.tenant.weekStart;

  // Each view owns a different range; everything downstream just gets from/to.
  const { from, to, previousDate, nextDate } = resolveRange(view, anchor, weekStart);

  const [items, teams, trainers, gyms, seasons] = await Promise.all([
    listCalendarItems(context, from, to, {
      seasonId: pick("season"),
      teamId: pick("team"),
      trainerId: pick("trainer"),
      gymId: pick("gym"),
      type: pick("type"),
    }),
    hasPermission(context, "teams.read") ? listTeamOptions(context) : Promise.resolve([]),
    hasPermission(context, "trainers.read") ? listTrainerOptions(context) : Promise.resolve([]),
    hasPermission(context, "gyms.read") ? listGymOptions(context) : Promise.resolve([]),
    hasPermission(context, "seasons.read") ? listSeasonOptions(context) : Promise.resolve([]),
  ]);

  // One set of pickers, shared by the create button and the edit form.
  const eventOptions = {
    seasons: seasons.map((season) => ({ value: season.id, label: season.name })),
    gyms: gyms.map((gym) => ({ value: gym.id, label: gym.name })),
    trainers: trainers.map((trainer) => ({
      value: trainer.id,
      label: `${trainer.first_name} ${trainer.last_name}`,
    })),
    teams: teams.map((team) => ({ value: team.id, label: team.name })),
  };

  // Position every item on the club's wall clock, once, on the server.
  const positioned = items.map((item) => {
    const start = toWallClock(item.startAt, zone);
    const end = toWallClock(item.endAt, zone);
    return {
      ...item,
      date: start.date,
      startMinutes: start.minutes,
      endMinutes: end.date === start.date ? end.minutes : 1440,
    };
  });

  // The grid spans the hours the club actually uses, with a little air, rather
  // than a fixed 00:00–24:00 that is mostly empty.
  const usedStart = Math.min(...positioned.map((item) => item.startMinutes), 16 * 60);
  const usedEnd = Math.max(...positioned.map((item) => item.endMinutes), 22 * 60);
  const dayStartHour = Math.max(0, Math.floor(usedStart / 60) - 1);
  const dayEndHour = Math.min(24, Math.ceil(usedEnd / 60) + 1);


  const dates = eachDay(from, to);
  const days = dates.map((date) => ({
    date,
    label: format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "short", day: "numeric" }),
    isToday: date === today,
  }));

  const groups = dates.map((date) => ({
    date,
    label: format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: "full" }),
    isToday: date === today,
    items: items.filter((item) => toWallClock(item.startAt, zone).date === date),
  }));

  const monthWeeks = view === "month" ? buildMonthWeeks(from, to, anchor, today, items, zone) : [];

  const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
    const weekday = (((weekStart - 1 + index) % 7) + 1) as IsoWeekday;
    return tWeekdays(WEEKDAY_KEYS[weekday]);
  });

  const publishedMissing =
    items.every((item) => item.source !== "SCHEDULE") && seasons.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          hasPermission(context, "calendar.create") ? (
            <NewEventButton {...eventOptions} />
          ) : null
        }
      />

      <CalendarToolbar
        view={view}
        label={rangeLabel(view, from, to, anchor, format, t)}
        previousDate={previousDate}
        nextDate={nextDate}
        today={today}
        teams={teams.map((team) => ({ value: team.id, label: team.name }))}
        trainers={trainers.map((trainer) => ({
          value: trainer.id,
          label: `${trainer.first_name} ${trainer.last_name}`,
        }))}
        gyms={gyms.map((gym) => ({ value: gym.id, label: gym.name }))}
        types={EVENT_TYPES.map((type) => ({ value: type, label: t(type) }))}
      />

      {publishedMissing ? (
        <Alert>
          <AlertDescription>{t("noPublishedSchedule")}</AlertDescription>
        </Alert>
      ) : null}

      <CalendarShell
        view={view}
        timeZone={zone}
        canEdit={hasPermission(context, "calendar.update")}
        canDelete={hasPermission(context, "calendar.delete")}
        eventOptions={eventOptions}
        days={days}
        positioned={positioned}
        groups={groups}
        monthWeeks={monthWeeks}
        weekdayLabels={weekdayLabels}
        dayStartHour={dayStartHour}
        dayEndHour={dayEndHour}
      />
    </div>
  );
}

function resolveRange(view: CalendarView, anchor: string, weekStart: number) {
  switch (view) {
    case "day":
      return {
        from: anchor,
        to: anchor,
        previousDate: addDays(anchor, -1),
        nextDate: addDays(anchor, 1),
      };
    case "month": {
      const first = startOfMonth(anchor);
      const last = endOfMonth(anchor);
      return {
        // Pad to whole weeks so the grid is rectangular.
        from: startOfWeek(first, weekStart),
        to: addDays(startOfWeek(last, weekStart), 6),
        previousDate: addDays(first, -1),
        nextDate: addDays(last, 1),
      };
    }
    case "agenda": {
      return {
        from: anchor,
        to: addDays(anchor, 27),
        previousDate: addDays(anchor, -28),
        nextDate: addDays(anchor, 28),
      };
    }
    default: {
      const start = startOfWeek(anchor, weekStart);
      return {
        from: start,
        to: addDays(start, 6),
        previousDate: addDays(start, -7),
        nextDate: addDays(start, 7),
      };
    }
  }
}

function rangeLabel(
  view: CalendarView,
  from: string,
  to: string,
  anchor: string,
  format: Awaited<ReturnType<typeof getFormatter>>,
  t: Awaited<ReturnType<typeof getTranslations<"calendar">>>,
): string {
  const at = (date: string) => new Date(`${date}T12:00:00Z`);
  if (view === "day") return format.dateTime(at(anchor), { dateStyle: "full" });
  if (view === "month") return format.dateTime(at(anchor), { month: "long", year: "numeric" });
  if (view === "agenda")
    return `${format.dateTime(at(from), { dateStyle: "medium" })} – ${format.dateTime(at(to), { dateStyle: "medium" })}`;
  return t("weekOf", { date: format.dateTime(at(from), { dateStyle: "medium" }) });
}

function buildMonthWeeks(
  from: string,
  to: string,
  anchor: string,
  today: string,
  items: Awaited<ReturnType<typeof listCalendarItems>>,
  zone: string,
) {
  const month = anchor.slice(0, 7);

  const dates = eachDay(from, to);
  const weeks: {
    date: string;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    items: typeof items;
  }[][] = [];

  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(
      dates.slice(index, index + 7).map((date) => ({
        date,
        day: Number(date.slice(8)),
        inMonth: date.slice(0, 7) === month,
        isToday: date === today,
        items: items.filter((item) => toWallClock(item.startAt, zone).date === date),
      })),
    );
  }
  return weeks;
}
