"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { AgendaView } from "./agenda-view";
import { MonthGrid } from "./month-grid";
import { WeekGrid } from "./week-grid";
import { EventSheet } from "./event-sheet";
import type { CalendarView } from "./calendar-toolbar";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { EventDialogOptions } from "@/app/(app)/calendar/new-event-button";

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
        <MonthGrid
          weeks={props.monthWeeks}
          weekdayLabels={props.weekdayLabels}
          onSelect={setSelected}
        />
      ) : props.view === "agenda" ? (
        <AgendaView groups={props.groups} timeZone={props.timeZone} onSelect={setSelected} />
      ) : (
        <>
          {/* A time grid is unreadable on a phone, so small screens get the
              agenda instead of a shrunken version of the wrong thing. */}
          <div className="hidden md:block">
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
          <div className="md:hidden">
            <AgendaView groups={props.groups} timeZone={props.timeZone} onSelect={setSelected} />
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
            : `${format.dateTime(new Date(item.startAt), { dateStyle: "full", timeStyle: "short", timeZone: props.timeZone })} – ${format.dateTime(new Date(item.endAt), { timeStyle: "short", timeZone: props.timeZone })}`
        }
      />
    </>
  );
}
