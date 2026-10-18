/**
 * What a season of results adds up to for one of our teams.
 *
 * ## Why this is a record and not a league table
 *
 * A club only ever knows its own matches. Virtus against Pavia is played in a
 * hall we are not in and published on a federation site we do not read, so
 * every other club's record is unknown and no standings table can be built from
 * this data without inventing most of it. What *can* be stated truthfully is our
 * own: played, won, lost, points for and against, and the shape of the last few
 * weeks. That is what this produces.
 *
 * If a club ever wants a real table, the honest route is importing the
 * federation's published one, not deriving it here.
 */

/** One result, reduced to what a record is made of. */
export interface ResultFact {
  /** Chronological key. Results are ordered by it, so form means recent form. */
  playedAt: string;
  ourScore: number;
  theirScore: number;
  /** A forfeit still counts in the record; an abandoned match does not. */
  counts: boolean;
}

export type Outcome = "WIN" | "LOSS" | "DRAW";

export interface TeamRecord {
  played: number;
  won: number;
  lost: number;
  /**
   * Overtime means a senior basketball match cannot be drawn, but minibasket
   * festivals are scored in ways that can be, so the case is counted rather
   * than asserted away.
   */
  drawn: number;
  pointsFor: number;
  pointsAgainst: number;
  /** For minus against. Negative is normal and not an error. */
  pointDifference: number;
  /** Most recent first, so it reads the way a coach says it. */
  form: Outcome[];
  /** The current run, however long. Null before the first match that counts. */
  streak: { outcome: Outcome; length: number } | null;
  /** Mean points scored and conceded, or null with nothing to average. */
  perGame: { scored: number; conceded: number } | null;
}

export function outcomeOf(result: Pick<ResultFact, "ourScore" | "theirScore">): Outcome {
  if (result.ourScore > result.theirScore) return "WIN";
  if (result.ourScore < result.theirScore) return "LOSS";
  return "DRAW";
}

/** How many of the most recent results `form` carries. */
export const FORM_LENGTH = 5;

/**
 * Reduces results to a record.
 *
 * Takes the whole list and sorts it rather than trusting the caller's order,
 * because form is the one figure here that is wrong rather than merely stale if
 * the order is off, and the caller is a database query whose ordering is a
 * detail of the query.
 */
export function teamRecord(results: ResultFact[]): TeamRecord {
  const counted = results
    .filter((result) => result.counts)
    .slice()
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt));

  const outcomes = counted.map(outcomeOf);

  const totals = counted.reduce(
    (sum, result) => ({
      pointsFor: sum.pointsFor + result.ourScore,
      pointsAgainst: sum.pointsAgainst + result.theirScore,
    }),
    { pointsFor: 0, pointsAgainst: 0 },
  );

  const played = counted.length;

  return {
    played,
    won: outcomes.filter((outcome) => outcome === "WIN").length,
    lost: outcomes.filter((outcome) => outcome === "LOSS").length,
    drawn: outcomes.filter((outcome) => outcome === "DRAW").length,
    pointsFor: totals.pointsFor,
    pointsAgainst: totals.pointsAgainst,
    pointDifference: totals.pointsFor - totals.pointsAgainst,
    form: outcomes.slice(0, FORM_LENGTH),
    streak: streakOf(outcomes),
    perGame:
      played === 0
        ? null
        : { scored: totals.pointsFor / played, conceded: totals.pointsAgainst / played },
  };
}

/** The unbroken run at the front of the list. */
function streakOf(outcomes: Outcome[]): TeamRecord["streak"] {
  if (outcomes.length === 0) return null;
  const outcome = outcomes[0];
  let length = 0;
  while (length < outcomes.length && outcomes[length] === outcome) length += 1;
  return { outcome, length };
}
