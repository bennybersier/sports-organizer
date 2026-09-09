/**
 * The matches one club owes in a league.
 *
 * A twelve-club league contains 132 pairings. This app organises one club's
 * season, not a federation's, so it plans the 22 that team actually plays: one
 * at home and one away against every other club. There is no circle method here
 * and no scheduling of matches we are not in, because nobody at the club needs
 * to know when Cremona play Pavia.
 *
 * Dates are deliberately absent. A fixture is an obligation — you owe it the
 * moment you enter the league — and when it is played is settled later, by a
 * federation that publishes a list or by two clubs agreeing a Saturday.
 */

export interface CompetitionEntry {
  id: string;
  clubName: string;
  /** Exactly one entry in a competition is the club's own team. */
  isUs: boolean;
}

export interface PlannedFixture {
  matchday: number;
  /** The entry that hosts. Ours on a home fixture, theirs on an away one. */
  hostEntryId: string;
  /** Everyone in it. Two for a league; ours is always among them. */
  participantIds: string[];
}

/**
 * Every match our team plays, home and away, against each other club.
 *
 * The first leg runs one opponent per matchday, alternating home and away so
 * the hall is not wanted every week; the return leg repeats it with the venues
 * swapped. That is what a club recognises as a season, and it makes the home
 * count exactly half the fixtures however many clubs there are.
 *
 * Returns nothing when there is no opponent to play — a competition with only
 * our own entry is one whose clubs have not been typed in yet, which is a state
 * worth passing through rather than an error.
 */
export function planLeagueFixtures(entries: CompetitionEntry[]): PlannedFixture[] {
  const us = entries.find((entry) => entry.isUs);
  const opponents = entries.filter((entry) => !entry.isUs);

  if (!us || opponents.length === 0) return [];

  const fixtures: PlannedFixture[] = [];
  const legLength = opponents.length;

  for (const [index, opponent] of opponents.entries()) {
    // Alternating, so a club does not host three weekends running.
    const homeFirst = index % 2 === 0;

    fixtures.push({
      matchday: index + 1,
      hostEntryId: homeFirst ? us.id : opponent.id,
      participantIds: [us.id, opponent.id],
    });

    fixtures.push({
      matchday: legLength + index + 1,
      hostEntryId: homeFirst ? opponent.id : us.id,
      participantIds: [us.id, opponent.id],
    });
  }

  return fixtures.sort((a, b) => a.matchday - b.matchday);
}

/**
 * What a competition of this size will ask of the club, before a single club
 * name has been typed.
 *
 * The number an organiser wants on the day they enter a league: how many
 * matches, and how many of them they have to find hall time for.
 */
export function leagueShape(clubCount: number): {
  matchdays: number;
  home: number;
  away: number;
} {
  const opponents = Math.max(0, clubCount - 1);
  return { matchdays: opponents * 2, home: opponents, away: opponents };
}
