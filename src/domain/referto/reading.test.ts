import { describe, expect, it } from "vitest";

import { readTeam, type CheckId, type TeamReading } from "./reading";
import type { LadderEntry, TranscribedPlayer, TranscribedTeam } from "./transcription";

/*
  Gara 9714 — Future Basket Lodigiano vs Brescia Academy, Under 13 Gold,
  18 October 2026. The sheet worked by hand in docs/referto-import.md, which is
  the only way to know this file is right: the arithmetic below was read off
  paper, not produced by the code it tests.

  Squadra A finished 67–59 with these eight scorers, and every check in the
  specification passes on it. The negative cases that follow each perturb one
  mark, which is what a misread digit actually looks like.
*/

/** `total shirt` with `*` for a circled scorer and `|` for a period end. */
function ladder(spec: string): LadderEntry[] {
  return spec
    .trim()
    .split(/\s*,\s*/)
    .map((rung) => {
      const match = /^(\d+)\s+(\d+|\?)(\*?)(\|?)$/.exec(rung.trim());
      if (!match) throw new Error(`Unreadable rung in test fixture: "${rung}"`);
      return {
        total: Number(match[1]),
        shirt: match[2] === "?" ? null : Number(match[2]),
        circledScorer: match[3] === "*",
        periodEnd: match[4] === "|",
      };
    });
}

const LODIGIANO_LADDER = ladder(`
  2 7, 3 7, 5 9, 7 7, 9 14, 11 9, 13 34, 15 14, 16 33|,
  18 33, 20 23, 22 7, 24 14, 26 13, 28 13, 30 9, 32 6, 34 23, 36 14|,
  38 9, 40 9, 42 14, 44 34, 46 9, 49 34*, 51 33|,
  53 34, 54 9, 55 9, 57 9, 59 33, 60 14, 61 14, 63 34, 65 9, 66 34, 67 34|
`);

/** `shirt surname` with `●` for a starter, then the FALLI marks as written. */
function player(spec: string, fouls: string[] = []): TranscribedPlayer {
  const starter = spec.includes("●");
  const [shirt, surname] = spec.replace("●", "").trim().split(/\s+/);
  return {
    shirt: Number(shirt),
    surname,
    givenName: null,
    birthYear: null,
    played: true,
    starter,
    fouls,
  };
}

const LODIGIANO_PLAYERS: TranscribedPlayer[] = [
  player("1 Doko ●"),
  player("4 Magistrali"),
  player("5 Perin ●"),
  player("6 Sotgia", ["P1", "P2"]),
  player("7 Bersier ●", ["P1", "P2"]),
  player("8 Sanarica"),
  player("9 Rossi ●", ["P", "P2", "P3"]),
  player("13 Russano"),
  player("14 Scarpetta ●", ["P", "P"]),
  player("23 Sampietro", ["P2"]),
  player("33 Guglielmetti", ["P1"]),
  player("34 Rosso"),
];

function lodigiano(overrides: Partial<TranscribedTeam> = {}): TranscribedTeam {
  return {
    clubName: "Future Basket Lodigiano",
    shirtColour: "bianco",
    players: LODIGIANO_PLAYERS,
    periods: [16, 20, 15, 16],
    finalScore: 67,
    ladder: LODIGIANO_LADDER,
    ...overrides,
  };
}

