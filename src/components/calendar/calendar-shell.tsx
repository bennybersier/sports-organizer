"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { AgendaView } from "./agenda-view";
import { MonthGrid } from "./month-grid";
import { MobileCalendar } from "./mobile-calendar";
import { WeekGrid } from "./week-grid";
import { EventSheet } from "./event-sheet";
import type { CalendarView } from "./calendar-toolbar";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { EventDialogOptions } from "@/app/(app)/calendar/new-event-button";
import { SHORT_TIME_FORMAT } from "@/lib/time-format";

export interface CalendarShellProps {
  view: CalendarView;
  timeZone: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Pickers the event editor needs. */
  eventOptions: EventDialogOptions;
  days: { date: string; label: string; isToday: boolean }[];
  positioned: (CalendarItem & { startMinutes: number; endMinutes: number; date: string })[];
  groups: { date: string; label: string; isToday: boolean; items: CalendarItem[] }[];
  monthWeeks: {
    date: string;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    items: CalendarItem[];
  }[][];
  weekdayLabels: string[];
  dayStartHour: number;
  dayEndHour: number;
}

/**
 * Picks the view and owns the selected-item state.
 *
 * The views are separate components rather than one configurable grid: a month
 * cell, a week column and an agenda row have almost nothing in common beyond
 * the data, and pretending otherwise makes all three worse.
 */
export function CalendarShell(props: CalendarShellProps) {
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const t = useTranslations("calendar");
  const format = useFormatter();

  const view = (
    <>
      {props.view === "month" ? (
        <>
          {/* A month of named events does not fit a phone; dates with dots,
              then the chosen day in full, does. */}
          <div className="hidden lg:block">
            <MonthGrid
              weeks={props.monthWeeks}
              weekdayLabels={props.weekdayLabels}
              timeZone={props.timeZone}
              onSelect={setSelected}
            />
          </div>
          <div className="lg:hidden">
            <MobileCalendar
              weeks={props.monthWeeks}
              weekdayLabels={props.weekdayLabels}
              timeZone={props.timeZone}
              onSelect={setSelected}
            />
          </div>
        </>
      ) : props.view === "agenda" ? (
        <AgendaView groups={props.groups} timeZone={props.timeZone} onSelect={setSelected} />
      ) : (
        <>
          {/* An hour grid needs width it does not have on a phone or on a
              tablet held upright, so those get the touch layout instead of a
              squeezed version of the wrong thing. */}
          <div className="hidden lg:block">
            <WeekGrid
              days={props.days}
              items={props.positioned}
              dayStartHour={props.dayStartHour}
              dayEndHour={props.dayEndHour}
              timeZone={props.timeZone}
              canEdit={props.canEdit}
              onSelect={setSelected}
            />
          </div>
          {/* The same shape as the month, one week wide. */}
          <div className="lg:hidden">
            <MobileCalendar
              weeks={[
                props.groups.map((group) => ({
                  date: group.date,
                  day: Number(group.date.slice(8, 10)),
                  inMonth: true,
                  isToday: group.isToday,
                  items: group.items,
                })),
              ]}
              weekdayLabels={props.weekdayLabels}
              timeZone={props.timeZone}
              onSelect={setSelected}
            />
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      {view}
      <EventSheet
        item={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        canEdit={props.canEdit}
        canDelete={props.canDelete}
        options={props.eventOptions}
        formatRange={(item) =>
          item.allDay
            ? t("allDay")
            : `${format.dateTime(new Date(item.startAt), { dateStyle: "full", ...SHORT_TIME_FORMAT, timeZone: props.timeZone })} – ${format.dateTime(new Date(item.endAt), { ...SHORT_TIME_FORMAT, timeZone: props.timeZone })}`
        }
      />
    </>
  );
}
