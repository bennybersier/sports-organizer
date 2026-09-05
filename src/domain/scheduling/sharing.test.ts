import { describe, expect, it } from "vitest";

import { overlapMinutes } from "../availability";
import { NO_GYM_SHARING, assessGymShare, type GymSharingPolicy } from "./sharing";

/** `18:00` → minutes from midnight, so the cases read like a timetable. */
const at = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const span = (from: string, until: string) => ({ start: at(from), end: at(until) });

/** The changeover a club actually asks for: two teams, half an hour. */
const CHANGEOVER: GymSharingPolicy = { maxConcurrentTeams: 2, maxSharedOverlapMinutes: 30 };

describe("overlapMinutes", () => {
  it("is zero for windows that only touch", () => {
    // Half-open, matching `overlaps`. Back-to-back training is not sharing.
    expect(overlapMinutes(span("18:00", "19:30"), span("19:30", "21:00"))).toBe(0);
  });

  it("is zero for windows that never meet", () => {
    expect(overlapMinutes(span("18:00", "19:00"), span("20:00", "21:00"))).toBe(0);
  });

  it("measures a partial overlap", () => {
    expect(overlapMinutes(span("18:00", "19:30"), span("19:00", "20:30"))).toBe(30);
  });

  it("measures containment as the inner window", () => {
    expect(overlapMinutes(span("18:00", "21:00"), span("19:00", "20:00"))).toBe(60);
  });
});

describe("assessGymShare", () => {
  it("is FREE when the hall is empty at that time", () => {
    const result = assessGymShare([span("18:00", "19:30")], span("19:30", "21:00"), NO_GYM_SHARING);
    expect(result.verdict).toBe("FREE");
    expect(result.sharedWith).toBe(0);
  });

  it("blocks any overlap in an ordinary hall", () => {
    const result = assessGymShare([span("18:00", "19:30")], span("19:00", "20:30"), NO_GYM_SHARING);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBe("CONCURRENCY");
  });

  it("allows a changeover exactly at the tolerance", () => {
    const result = assessGymShare([span("18:00", "19:30")], span("19:00", "20:30"), CHANGEOVER);
    expect(result.verdict).toBe("SHARED");
    expect(result.longestOverlap).toBe(30);
    expect(result.sharedWith).toBe(1);
  });

  it("refuses one minute more than the tolerance", () => {
    const result = assessGymShare([span("18:00", "19:30")], span("18:59", "20:30"), CHANGEOVER);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBe("OVERLAP_TOO_LONG");
    expect(result.longestOverlap).toBe(31);
  });

  it("allows an evening chain where each pair only overlaps at the handover", () => {
    // 18:00, 19:00 and 20:00 starts: every pair overlaps by 30 at most, and no
    // instant has more than two groups on the floor.
    const booked = [span("18:00", "19:30"), span("19:00", "20:30")];
    expect(assessGymShare(booked, span("20:00", "21:30"), CHANGEOVER).verdict).toBe("SHARED");
  });

  it("refuses a third group even when every pair is within the tolerance", () => {
    /*
      The case that stops `maxConcurrentTeams` being a column that never means
      anything. Three twenty-minute sessions can overlap each other by less than
      the half-hour tolerance and still put three groups on one floor at once,
      which the pairwise rule alone would wave through.
    */
    const booked = [span("18:00", "18:20"), span("18:05", "18:25")];
    const result = assessGymShare(booked, span("18:10", "18:30"), CHANGEOVER);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBe("CONCURRENCY");
    expect(result.longestOverlap).toBeLessThanOrEqual(30);
  });

  it("counts a hall with two courts as taking two all evening", () => {
    const twoCourts: GymSharingPolicy = { maxConcurrentTeams: 2, maxSharedOverlapMinutes: 240 };
    const result = assessGymShare([span("18:00", "20:00")], span("18:00", "20:00"), twoCourts);
    expect(result.verdict).toBe("SHARED");
    expect(result.longestOverlap).toBe(120);
  });

  it("refuses an overlap longer than the tolerance even against one session", () => {
    // 19:30–21:00 sits inside 19:00–20:30 for a full hour. Two teams for an
    // hour is not a changeover, however few of them there are.
    const result = assessGymShare([span("19:00", "20:30")], span("19:30", "21:00"), CHANGEOVER);
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBe("OVERLAP_TOO_LONG");
    expect(result.longestOverlap).toBe(60);
  });

  it("does not count a session that ends as another begins toward the peak", () => {
    /*
      The half-open tie-break, isolated. Two courts, so the pairwise rule stays
      out of the way, and a candidate straddling the 19:00 handover. At that
      instant the 18:00–19:00 session is over, so the floor holds two groups,
      not three — counting the boundary at both ends would block this wrongly.
    */
    const twoCourts: GymSharingPolicy = { maxConcurrentTeams: 2, maxSharedOverlapMinutes: 240 };
    const booked = [span("18:00", "19:00"), span("19:00", "20:00")];
    const result = assessGymShare(booked, span("18:30", "19:30"), twoCourts);
    expect(result.verdict).toBe("SHARED");
    expect(result.sharedWith).toBe(2);
  });
});
