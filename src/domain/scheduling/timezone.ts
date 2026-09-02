import { TZDate } from "@date-fns/tz";

import type { IsoWeekday } from "@/domain/availability";

/**
 * Conversion between absolute instants and the club's wall clock.
 *
 * Events are stored as `timestamptz` — real instants. Availability is stored as
 * wall-clock time in the club's scheduling timezone. Comparing the two means
 * converting, and the conversion is where daylight saving bites: on the last
 * Sunday in March, Europe/Zurich has no 02:30 at all, and in October it has two.
 *
 * Everything here goes through `TZDate` rather than manual offset arithmetic,
 * because an offset is not a constant — it is a function of the instant.
 */

export interface WallClock {
  /** ISO date in the club's timezone. */
  date: string;
  /** Minutes from midnight, in the club's timezone. */
  minutes: number;
  /** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
}

/** Where an instant falls on the club's wall clock. */
export function toWallClock(instant: Date | string, timeZone: string): WallClock {
  const zoned = new TZDate(new Date(instant), timeZone);
  const day = zoned.getDay();

  return {
    date: `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`,
    minutes: zoned.getHours() * 60 + zoned.getMinutes(),
    isoWeekday: day === 0 ? 7 : day,
  };
}

/**
 * The instant at which a given wall-clock time occurs in a timezone.
 *
 * For a time that does not exist (the spring-forward gap) the result lands on
 * the far side of the jump rather than throwing — which is what a calendar
 * should do with a session nominally scheduled inside the missing hour.
 */
export function toInstant(date: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return new Date(
    new TZDate(year, month - 1, day, hours, mins, 0, 0, timeZone).getTime(),
  );
}

/** `HH:MM` on the club's clock. */
export function formatWallTime(instant: Date | string, timeZone: string): string {
  const { minutes } = toWallClock(instant, timeZone);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Start of a day in the club's timezone, as an instant. */
export function startOfDayInZone(date: string, timeZone: string): Date {
  return toInstant(date, 0, timeZone);
}

/** Start of the day *after* `date` — the exclusive upper bound of a range. */
export function endOfDayInZone(date: string, timeZone: string): Date {
  return toInstant(addDays(date, 1), 0, timeZone);
}

/** Adds whole days to an ISO date. Calendar arithmetic, no timezone involved. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekdayOfDate(date: string): IsoWeekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/**
 * The date the club's week containing `date` starts on.
 * `weekStart` is ISO: 1 = Monday … 7 = Sunday.
 */
export function startOfWeek(date: string, weekStart: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() === 0 ? 7 : value.getUTCDay();
  const back = (day - weekStart + 7) % 7;
  return addDays(date, -back);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function todayInZone(timeZone: string): string {
  return toWallClock(new Date(), timeZone).date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
