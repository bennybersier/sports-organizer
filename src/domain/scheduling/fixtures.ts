/**
 * Fixtures, and the room a fixture takes.
 *
 * A match blocks three different things, and conflating them is how this goes
 * wrong:
 *
 *   the team    cannot train that day, wherever the match is played
 *   the hall    is gone for the match *plus* setup and pack-down
 *   rest days   optionally, whole days either side
 *
 * The rule that keeps them apart is a single sentence, and every caller here
 * follows it: **anything asking "is this space or person free?" uses the
 * occupied window; anything asking "what date is this, and whose match is it?"
 * uses the real times.**
 */

import { addDays, eachDay, toWallClock } from "./timezone";

/** The shape every caller has in hand, whatever it selected the row into. */
export interface OccupyingEvent {
  startAt: string;
  endAt: string;
  allDay: boolean;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** Snake-cased row to the shape this module reads. */
export function toOccupyingEvent(row: {
  start_at: string;
  end_at: string;
  all_day: boolean;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
}): OccupyingEvent {
  return {
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
  };
}

/**
 * The window this event actually takes the hall out of service for.
 *
 * Distinct from the event's own times, and the distinction is the point:
 * people turn up for 18:00, the hall is gone from 16:30. Three separate call
 * sites ask this question, and a schedule where they disagree is worse than
 * one that is simply wrong — it validates on the calendar and fails on
 * generation, or the reverse.
 *
 * Arithmetic on instants rather than wall-clock minutes: "held for an hour
 * beforehand" is an hour of real time, and doing it in local minutes would
 * misbehave across the March and October clock changes.
 *
 * All-day events come back untouched. They already hold the whole day, and the
 * database refuses to store a buffer on one.
 */
export function occupiedWindow(event: OccupyingEvent): { startAt: string; endAt: string } {
  if (event.allDay || (event.bufferBeforeMinutes === 0 && event.bufferAfterMinutes === 0)) {
    return { startAt: event.startAt, endAt: event.endAt };
  }

  const shift = (iso: string, minutes: number) =>
    new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

  return {
    startAt: shift(event.startAt, -event.bufferBeforeMinutes),
    endAt: shift(event.endAt, event.bufferAfterMinutes),
  };
}

/**
 * The club-local dates an event covers, from its **real** times.
 *
 * Never the occupied window: a 60-minute hold after a 22:30 fixture runs past
 * midnight, and nobody would call the following day a match day.
 */
export function eventDates(event: OccupyingEvent, timeZone: string): string[] {
  const start = toWallClock(event.startAt, timeZone);
  const end = toWallClock(event.endAt, timeZone);

  // An all-day event is stored midnight-to-midnight, so its end lands on the
  // next date. Without this a one-day holiday blackens two.
  const last = end.minutes === 0 && end.date > start.date ? addDays(end.date, -1) : end.date;

  return eachDay(start.date, last < start.date ? start.date : last);
}

/**
 * Whether a date falls close enough to one of a team's fixtures to keep it
 * clear, and which fixture is responsible.
 *
 * The match date itself is always blocked — a team cannot be in two places on
 * one evening. `restDays` is the buffer *either side*, so 0 means the match day
 * alone, which is what almost every group wants.
 */
export function restDayReason(
  fixtures: Map<string, string>,
  date: string,
  restDays: number,
): string | null {
  for (let offset = -restDays; offset <= restDays; offset += 1) {
    const title = fixtures.get(addDays(date, offset));
    if (title) return title;
  }
  return null;
}
