/**
 * Availability primitives.
 *
 * Deliberately pure and dependency-free: the scheduling engine in Phase 5 will
 * lean on these, and it must be testable with in-memory data, with no database
 * and no React anywhere near it.
 *
 * Weekdays are ISO-8601 throughout — 1 = Monday … 7 = Sunday — matching
 * Postgres `extract(isodow)`. Never `Date.getDay()`, which is 0 = Sunday and is
 * the source of endless off-by-one bugs.
 */

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

/**
 * Message key for each weekday, resolved by the caller's translator.
 *
 * Typed as a literal union rather than `string` so a key with no translation is
 * a build error instead of a raw "monday" rendered into the UI.
 */
export const WEEKDAY_KEYS = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
  7: "sunday",
} as const satisfies Record<IsoWeekday, string>;

/**
 * Minutes since midnight for a `HH:MM` or `HH:MM:SS` wall-clock time.
 *
 * `24:00` is a legitimate end-of-day value that Postgres accepts, so it maps to
 * 1440 rather than wrapping to zero. Comparing times as strings would happen to
 * work for this format, but only by accident — and stops working the moment a
 * value arrives with seconds attached, which Postgres does return.
 */
export function toMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) throw new Error(`Not a time: ${time}`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    throw new Error(`Not a valid time of day: ${time}`);
  }
  return hours * 60 + minutes;
}

/** Minutes since midnight back to `HH:MM`. 1440 renders as `24:00`. */
export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Trims a Postgres `time` value (`18:00:00`) to the `HH:MM` a form expects. */
export function normalizeTime(time: string): string {
  return fromMinutes(toMinutes(time));
}

export interface TimeWindow {
  start: string;
  end: string;
}

export interface MinuteWindow {
  start: number;
  end: number;
}

export function toMinuteWindow(window: TimeWindow): MinuteWindow {
  return { start: toMinutes(window.start), end: toMinutes(window.end) };
}

/**
 * Do two windows overlap?
 *
 * Half-open `[start, end)`: a session ending at 18:00 and one starting at 18:00
 * do not overlap. Back-to-back training in the same hall is normal and must not
 * be reported as a conflict.
 */
export function overlaps(a: MinuteWindow, b: MinuteWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

export function durationMinutes(window: MinuteWindow): number {
  return window.end - window.start;
}

/** Sorts and merges touching or overlapping windows into the fewest intervals. */
export function mergeWindows(windows: MinuteWindow[]): MinuteWindow[] {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: MinuteWindow[] = [];

  for (const window of sorted) {
    const last = merged.at(-1);
    // `<=` merges adjacency too: 16:00–18:00 and 18:00–20:00 become one block.
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** Removes `holes` from `base`, returning what is left. */
export function subtractWindows(base: MinuteWindow[], holes: MinuteWindow[]): MinuteWindow[] {
  let result = mergeWindows(base);

  for (const hole of mergeWindows(holes)) {
    const next: MinuteWindow[] = [];
    for (const window of result) {
      if (!overlaps(window, hole)) {
        next.push(window);
        continue;
      }
      if (window.start < hole.start) next.push({ start: window.start, end: hole.start });
      if (hole.end < window.end) next.push({ start: hole.end, end: window.end });
    }
    result = next;
  }
  return result;
}

/** The first window in `windows` that overlaps `candidate`, if any. */
export function findOverlap(
  candidate: MinuteWindow,
  windows: MinuteWindow[],
): MinuteWindow | undefined {
  return windows.find((window) => overlaps(candidate, window));
}

export interface RecurringWindow {
  isoWeekday: IsoWeekday;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
}

export interface AvailabilityException {
  date: string;
  startTime: string | null;
  endTime: string | null;
  type: "UNAVAILABLE" | "AVAILABLE_OVERRIDE";
}

/**
 * Resolves the availability actually in force on a given date.
 *
 * The rule the spec insists on: recurring availability is never the only source
 * of truth. Exceptions win, and they cut both ways —
 *
 *   UNAVAILABLE          removes time (whole day when no times are given)
 *   AVAILABLE_OVERRIDE   adds time that the weekly pattern does not include
 *
 * `date` is an ISO date in the club's scheduling timezone; both the recurring
 * windows and the exceptions are wall-clock in that same zone, so no conversion
 * happens here. Callers turn the result into absolute instants at the point
 * where a timezone is actually known.
 */
export function resolveAvailability(
  date: string,
  isoWeekday: IsoWeekday,
  recurring: RecurringWindow[],
  exceptions: AvailabilityException[],
): MinuteWindow[] {
  const applicable = recurring.filter(
    (window) =>
      window.isoWeekday === isoWeekday &&
      window.validFrom <= date &&
      (window.validUntil === null || window.validUntil >= date),
  );

  let windows = mergeWindows(
    applicable.map((window) => toMinuteWindow({ start: window.startTime, end: window.endTime })),
  );

  const onDate = exceptions.filter((exception) => exception.date === date);

  // Additions first, then removals — a whole-day UNAVAILABLE must be able to
  // clear an AVAILABLE_OVERRIDE, not race it.
  for (const exception of onDate) {
    if (exception.type !== "AVAILABLE_OVERRIDE") continue;
    const window =
      exception.startTime && exception.endTime
        ? toMinuteWindow({ start: exception.startTime, end: exception.endTime })
        : { start: 0, end: 1440 };
    windows = mergeWindows([...windows, window]);
  }

  for (const exception of onDate) {
    if (exception.type !== "UNAVAILABLE") continue;
    const hole =
      exception.startTime && exception.endTime
        ? toMinuteWindow({ start: exception.startTime, end: exception.endTime })
        : { start: 0, end: 1440 };
    windows = subtractWindows(windows, [hole]);
  }

  return windows;
}

/** ISO weekday for an ISO date string, without timezone drift. */
export function isoWeekdayOf(date: string): IsoWeekday {
  // Parsed as UTC deliberately: the input is a plain calendar date, and local
  // parsing would shift it a day either side of midnight in some zones.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/** Total available minutes in a set of windows. */
export function totalMinutes(windows: MinuteWindow[]): number {
  return windows.reduce((sum, window) => sum + durationMinutes(window), 0);
}

/**
 * Can a session of `minutes` fit anywhere in these windows?
 * Used to explain why a team's requirement cannot be met.
 */
export function canFit(windows: MinuteWindow[], minutes: number): boolean {
  return windows.some((window) => durationMinutes(window) >= minutes);
}
