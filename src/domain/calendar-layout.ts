/**
 * How a week grid finds room for sessions that happen at once.
 *
 * A calendar normally places a session by its start and duration and lets
 * concurrent ones share the width. That assumes a handful at a time. This club
 * runs seven concurrent sessions on a normal evening and nine on its busiest —
 * ten halls, thirty teams, everyone training between four and nine — and a
 * ninth of a day column is about twenty-five pixels. Sharing the width there
 * does not produce a dense calendar, it produces a row of stripes reading
 * "Un…", which is no more useful than drawing them on top of each other.
 *
 * So the width is never divided. Every session keeps the full column and the
 * *row* grows instead: an hour in which four teams train is four cards tall.
 * The cost is that height no longer means duration, which is why each card
 * states its own times. The gain is that every session is fully readable, which
 * is the only property that actually matters when reading a schedule.
 */

export interface TimeSpan {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Groups a day's sessions into the hour rows they start in.
 *
 * Keyed by start rather than by span: a session that runs 19:00-21:00 belongs
 * to the 19:00 row and is not repeated in the 20:00 one. Repeating it would
 * double every long session in the grid and make the count of "how many are on
 * at once" meaningless.
 */
export function bucketByHour<T extends TimeSpan>(
  items: T[],
  dayStartHour: number,
  dayEndHour: number,
): Map<number, T[]> {
  const buckets = new Map<number, T[]>();

  for (const item of items) {
    // Anything starting before the grid does is shown in its first row rather
    // than dropped — an early session is still this day's business.
    const hour = Math.min(
      Math.max(Math.floor(item.startMinutes / 60), dayStartHour),
      dayEndHour - 1,
    );
    const bucket = buckets.get(hour);
    if (bucket) bucket.push(item);
    else buckets.set(hour, [item]);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  }

  return buckets;
}

/**
 * How many cards tall each hour row has to be.
 *
 * One row height across the whole week, per hour, because the seven days are
 * read across: a Tuesday card that sat higher than Wednesday's for the same
 * hour would make the two look like different times.
 */
export function rowDepths<T extends TimeSpan>(
  days: { date: string; items: T[] }[],
  dayStartHour: number,
  dayEndHour: number,
): Map<number, number> {
  const perDay = days.map((day) => bucketByHour(day.items, dayStartHour, dayEndHour));
  const depths = new Map<number, number>();

  for (let hour = dayStartHour; hour < dayEndHour; hour += 1) {
    const deepest = perDay.reduce(
      (most, buckets) => Math.max(most, buckets.get(hour)?.length ?? 0),
      0,
    );
    // An empty hour still needs a row, or the grid loses its scale entirely.
    depths.set(hour, Math.max(1, deepest));
  }

  return depths;
}
