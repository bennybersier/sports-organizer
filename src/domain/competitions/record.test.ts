import { describe, expect, it } from "vitest";

import { outcomeOf, teamRecord, type ResultFact } from "./record";

const result = (playedAt: string, ourScore: number, theirScore: number, counts = true): ResultFact => ({
  playedAt,
  ourScore,
  theirScore,
  counts,
});

describe("outcomeOf", () => {
  it("reads the two scores and nothing else", () => {
    expect(outcomeOf({ ourScore: 67, theirScore: 59 })).toBe("WIN");
    expect(outcomeOf({ ourScore: 59, theirScore: 67 })).toBe("LOSS");
    expect(outcomeOf({ ourScore: 60, theirScore: 60 })).toBe("DRAW");
  });
});

describe("teamRecord", () => {
  it("counts a season and totals both ends of it", () => {
    const record = teamRecord([
      result("2026-10-04", 67, 59),
      result("2026-10-11", 54, 71),
      result("2026-10-18", 80, 62),
    ]);

    expect(record).toMatchObject({
      played: 3,
      won: 2,
      lost: 1,
      drawn: 0,
      pointsFor: 201,
      pointsAgainst: 192,
      pointDifference: 9,
    });
    expect(record.perGame).toEqual({ scored: 67, conceded: 64 });
  });

  it("reads form most recent first, whatever order the rows arrive in", () => {
    // The caller is a database query; its ordering is not this function's problem.
    const record = teamRecord([
      result("2026-10-11", 54, 71),
      result("2026-10-18", 80, 62),
      result("2026-10-04", 67, 59),
    ]);

    expect(record.form).toEqual(["WIN", "LOSS", "WIN"]);
  });

  it("keeps form to the last five matches", () => {
    const record = teamRecord(
      ["01", "02", "03", "04", "05", "06", "07"].map((day, index) =>
        result(`2026-11-${day}`, index % 2 === 0 ? 70 : 50, 60),
      ),
    );

    expect(record.played).toBe(7);
    expect(record.form).toHaveLength(5);
    // 07 is index 6, so a win; 06 a loss; alternating back from there.
    expect(record.form).toEqual(["WIN", "LOSS", "WIN", "LOSS", "WIN"]);
  });

  it("measures the current run, not the longest one", () => {
    const record = teamRecord([
      result("2026-10-04", 90, 40),
      result("2026-10-11", 88, 41),
      result("2026-10-18", 50, 60),
      result("2026-10-25", 51, 62),
    ]);

    expect(record.streak).toEqual({ outcome: "LOSS", length: 2 });
  });

  it("leaves an abandoned match out of everything", () => {
    const record = teamRecord([
      result("2026-10-04", 67, 59),
      result("2026-10-11", 30, 28, false),
    ]);

    expect(record.played).toBe(1);
    expect(record.pointsFor).toBe(67);
    expect(record.form).toEqual(["WIN"]);
  });

  it("says nothing rather than zero before a season starts", () => {
    const record = teamRecord([]);

    expect(record.played).toBe(0);
    expect(record.streak).toBeNull();
    expect(record.perGame).toBeNull();
    expect(record.form).toEqual([]);
  });

  it("counts a draw where the format allows one", () => {
    const record = teamRecord([result("2026-10-04", 60, 60)]);

    expect(record).toMatchObject({ played: 1, won: 0, lost: 0, drawn: 1 });
    expect(record.streak).toEqual({ outcome: "DRAW", length: 1 });
  });
});
