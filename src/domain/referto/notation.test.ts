import { describe, expect, it } from "vitest";

import {
  NotationError,
  formatLadder,
  formatPeriods,
  formatRoster,
  parseLadder,
  parsePeriods,
  parseRoster,
} from "./notation";
import { readTeam } from "./reading";

describe("parseLadder", () => {
  it("reads a rung, a circled scorer and a period end", () => {
    expect(parseLadder("2 7\n49 34*\n67 34|")).toEqual([
      { total: 2, shirt: 7, circledScorer: false, periodEnd: false },
      { total: 49, shirt: 34, circledScorer: true, periodEnd: false },
      { total: 67, shirt: 34, circledScorer: false, periodEnd: true },
    ]);
  });

  it("accepts the documentation's own comma-separated form", () => {
    // docs/referto-import.md §4 is written this way, so it pastes straight in.
    expect(parseLadder("2 7, 3 7, 16 33|")).toHaveLength(3);
  });

  it("keeps an unreadable shirt as null rather than making one up", () => {
    expect(parseLadder("65 ?")).toEqual([
      { total: 65, shirt: null, circledScorer: false, periodEnd: false },
    ]);
  });

  it("ignores the blank lines people use to group quarters", () => {
    expect(parseLadder("2 7\n\n\n3 7\n")).toHaveLength(2);
  });

  it("names the line when a rung cannot be read", () => {
    expect(() => parseLadder("2 7\nnonsense\n5 9")).toThrowError(NotationError);
    try {
      parseLadder("2 7\nnonsense");
    } catch (error) {
      expect((error as NotationError).line).toBe(2);
    }
  });

  it("round-trips", () => {
    const text = "2 7\n16 33|\n49 34*\n65 ?";
    expect(formatLadder(parseLadder(text))).toBe(text);
  });
});

describe("parseRoster", () => {
  it("reads number, surname, initials, starter and fouls from one line", () => {
    expect(parseRoster("7 Bersier L. * P1 P2")).toEqual([
      {
        shirt: 7,
        surname: "Bersier",
        givenName: "L.",
        birthYear: null,
        played: true,
        starter: true,
        fouls: ["P1", "P2"],
      },
    ]);
  });

  it("treats a row as a player who took part unless marked otherwise", () => {
    expect(parseRoster("8 Sanarica S.")[0]).toMatchObject({ played: true, starter: false });
    expect(parseRoster("34 Rosso A. -")[0]).toMatchObject({ played: false });
  });

  it("tells a foul mark from a name by its shape, not its position", () => {
    const [player] = parseRoster("9 Rossi T. P P2 P3");
    expect(player.surname).toBe("Rossi");
    // "T." is an initial; "T" alone would be a technical foul.
    expect(player.givenName).toBe("T.");
    expect(player.fouls).toEqual(["P", "P2", "P3"]);
  });

  it("names the line when there is no shirt number", () => {
    try {
      parseRoster("7 Bersier\nRossi T.");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NotationError);
      expect((error as NotationError).line).toBe(2);
    }
  });

  it("round-trips", () => {
    const text = "1 Doko E. *\n6 Sotgia L. P1 P2\n34 Rosso A. -";
    expect(formatRoster(parseRoster(text))).toBe(text);
  });
});

describe("parsePeriods", () => {
  it("reads the period box however it is punctuated", () => {
    expect(parsePeriods("16, 20, 15, 16")).toEqual([16, 20, 15, 16]);
    expect(parsePeriods("16 20 15 16")).toEqual([16, 20, 15, 16]);
    expect(parsePeriods("")).toEqual([]);
  });

  it("round-trips", () => {
    expect(formatPeriods(parsePeriods("16, 20, 15, 16"))).toBe("16, 20, 15, 16");
  });
});

describe("the notation and the reader together", () => {
  it("derives gara 9714 from text pasted out of the specification", () => {
    /*
      The whole point of the notation: the worked example in
      docs/referto-import.md §4 can be typed into the editor and the reader
      agrees with the table printed beneath it.
    */
    const ladder = parseLadder(`
      2 7, 3 7, 5 9, 7 7, 9 14, 11 9, 13 34, 15 14, 16 33|,
      18 33, 20 23, 22 7, 24 14, 26 13, 28 13, 30 9, 32 6, 34 23, 36 14|,
      38 9, 40 9, 42 14, 44 34, 46 9, 49 34*, 51 33|,
      53 34, 54 9, 55 9, 57 9, 59 33, 60 14, 61 14, 63 34, 65 9, 66 34, 67 34|
    `);
    const players = parseRoster(`
      1 Doko E. *
      4 Magistrali L.
      5 Perin A. *
      6 Sotgia L. P1 P2
      7 Bersier L. * P1 P2
      8 Sanarica S.
      9 Rossi T. * P P2 P3
      13 Russano K.D.
      14 Scarpetta L. * P P
      23 Sampietro F. P2
      33 Guglielmetti F. P1
      34 Rosso A.
    `);

    const reading = readTeam({
      clubName: "Future Basket Lodigiano",
      shirtColour: null,
      players,
      periods: parsePeriods("16, 20, 15, 16"),
      finalScore: 67,
      ladder,
    });

    expect(reading.ok).toBe(true);
    expect(reading.points).toBe(67);
    expect(reading.lines.find((line) => line.shirt === 9)?.points).toBe(18);
    expect(reading.lines.find((line) => line.shirt === 34)?.threePointMade).toBe(1);
  });
});
