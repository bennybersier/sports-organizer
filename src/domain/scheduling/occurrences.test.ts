import { describe, expect, it } from "vitest";

import { occurrenceDates, overlaps } from "./occurrences";
import { toInstant } from "./timezone";

describe("occurrenceDates", () => {
  it("repeats weekly from the anchor to the end of the season", () => {
    // 2026-09-07 is a Monday.
    expect(occurrenceDates("2026-09-07", 2, "2026-10-05")).toEqual([
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("walks forward when the anchor is past the weekday", () => {
    // Anchored on a Wednesday, asking for Tuesdays: the first is next week.
    expect(occurrenceDates("2026-09-09", 2, "2026-09-30")[0]).toBe("2026-09-15");
  });

  it("includes the final date when it lands on the weekday", () => {
    const dates = occurrenceDates("2026-09-07", 1, "2026-09-21");
    expect(dates.at(-1)).toBe("2026-09-21");
  });

  it("crosses the new year", () => {
    const dates = occurrenceDates("2026-12-21", 1, "2027-01-11");
    expect(dates).toEqual(["2026-12-21", "2026-12-28", "2027-01-04", "2027-01-11"]);
  });

  it("returns nothing when the window is empty or inverted", () => {
    expect(occurrenceDates("2026-09-07", 2, "2026-09-01")).toEqual([]);
  });

  /*
    The reason occurrences are dates rather than timestamps: a session at 18:00
    must stay at 18:00 after the clocks change. Adding seven *days* to a date
    does that; adding 168 hours to an instant silently shifts the session an
    hour earlier for the rest of the winter.
  */
  it("keeps the wall-clock time across a DST change", () => {
    const zone = "Europe/Rome";
    const dates = occurrenceDates("2026-10-19", 1, "2026-11-02");
    const utcHours = dates.map((date) => toInstant(date, 18 * 60, zone).getUTCHours());

    expect(dates).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
    // Same local time, different UTC offsets either side of the change.
    expect(utcHours).toEqual([16, 17, 17]);
  });
});

describe("overlaps", () => {
  it("treats back-to-back bookings as compatible", () => {
    expect(
      overlaps(
        { start: "2026-09-08T16:00:00Z", end: "2026-09-08T18:00:00Z" },
        { start: "2026-09-08T18:00:00Z", end: "2026-09-08T20:00:00Z" },
      ),
    ).toBe(false);
  });

  it("catches a partial overlap", () => {
    expect(
      overlaps(
        { start: "2026-09-08T16:00:00Z", end: "2026-09-08T18:00:00Z" },
        { start: "2026-09-08T17:00:00Z", end: "2026-09-08T19:00:00Z" },
      ),
    ).toBe(true);
  });
});
