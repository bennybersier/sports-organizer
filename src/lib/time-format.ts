/**
 * Times are shown on the 24-hour clock throughout the app.
 *
 * Not a locale decision: the clubs using this read 18:00, and the calendar's
 * own hour axis has always been drawn as 00:00–23:00, so rendering a session
 * on it as "6:00 PM" put two clocks on one screen.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, because the latter is
 * defined in terms of the locale's preference and has historically resolved to
 * h24 in en-US — turning half past midnight into "24:30".
 */
export const TIME_FORMAT = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
} as const;

/** For the places that want a locale's short time rather than bare digits. */
export const SHORT_TIME_FORMAT = {
  timeStyle: "short",
  hourCycle: "h23",
} as const;
