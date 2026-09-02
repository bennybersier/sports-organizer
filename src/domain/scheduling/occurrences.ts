/**
 * Turning a weekly pattern into real dates.
 *
 * The optimizer plans one representative week — "U16, Tuesdays, 18:00, Hall A".
 * A club does not train for one week, so every one of those weekly slots is
 * materialised as a real dated session for each week of the season. Every
 * occurrence of one slot shares a `seriesId`, which is what makes "cancel this
 * session" and "cancel this event" two different, meaningful things.
 *
 * Kept pure and separate from the database so the date arithmetic — the part
 * that quietly breaks across DST and year boundaries — is directly testable.
 */
import { addDays, isoWeekdayOfDate } from "@/domain/scheduling/timezone";
import type { IsoWeekday } from "@/domain/availability";

/**
 * Every date on `isoWeekday` from `from` through `until` inclusive.
 *
 * Dates are plain calendar dates, never instants: adding 7 days to a date is
 * DST-safe in a way that adding 168 hours to a timestamp is not. The wall-clock
 * time is applied afterwards, per date, in the club's zone — so a session at
 * 18:00 stays at 18:00 through a clock change rather than drifting to 17:00.
 */
export function occurrenceDates(
  from: string,
  isoWeekday: IsoWeekday,
  until: string,
): string[] {
  if (until < from) return [];

  // Walk forward to the first matching weekday rather than assuming `from` is
  // one: the anchor week starts on whatever day generation was run.
  const offset = (isoWeekday - isoWeekdayOfDate(from) + 7) % 7;
  const dates: string[] = [];

  for (let date = addDays(from, offset); date <= until; date = addDays(date, 7)) {
    dates.push(date);
  }

  return dates;
}

/** Half-open overlap, so back-to-back bookings are not a clash. */
export function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  return a.start < b.end && b.start < a.end;
}
