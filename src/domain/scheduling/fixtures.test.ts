import { describe, expect, it } from "vitest";

import { eventDates, occupiedWindow, restDayReason } from "./fixtures";

const ROME = "Europe/Rome";

const event = (overrides: Partial<Parameters<typeof occupiedWindow>[0]> = {}) => ({
  startAt: "2026-10-17T16:00:00.000Z", // 18:00 in Rome
  endAt: "2026-10-17T18:00:00.000Z", // 20:00 in Rome
  allDay: false,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  ...overrides,
});

describe("occupiedWindow", () => {
  it("widens by the buffers either side", () => {
    const result = occupiedWindow(event({ bufferBeforeMinutes: 90, bufferAfterMinutes: 60 }));
    // 18:00–20:00 in Rome becomes 16:30–21:00.
    expect(result.startAt).toBe("2026-10-17T14:30:00.000Z");
    expect(result.endAt).toBe("2026-10-17T19:00:00.000Z");
  });

  it("returns the event's own times when there is no buffer", () => {
    const plain = event();
    expect(occupiedWindow(plain)).toEqual({ startAt: plain.startAt, endAt: plain.endAt });
  });

  it("handles asymmetric buffers", () => {
    const result = occupiedWindow(event({ bufferBeforeMinutes: 45, bufferAfterMinutes: 15 }));
    expect(result.startAt).toBe("2026-10-17T15:15:00.000Z");
    expect(result.endAt).toBe("2026-10-17T18:15:00.000Z");
  });

  it("leaves an all-day event alone even if a buffer somehow got stored", () => {
    // The database refuses this combination; the helper must not depend on that
    // being true, because it is the fourth caller that finds out otherwise.
    const allDay = event({ allDay: true, bufferBeforeMinutes: 60, bufferAfterMinutes: 60 });
    expect(occupiedWindow(allDay)).toEqual({ startAt: allDay.startAt, endAt: allDay.endAt });
  });

  it("shifts by real time across the October clock change", () => {
    // 2026-10-25 02:00 UTC is the hour Italy goes back. A 60-minute hold is
    // sixty minutes of real time, not a wall-clock hour that repeats itself.
    const result = occupiedWindow(
      event({
        startAt: "2026-10-25T01:30:00.000Z",
        endAt: "2026-10-25T03:00:00.000Z",
        bufferBeforeMinutes: 60,
      }),
    );
    expect(result.startAt).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("eventDates", () => {
  it("reports one date for an evening fixture", () => {
    expect(eventDates(event(), ROME)).toEqual(["2026-10-17"]);
  });

  it("still reports one date when the buffer would run past midnight", () => {
    /*
      The real-versus-occupied split under test. A 22:30–00:00 fixture with an
      hour's pack-down holds the hall until 01:00 the next day, but it is one
      match on one date — a rest-day rule reading the occupied window would
      wrongly close the following day too.
    */
    const late = event({
      startAt: "2026-10-17T20:30:00.000Z", // 22:30 Rome
      endAt: "2026-10-17T22:00:00.000Z", // 00:00 Rome
      bufferAfterMinutes: 60,
    });
    expect(eventDates(late, ROME)).toEqual(["2026-10-17"]);
  });

  it("does not blacken a second day for a one-day all-day event", () => {
    // Stored midnight to midnight, so the end lands on the 18th.
    const holiday = event({
      startAt: "2026-10-16T22:00:00.000Z", // 2026-10-17 00:00 Rome
      endAt: "2026-10-17T22:00:00.000Z", // 2026-10-18 00:00 Rome
      allDay: true,
    });
    expect(eventDates(holiday, ROME)).toEqual(["2026-10-17"]);
  });

  it("spans every day of a week-long tournament", () => {
    const tournament = event({
      startAt: "2026-10-16T22:00:00.000Z",
      endAt: "2026-10-20T22:00:00.000Z",
      allDay: true,
    });
    expect(eventDates(tournament, ROME)).toEqual([
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
  });
});

describe("restDayReason", () => {
  const fixtures = new Map([["2026-10-17", "vs Virtus"]]);

  it("blocks the match day itself with no rest days at all", () => {
    expect(restDayReason(fixtures, "2026-10-17", 0)).toBe("vs Virtus");
  });

  it("leaves the day before and after free when rest days are zero", () => {
    expect(restDayReason(fixtures, "2026-10-16", 0)).toBeNull();
    expect(restDayReason(fixtures, "2026-10-18", 0)).toBeNull();
  });

  it("closes both sides with one rest day", () => {
    expect(restDayReason(fixtures, "2026-10-16", 1)).toBe("vs Virtus");
    expect(restDayReason(fixtures, "2026-10-18", 1)).toBe("vs Virtus");
    expect(restDayReason(fixtures, "2026-10-15", 1)).toBeNull();
  });

  it("reaches two days out when asked", () => {
    expect(restDayReason(fixtures, "2026-10-15", 2)).toBe("vs Virtus");
    expect(restDayReason(fixtures, "2026-10-14", 2)).toBeNull();
  });
});
