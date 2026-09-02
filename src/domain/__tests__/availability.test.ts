import { describe, expect, it } from "vitest";

import {
  canFit,
  fromMinutes,
  isoWeekdayOf,
  mergeWindows,
  overlaps,
  resolveAvailability,
  subtractWindows,
  toMinutes,
  totalMinutes,
  type AvailabilityException,
  type RecurringWindow,
} from "../availability";

const w = (start: number, end: number) => ({ start, end });

describe("toMinutes", () => {
  it("parses HH:MM and HH:MM:SS alike", () => {
    // Postgres returns `time` with seconds; forms submit without.
    expect(toMinutes("18:00")).toBe(1080);
    expect(toMinutes("18:00:00")).toBe(1080);
    expect(toMinutes("09:30")).toBe(570);
  });

  it("treats 24:00 as end of day rather than wrapping to zero", () => {
    expect(toMinutes("24:00")).toBe(1440);
    expect(fromMinutes(1440)).toBe("24:00");
  });

  it("rejects nonsense instead of silently coercing it", () => {
    expect(() => toMinutes("25:00")).toThrow();
    expect(() => toMinutes("18:60")).toThrow();
    expect(() => toMinutes("24:01")).toThrow();
    expect(() => toMinutes("evening")).toThrow();
  });
});

describe("overlaps", () => {
  it("treats windows as half-open, so back-to-back sessions don't conflict", () => {
    // 16:00–18:00 then 18:00–20:00 in the same hall is normal scheduling.
    expect(overlaps(w(960, 1080), w(1080, 1200))).toBe(false);
  });

  it("detects genuine overlap in both directions", () => {
    expect(overlaps(w(960, 1140), w(1080, 1200))).toBe(true);
    expect(overlaps(w(1080, 1200), w(960, 1140))).toBe(true);
  });

  it("detects containment", () => {
    expect(overlaps(w(960, 1200), w(1020, 1080))).toBe(true);
  });
});

describe("mergeWindows", () => {
  it("merges overlapping and adjacent windows", () => {
    expect(mergeWindows([w(960, 1080), w(1080, 1200)])).toEqual([w(960, 1200)]);
    expect(mergeWindows([w(960, 1140), w(1080, 1200)])).toEqual([w(960, 1200)]);
  });

  it("keeps genuinely separate windows apart and sorts them", () => {
    expect(mergeWindows([w(1200, 1320), w(600, 720)])).toEqual([w(600, 720), w(1200, 1320)]);
  });
});

describe("subtractWindows", () => {
  it("punches a hole in the middle, leaving two windows", () => {
    expect(subtractWindows([w(960, 1320)], [w(1080, 1140)])).toEqual([
      w(960, 1080),
      w(1140, 1320),
    ]);
  });

  it("trims from either edge", () => {
    expect(subtractWindows([w(960, 1320)], [w(900, 1020)])).toEqual([w(1020, 1320)]);
    expect(subtractWindows([w(960, 1320)], [w(1260, 1400)])).toEqual([w(960, 1260)]);
  });

  it("removes a window entirely when fully covered", () => {
    expect(subtractWindows([w(960, 1320)], [w(900, 1400)])).toEqual([]);
  });

  it("leaves a non-overlapping window untouched", () => {
    expect(subtractWindows([w(960, 1080)], [w(1200, 1320)])).toEqual([w(960, 1080)]);
  });
});

describe("resolveAvailability", () => {
  const recurring: RecurringWindow[] = [
    { isoWeekday: 1, startTime: "16:00", endTime: "22:00", validFrom: "2026-08-01", validUntil: null },
    { isoWeekday: 3, startTime: "17:00", endTime: "21:00", validFrom: "2026-08-01", validUntil: null },
  ];

  it("returns the weekly pattern when nothing else applies", () => {
    // 2026-09-07 is a Monday.
    expect(resolveAvailability("2026-09-07", 1, recurring, [])).toEqual([w(960, 1320)]);
  });

  it("returns nothing for a weekday with no pattern", () => {
    expect(resolveAvailability("2026-09-08", 2, recurring, [])).toEqual([]);
  });

  it("ignores windows outside their validity range", () => {
    const expired: RecurringWindow[] = [
      { isoWeekday: 1, startTime: "16:00", endTime: "22:00", validFrom: "2026-08-01", validUntil: "2026-08-31" },
    ];
    expect(resolveAvailability("2026-09-07", 1, expired, [])).toEqual([]);
    expect(resolveAvailability("2026-08-10", 1, expired, [])).toEqual([w(960, 1320)]);
  });

  it("subtracts a partial UNAVAILABLE exception", () => {
    const exceptions: AvailabilityException[] = [
      { date: "2026-09-07", startTime: "18:00", endTime: "19:00", type: "UNAVAILABLE" },
    ];
    expect(resolveAvailability("2026-09-07", 1, recurring, exceptions)).toEqual([
      w(960, 1080),
      w(1140, 1320),
    ]);
  });

  it("clears the day for a whole-day UNAVAILABLE", () => {
    const exceptions: AvailabilityException[] = [
      { date: "2026-09-07", startTime: null, endTime: null, type: "UNAVAILABLE" },
    ];
    expect(resolveAvailability("2026-09-07", 1, recurring, exceptions)).toEqual([]);
  });

  it("adds time the weekly pattern does not include", () => {
    // A trainer offering a one-off Tuesday session.
    const exceptions: AvailabilityException[] = [
      { date: "2026-09-08", startTime: "18:00", endTime: "20:00", type: "AVAILABLE_OVERRIDE" },
    ];
    expect(resolveAvailability("2026-09-08", 2, recurring, exceptions)).toEqual([w(1080, 1200)]);
  });

  it("lets a whole-day closure beat a same-day override", () => {
    // Order must not decide the outcome: the hall is shut, so it is shut.
    const exceptions: AvailabilityException[] = [
      { date: "2026-09-07", startTime: "18:00", endTime: "20:00", type: "AVAILABLE_OVERRIDE" },
      { date: "2026-09-07", startTime: null, endTime: null, type: "UNAVAILABLE" },
    ];
    expect(resolveAvailability("2026-09-07", 1, recurring, exceptions)).toEqual([]);
  });

  it("ignores exceptions dated to another day", () => {
    const exceptions: AvailabilityException[] = [
      { date: "2026-09-14", startTime: null, endTime: null, type: "UNAVAILABLE" },
    ];
    expect(resolveAvailability("2026-09-07", 1, recurring, exceptions)).toEqual([w(960, 1320)]);
  });
});

describe("isoWeekdayOf", () => {
  it("uses ISO numbering, with Sunday as 7", () => {
    expect(isoWeekdayOf("2026-09-07")).toBe(1); // Monday
    expect(isoWeekdayOf("2026-09-13")).toBe(7); // Sunday
  });

  it("does not drift across midnight", () => {
    // Parsed as UTC: local parsing shifts the date in negative-offset zones.
    expect(isoWeekdayOf("2026-01-01")).toBe(4); // Thursday
  });
});

describe("capacity helpers", () => {
  it("totals available minutes", () => {
    expect(totalMinutes([w(960, 1080), w(1140, 1320)])).toBe(300);
  });

  it("reports whether a session fits in one contiguous block", () => {
    // 300 minutes total, but the longest single block is 180.
    const windows = [w(960, 1080), w(1140, 1320)];
    expect(canFit(windows, 120)).toBe(true);
    expect(canFit(windows, 180)).toBe(true);
    expect(canFit(windows, 240)).toBe(false);
  });
});