/** The named check, or a failure that says which check was missing. */
function check(reading: TeamReading, id: CheckId) {
  const found = reading.checks.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No check with id ${id}`);
  return found;
}

const failed = (reading: TeamReading) =>
  reading.checks.filter((candidate) => !candidate.passed).map((candidate) => candidate.id);

describe("readTeam, on a sheet that reconciles", () => {
  const reading = readTeam(lodigiano());

  it("passes every check", () => {
    expect(failed(reading)).toEqual([]);
    expect(reading.ok).toBe(true);
  });

  it("derives the eight scorers' lines off the ladder", () => {
    // Read off the paper, not produced by this code: docs/referto-import.md §4.
    const expected = {
      6: { twoPointMade: 1, threePointMade: 0, freeThrowMade: 0, points: 2 },
      7: { twoPointMade: 3, threePointMade: 0, freeThrowMade: 1, points: 7 },
      9: { twoPointMade: 8, threePointMade: 0, freeThrowMade: 2, points: 18 },
      13: { twoPointMade: 2, threePointMade: 0, freeThrowMade: 0, points: 4 },
      14: { twoPointMade: 5, threePointMade: 0, freeThrowMade: 2, points: 12 },
      23: { twoPointMade: 2, threePointMade: 0, freeThrowMade: 0, points: 4 },
      33: { twoPointMade: 3, threePointMade: 0, freeThrowMade: 1, points: 7 },
      34: { twoPointMade: 4, threePointMade: 1, freeThrowMade: 2, points: 13 },
    };

    for (const [shirt, numbers] of Object.entries(expected)) {
      const line = reading.lines.find((candidate) => candidate.shirt === Number(shirt));
      expect(line, `shirt ${shirt}`).toMatchObject(numbers);
    }
  });

  it("keeps the twelve who did not score, so the sheet is complete", () => {
    expect(reading.lines).toHaveLength(12);
    expect(reading.lines.find((line) => line.shirt === 4)).toMatchObject({
      points: 0,
      foulsCommitted: 0,
      played: true,
    });
  });

  it("sums to the final score and splits into the printed quarters", () => {
    expect(reading.points).toBe(67);
    expect(reading.periods).toEqual([16, 20, 15, 16]);
  });

  it("counts a foul per mark, not per free throw awarded", () => {
    // `P P2 P3` is three fouls: the digit is the opponent's free throws.
    expect(reading.lines.find((line) => line.shirt === 9)?.foulsCommitted).toBe(3);
    expect(reading.lines.find((line) => line.shirt === 23)?.foulsCommitted).toBe(1);
  });

  it("reads the five circled crosses as the starting five", () => {
    expect(reading.lines.filter((line) => line.starter).map((line) => line.shirt)).toEqual([
      1, 5, 7, 9, 14,
    ]);
  });
});

describe("readTeam, on a misread sheet", () => {
  it("catches a basket whose difference is impossible, and the points it loses", () => {
    /*
      46 read as 50: the jump from 44 is six points and the rung after it goes
      backwards to 49, so neither basket can be attributed to anybody. Both
      drop out of the sum — five points' worth — as well as breaking the chain,
      and the two hard checks that matter fire together.
    */
    const reading = readTeam(
      lodigiano({
        ladder: LODIGIANO_LADDER.map((rung) =>
          rung.total === 46 ? { ...rung, total: 50 } : rung,
        ),
      }),
    );

    expect(reading.ok).toBe(false);
    expect(check(reading, "MONOTONIC_LADDER").passed).toBe(false);
    expect(check(reading, "MONOTONIC_LADDER").detail).toContain("44 to 50");
    expect(check(reading, "POINTS_RECONCILE").passed).toBe(false);
    expect(check(reading, "POINTS_RECONCILE").detail).toContain("62");
  });

  it("catches a misread final rung, which moves the total directly", () => {
    const reading = readTeam(
      lodigiano({
        ladder: LODIGIANO_LADDER.map((rung) =>
          rung.total === 67 ? { ...rung, total: 68 } : rung,
        ),
      }),
    );

    expect(check(reading, "POINTS_RECONCILE").passed).toBe(false);
    expect(check(reading, "POINTS_RECONCILE").detail).toContain("68");
    expect(check(reading, "POINTS_RECONCILE").detail).toContain("67");
  });

  it("does not pretend to catch a mid-ladder digit with the points total", () => {
    /*
      The property that decides which checks are worth having: the differences
      telescope, so 42 read as 43 turns a 2 and a 2 into a 3 and a 1 and the
      team total is unchanged. Two players' lines are now wrong and only the
      three-point circle notices. Anybody tempted to call POINTS_RECONCILE
      sufficient should read this test first.
    */
    const reading = readTeam(
      lodigiano({
        ladder: LODIGIANO_LADDER.map((rung) =>
          rung.total === 42 ? { ...rung, total: 43 } : rung,
        ),
      }),
    );

    expect(reading.points).toBe(67);
    expect(check(reading, "POINTS_RECONCILE").passed).toBe(true);
    expect(check(reading, "PERIOD_CHECKPOINTS").passed).toBe(true);
    expect(check(reading, "THREE_POINT_CIRCLES").passed).toBe(false);

    // The damage it does, which no hard check sees.
    expect(reading.lines.find((line) => line.shirt === 14)?.threePointMade).toBe(1);
    expect(reading.lines.find((line) => line.shirt === 34)?.freeThrowMade).toBe(3);
  });

  it("names the quarter when the period box disagrees", () => {
    // The box says the third quarter was 16, the ladder is circled at 51.
    const reading = readTeam(lodigiano({ periods: [16, 20, 16, 16], finalScore: 68 }));

    const periodCheck = check(reading, "PERIOD_CHECKPOINTS");
    expect(periodCheck.passed).toBe(false);
    expect(periodCheck.detail).toContain("Quarter 3");
    // The whole point of this check: it localises the error to a range.
    expect(periodCheck.detail).toContain("between 36 and 52");
  });

  it("notices a rung that was never struck", () => {
    const reading = readTeam(
      lodigiano({ ladder: LODIGIANO_LADDER.filter((rung) => rung.total !== 42) }),
    );

    const ladderCheck = check(reading, "MONOTONIC_LADDER");
    expect(ladderCheck.passed).toBe(false);
    expect(ladderCheck.detail).toContain("40 to 44");
    expect(ladderCheck.detail).toContain("missed");
  });

  it("refuses a scorer who is not on the team sheet", () => {
    const reading = readTeam(
      lodigiano({
        ladder: LODIGIANO_LADDER.map((rung) =>
          rung.total === 30 ? { ...rung, shirt: 99 } : rung,
        ),
      }),
    );

    expect(check(reading, "KNOWN_SHIRTS").passed).toBe(false);
    expect(check(reading, "KNOWN_SHIRTS").detail).toContain("99");
  });

  it("refuses a scorer who is on the sheet but did not play", () => {
    const reading = readTeam(
      lodigiano({
        players: LODIGIANO_PLAYERS.map((candidate) =>
          candidate.shirt === 6 ? { ...candidate, played: false } : candidate,
        ),
      }),
    );

    expect(check(reading, "KNOWN_SHIRTS").passed).toBe(false);
    expect(check(reading, "KNOWN_SHIRTS").detail).toContain("not marked as having played");
  });

  it("will not silently drop points it cannot attribute", () => {
    const reading = readTeam(
      lodigiano({
        ladder: LODIGIANO_LADDER.map((rung) =>
          rung.total === 65 ? { ...rung, shirt: null } : rung,
        ),
      }),
    );

    // The team total still reconciles — which is exactly why this check exists:
    // without it, Rossi's season quietly loses a basket.
    expect(check(reading, "POINTS_RECONCILE").passed).toBe(false);
    expect(check(reading, "ATTRIBUTED_SCORERS").passed).toBe(false);
    expect(check(reading, "ATTRIBUTED_SCORERS").detail).toContain("65");
  });

  it("insists on five starters", () => {
    const reading = readTeam(
      lodigiano({
        players: LODIGIANO_PLAYERS.map((candidate) =>
          candidate.shirt === 1 ? { ...candidate, starter: false } : candidate,
        ),
      }),
    );

    expect(check(reading, "FIVE_STARTERS").passed).toBe(false);
    expect(check(reading, "FIVE_STARTERS").detail).toContain("4 starters");
  });

  it("rejects a starter who is not marked as having played", () => {
    const reading = readTeam(
      lodigiano({
        players: LODIGIANO_PLAYERS.map((candidate) =>
          candidate.shirt === 5 ? { ...candidate, played: false } : candidate,
        ),
      }),
    );

    expect(check(reading, "FIVE_STARTERS").passed).toBe(false);
    expect(check(reading, "FIVE_STARTERS").detail).toContain("Shirt 5");
  });

  it("rejects a sixth foul, which is a disqualification that did not happen", () => {
    const reading = readTeam(
      lodigiano({
        players: LODIGIANO_PLAYERS.map((candidate) =>
          candidate.shirt === 9
            ? { ...candidate, fouls: ["P", "P1", "P2", "P", "P3", "P"] }
            : candidate,
        ),
      }),
    );

    expect(check(reading, "FOUL_LIMIT").passed).toBe(false);
    expect(check(reading, "FOUL_LIMIT").detail).toContain("6 fouls");
  });

  it("refuses a sheet with no score to reconcile against", () => {
    const reading = readTeam(lodigiano({ finalScore: null, periods: [] }));

    expect(reading.ok).toBe(false);
    expect(check(reading, "POINTS_RECONCILE").passed).toBe(false);
    expect(check(reading, "PERIOD_CHECKPOINTS").passed).toBe(false);
  });

  it("falls back to the period box when the final score is unreadable", () => {
    const reading = readTeam(lodigiano({ finalScore: null }));

    expect(reading.ok).toBe(true);
    expect(check(reading, "POINTS_RECONCILE").detail).toContain("the period box");
  });
});

describe("readTeam, on a sheet that is readable but worth a second look", () => {
  it("flags a three-point circle that the arithmetic contradicts, without blocking", () => {
    /*
      46 read as 47 moves a point between two consecutive baskets: 44→47 becomes
      a three and 47→49 becomes a two. The team total is unchanged, so check 1
      passes and only the circles disagree — the case that justifies a soft
      check existing at all.
    */
    const reading = readTeam(
      lodigiano({
        ladder: LODIGIANO_LADDER.map((rung) =>
          rung.total === 46 ? { ...rung, total: 47 } : rung,
        ),
      }),
    );

    expect(check(reading, "POINTS_RECONCILE").passed).toBe(true);
    expect(check(reading, "THREE_POINT_CIRCLES").passed).toBe(false);
    // Soft, so the import may still go ahead with a human looking at it.
    expect(reading.ok).toBe(true);
  });

  it("flags a roster block read as more than twelve rows", () => {
    const reading = readTeam(
      lodigiano({ players: [...LODIGIANO_PLAYERS, player("44 Ghost")] }),
    );

    expect(check(reading, "ROSTER_SIZE").passed).toBe(false);
    expect(reading.ok).toBe(true);
  });
});
