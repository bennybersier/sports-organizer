import { describe, expect, it } from "vitest";

import { leagueShape, planLeagueFixtures, type CompetitionEntry } from "./fixtures";

const club = (id: string, isUs = false): CompetitionEntry => ({ id, clubName: id, isUs });

/** Us plus `n` opponents. */
const league = (n: number): CompetitionEntry[] => [
  club("us", true),
  ...Array.from({ length: n }, (_, i) => club(`club${i + 1}`)),
];

describe("planLeagueFixtures", () => {
  it("plays every other club twice, once each way", () => {
    const fixtures = planLeagueFixtures(league(11));

    expect(fixtures).toHaveLength(22);
    for (let i = 1; i <= 11; i += 1) {
      const against = fixtures.filter((f) => f.participantIds.includes(`club${i}`));
      expect(against).toHaveLength(2);
      // One at ours, one at theirs — never both at the same place.
      expect(new Set(against.map((f) => f.hostEntryId)).size).toBe(2);
    }
  });

  it("splits home and away exactly in half", () => {
    const fixtures = planLeagueFixtures(league(11));
    const home = fixtures.filter((f) => f.hostEntryId === "us");
    expect(home).toHaveLength(11);
    expect(fixtures.length - home.length).toBe(11);
  });

  it("alternates the venue through the first leg", () => {
    // A club that hosts three weekends running has a hall problem the fixture
    // list gave it, so the first leg alternates rather than clustering.
    const fixtures = planLeagueFixtures(league(6));
    const firstLeg = fixtures.filter((f) => f.matchday <= 6);
    expect(firstLeg.map((f) => f.hostEntryId === "us")).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("swaps the venue in the return leg", () => {
    const fixtures = planLeagueFixtures(league(4));
    for (const opponent of ["club1", "club2", "club3", "club4"]) {
      const [first, second] = fixtures
        .filter((f) => f.participantIds.includes(opponent))
        .sort((a, b) => a.matchday - b.matchday);
      expect(first.hostEntryId).not.toBe(second.hostEntryId);
    }
  });

  it("numbers matchdays from one with no gaps", () => {
    const fixtures = planLeagueFixtures(league(5));
    expect(fixtures.map((f) => f.matchday)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("handles a two-club competition", () => {
    const fixtures = planLeagueFixtures(league(1));
    expect(fixtures).toHaveLength(2);
    expect(fixtures.map((f) => f.hostEntryId)).toEqual(["us", "club1"]);
  });

  it("plans nothing when the clubs have not been entered yet", () => {
    // Our own entry is created with the competition, so this is the state
    // between creating one and typing in who else is in it.
    expect(planLeagueFixtures([club("us", true)])).toEqual([]);
  });

  it("plans nothing when our own team is missing", () => {
    expect(planLeagueFixtures([club("club1"), club("club2")])).toEqual([]);
  });
});

describe("leagueShape", () => {
  it("answers the question an organiser asks on day one", () => {
    expect(leagueShape(12)).toEqual({ matchdays: 22, home: 11, away: 11 });
    expect(leagueShape(6)).toEqual({ matchdays: 10, home: 5, away: 5 });
  });

  it("is not negative for a competition with nobody in it", () => {
    expect(leagueShape(0)).toEqual({ matchdays: 0, home: 0, away: 0 });
    expect(leagueShape(1)).toEqual({ matchdays: 0, home: 0, away: 0 });
  });
});
