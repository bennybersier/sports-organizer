import { describe, expect, it } from "vitest";

import { summariseBoxScores, type BoxScoreFact } from "./box-score";

/** A full stat line, as somebody sitting with the game would enter it. */
function manual(overrides: Partial<BoxScoreFact> = {}): BoxScoreFact {
  const base: BoxScoreFact = {
    source: "MANUAL",
    secondsPlayed: 1_500,
    twoPointMade: 4,
    twoPointAttempted: 9,
    threePointMade: 1,
    threePointAttempted: 4,
    freeThrowMade: 3,
    freeThrowAttempted: 4,
    offensiveRebounds: 2,
    defensiveRebounds: 4,
    assists: 3,
    steals: 2,
    blocks: 1,
    turnovers: 2,
    foulsCommitted: 2,
    foulsDrawn: 3,
    points: 0,
    rebounds: 0,
    efficiency: 0,
  };
  const row = { ...base, ...overrides };
  return { ...row, ...generated(row) };
}

/**
 * A line as a referto import leaves it: makes only, attempts equal to makes,
 * and a zero in every column the document does not carry.
 */
function fromSheet(overrides: Partial<BoxScoreFact> = {}): BoxScoreFact {
  const row: BoxScoreFact = {
    source: "REFERTO",
    secondsPlayed: 0,
    twoPointMade: 8,
    twoPointAttempted: 8,
    threePointMade: 0,
    threePointAttempted: 0,
    freeThrowMade: 2,
    freeThrowAttempted: 2,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    foulsCommitted: 3,
    foulsDrawn: 0,
    points: 0,
    rebounds: 0,
    efficiency: 0,
    ...overrides,
  };
  return { ...row, ...generated(row) };
}

/** What Postgres computes, mirrored so the fixtures cannot disagree with it. */
function generated(row: BoxScoreFact) {
  const points = row.twoPointMade * 2 + row.threePointMade * 3 + row.freeThrowMade;
  const rebounds = row.offensiveRebounds + row.defensiveRebounds;
  return {
    points,
    rebounds,
    efficiency:
      points +
      rebounds +
      row.assists +
      row.steals +
      row.blocks +
      row.foulsDrawn -
      ((row.twoPointAttempted - row.twoPointMade) +
        (row.threePointAttempted - row.threePointMade) +
        (row.freeThrowAttempted - row.freeThrowMade) +
        row.turnovers +
        row.foulsCommitted),
  };
}

describe("summariseBoxScores", () => {
  it("says nothing at all rather than zero for a player with no games", () => {
    expect(summariseBoxScores([])).toBeNull();
  });

  it("averages points and fouls over every game, whatever the source", () => {
    // Both sources record these honestly, so both count.
    const summary = summariseBoxScores([manual(), fromSheet()])!;

    expect(summary.games).toBe(2);
    // manual: 4*2 + 1*3 + 3 = 14. sheet: 8*2 + 2 = 18.
    expect(summary.basic.points).toBe(32);
    expect(summary.perGame.points).toBe(16);
    expect(summary.perGame.fouls).toBe(2.5);
  });

  it("withholds every detailed figure when the whole season came off sheets", () => {
    /*
      The case the user named: a referto carries no rebounds, assists, attempts
      or minutes, so there is no average to show and showing 0.0 would be a
      claim about the player rather than about the paperwork.
    */
    const summary = summariseBoxScores([fromSheet(), fromSheet(), fromSheet()])!;

    expect(summary.games).toBe(3);
    expect(summary.sheetGames).toBe(3);
    expect(summary.detail).toBeNull();
    // What a sheet *does* support is still there.
    expect(summary.perGame.points).toBe(18);
    expect(summary.basic.twoPointMade).toBe(24);
  });

  it("does not let sheet games drag the rebound average towards zero", () => {
    /*
      The bug this file was written for. Six rebounds a game in the two matches
      somebody kept stats for, plus ten imported sheets, must average 6 — not
      1.0, which is what dividing by twelve would give.
    */
    const facts = [
      manual({ offensiveRebounds: 2, defensiveRebounds: 4 }),
      manual({ offensiveRebounds: 1, defensiveRebounds: 5 }),
      ...Array.from({ length: 10 }, () => fromSheet()),
    ];

    const summary = summariseBoxScores(facts)!;

    expect(summary.games).toBe(12);
    expect(summary.detail?.games).toBe(2);
    expect(summary.detail?.perGame.rebounds).toBe(6);
    expect(summary.detail?.perGame.assists).toBe(3);
  });

  it("computes shooting only from games that recorded attempts", () => {
    // A sheet sets attempted = made, so including it would read as 100%.
    const summary = summariseBoxScores([
      manual({ twoPointMade: 4, twoPointAttempted: 10 }),
      fromSheet({ twoPointMade: 8, twoPointAttempted: 8 }),
    ])!;

    expect(summary.detail?.shooting.twoPoint).toBe(0.4);
  });

  it("has no percentage for a shot type never attempted", () => {
    // Not 0% — a player who never took a three has no three-point percentage.
    const summary = summariseBoxScores([
      manual({ threePointMade: 0, threePointAttempted: 0 }),
    ])!;

    expect(summary.detail?.shooting.threePoint).toBeNull();
    expect(summary.detail?.shooting.twoPoint).not.toBeNull();
  });

  it("credits a three with its extra point in the effective field goal figure", () => {
    const summary = summariseBoxScores([
      manual({
        twoPointMade: 0,
        twoPointAttempted: 0,
        threePointMade: 5,
        threePointAttempted: 10,
      }),
    ])!;

    // 5 threes from 10 attempts: 15 points from 10 shots = 75% eFG.
    expect(summary.detail?.shooting.effectiveFieldGoal).toBeCloseTo(0.75);
  });

  it("keeps valutazione out of the average when it cannot be trusted", () => {
    const sheetsOnly = summariseBoxScores([fromSheet(), fromSheet()])!;
    expect(sheetsOnly.detail).toBeNull();

    // Available, and drawn only from the games that recorded attempts.
    const mixed = summariseBoxScores([manual(), fromSheet()])!;
    expect(mixed.detail?.games).toBe(1);
    expect(mixed.detail?.perGame.efficiency).toBe(manual().efficiency);
  });

  it("counts a genuine empty stat line rather than discarding it", () => {
    /*
      A player who came on for two minutes and did nothing has a real line of
      zeroes. Excluding it because it looks like missing data would flatter
      every average they have.
    */
    const summary = summariseBoxScores([
      manual({ offensiveRebounds: 2, defensiveRebounds: 4 }),
      manual({
        secondsPlayed: 120,
        twoPointMade: 0, twoPointAttempted: 0,
        threePointMade: 0, threePointAttempted: 0,
        freeThrowMade: 0, freeThrowAttempted: 0,
        offensiveRebounds: 0, defensiveRebounds: 0,
        assists: 0, steals: 0, blocks: 0, turnovers: 0,
        foulsCommitted: 0, foulsDrawn: 0,
      }),
    ])!;

    expect(summary.detail?.games).toBe(2);
    expect(summary.detail?.perGame.rebounds).toBe(3);
  });

  it("reports minutes only from games that timed them", () => {
    const summary = summariseBoxScores([
      manual({ secondsPlayed: 1_800 }),
      fromSheet(),
    ])!;

    // 30 minutes over the one game that recorded any, not 15 over both.
    expect(summary.detail?.perGame.minutes).toBe(30);
  });
});
