import { describe, expect, it } from "vitest";

import {
  addDays,
  eachDay,
  endOfMonth,
  formatWallTime,
  startOfMonth,
  startOfWeek,
  toInstant,
  toWallClock,
} from "./timezone";

const ZURICH = "Europe/Zurich";

describe("toWallClock", () => {
  it("converts an instant to the club's wall clock", () => {
    // 18:00 Zurich in winter is 17:00 UTC.
    expect(toWallClock("2026-01-15T17:00:00Z", ZURICH)).toEqual({
      date: "2026-01-15",
      minutes: 1080,
      isoWeekday: 4,
    });
  });

  it("accounts for summer time", () => {
    // The same 18:00 local is 16:00 UTC in July — the offset is not a constant.
    expect(toWallClock("2026-07-15T16:00:00Z", ZURICH).minutes).toBe(1080);
  });

  it("can land on a different calendar date than UTC", () => {
    // 23:30 UTC is already the next day in Zurich.
    expect(toWallClock("2026-01-15T23:30:00Z", ZURICH).date).toBe("2026-01-16");
  });

  it("uses ISO weekday numbering, with Sunday as 7", () => {
    expect(toWallClock("2026-01-18T12:00:00Z", ZURICH).isoWeekday).toBe(7);
  });
});

describe("toInstant", () => {
  it("round-trips a winter time", () => {
    const instant = toInstant("2026-01-15", 1080, ZURICH);
    expect(instant.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("round-trips a summer time, shifting the UTC offset", () => {
    const instant = toInstant("2026-07-15", 1080, ZURICH);
    expect(instant.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("round-trips through wall clock for both halves of the year", () => {
    for (const date of ["2026-01-15", "2026-07-15", "2026-03-29", "2026-10-25"]) {
      const back = toWallClock(toInstant(date, 1140, ZURICH), ZURICH);
      expect(back.date).toBe(date);
      expect(back.minutes).toBe(1140);
    }
  });

  it("resolves the spring-forward gap instead of throwing", () => {
    // 2026-03-29 02:30 Zurich does not exist: the clock jumps 02:00 -> 03:00.
    const instant = toInstant("2026-03-29", 150, ZURICH);
    expect(Number.isNaN(instant.getTime())).toBe(false);
    // It lands on the far side of the jump.
    expect(toWallClock(instant, ZURICH).minutes).toBeGreaterThanOrEqual(150);
  });

  it("handles the autumn repeated hour without drifting the date", () => {
    // 2026-10-25 02:30 Zurich happens twice; either is acceptable, but the
    // calendar date must not slip.
    const instant = toInstant("2026-10-25", 150, ZURICH);
    expect(toWallClock(instant, ZURICH).date).toBe("2026-10-25");
  });

  it("keeps an 18:00 session at 18:00 across a DST boundary", () => {
    // The practical guarantee: training at 18:00 stays at 18:00 for the people
    // attending it, even though the UTC instant shifts by an hour.
    const before = toInstant("2026-10-24", 1080, ZURICH);
    const after = toInstant("2026-10-26", 1080, ZURICH);
    expect(formatWallTime(before, ZURICH)).toBe("18:00");
    expect(formatWallTime(after, ZURICH)).toBe("18:00");
    expect(before.toISOString()).not.toBe(after.toISOString());
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the start of the week for either convention", () => {
    // 2026-09-09 is a Wednesday.
    expect(startOfWeek("2026-09-09", 1)).toBe("2026-09-07"); // Monday
    expect(startOfWeek("2026-09-09", 7)).toBe("2026-09-06"); // Sunday
  });

  it("returns the same date when it already is the week start", () => {
    expect(startOfWeek("2026-09-07", 1)).toBe("2026-09-07");
  });

  it("finds month bounds, including a leap February", () => {
    expect(startOfMonth("2026-09-17")).toBe("2026-09-01");
    expect(endOfMonth("2026-09-17")).toBe("2026-09-30");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("enumerates an inclusive range", () => {
    expect(eachDay("2026-09-07", "2026-09-13")).toHaveLength(7);
    expect(eachDay("2026-09-07", "2026-09-07")).toEqual(["2026-09-07"]);
  });
});
