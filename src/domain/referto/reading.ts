/**
 * Turning a transcribed referto into box score lines, and refusing to when it
 * does not add up.
 *
 * Nothing in this file knows about a model, a database or a request. It takes
 * marks on paper (`transcription.ts`) and produces numbers plus a verdict, so
 * the arithmetic that decides what a season's statistics say can be tested
 * against a real sheet — see `reading.test.ts`, which works gara 9714 end to
 * end.
 *
 * ## Why validation is the point rather than a nicety
 *
 * A referto arrives as a phone photograph, at an angle, at a resolution where
 * a 6 and an 8 are the same shape. There is no optical confidence to lean on,
 * and a plausible misreading is indistinguishable from a correct one. What
 * saves the import is that the document is *redundant*: the progressive score
 * is a chain of differences whose sum must equal the final score, and whose
 * circled rungs must equal the period box. Nearly any single misread digit
 * breaks one of those, because it breaks a chain rather than a cell.
 *
 * So the rule is: **never guess, and when a check fails say which one and show
 * the arithmetic.** "Points add to 65 but the sheet says 67 — the error is in
 * the third quarter, between 36 and 51" is something a secretary fixes in
 * thirty seconds against the paper. "Could not read the sheet" is not.
 *
 * The checks and their severities are specified in docs/referto-import.md §5.
 */

import type { LadderEntry, TranscribedTeam } from "./transcription";

/** Players a FIP roster block holds. More than this is a misread block. */
const MAX_ROSTER = 12;
/** Five personal fouls and a player is disqualified, so the column has five boxes. */
const MAX_FOULS = 5;
const STARTERS = 5;

/* -------------------------------------------------------------------------- */
/* What comes out                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One player's line, derived.
 *
 * Only makes: a referto records no attempts, no rebounds, no assists and no
 * minutes. What that means downstream is dealt with where these are written —
 * `attempted = made`, and the `source` column marks the row so nobody averages
 * a 100% shooting night into a real one.
 */
export interface DerivedLine {
  shirt: number;
  twoPointMade: number;
  threePointMade: number;
  freeThrowMade: number;
  /** Derived from the three above; never read off the sheet. */
  points: number;
  foulsCommitted: number;
  played: boolean;
  starter: boolean;
}

export type CheckId =
  | "POINTS_RECONCILE"
  | "PERIOD_CHECKPOINTS"
  | "MONOTONIC_LADDER"
  | "ATTRIBUTED_SCORERS"
  | "KNOWN_SHIRTS"
  | "FIVE_STARTERS"
  | "FOUL_LIMIT"
  | "THREE_POINT_CIRCLES"
  | "ROSTER_SIZE";

/**
 * HARD refuses the import. SOFT imports and asks a human to look.
 *
 * The split is not about how likely the error is but about what a wrong answer
 * costs. A three-point circle that disagrees with its difference is one basket
 * misattributed between two and three points; a ladder that does not sum to the
 * final score may be wrong anywhere.
 */
export type CheckSeverity = "HARD" | "SOFT";

export interface Check {
  id: CheckId;
  severity: CheckSeverity;
  passed: boolean;
  /** The arithmetic, in a sentence a club secretary can act on. */
  detail: string;
}

export interface TeamReading {
  lines: DerivedLine[];
  /** The sum of the derived lines — what the sheet says *we* read. */
  points: number;
  /** Per period, derived from the circled rungs. Not cumulative. */
  periods: number[];
  checks: Check[];
  /** True when no HARD check failed. SOFT failures do not block an import. */
  ok: boolean;
}

/* -------------------------------------------------------------------------- */
/* The ladder                                                                 */
/* -------------------------------------------------------------------------- */

interface Basket {
  entry: LadderEntry;
  /** `total` minus the previous rung's total. 1, 2 or 3 on a readable sheet. */
  worth: number;
  /** Cumulative team score at this rung — i.e. the rung's own total. */
  runningTotal: number;
}

/**
 * Walks the rungs and works out what each basket was worth.
 *
 * The difference is taken against the previous rung rather than against any
 * count of baskets, which is what makes a missed rung detectable: a two-pointer
 * that was not struck shows up as a difference of 4, not as a quietly missing
 * basket.
 */
function baskets(ladder: LadderEntry[]): Basket[] {
  let previous = 0;
  return ladder.map((entry) => {
    const worth = entry.total - previous;
    previous = entry.total;
    return { entry, worth, runningTotal: entry.total };
  });
}

/** Cumulative totals at each period buzzer, in order. */
function checkpoints(ladder: LadderEntry[]): number[] {
  return ladder.filter((entry) => entry.periodEnd).map((entry) => entry.total);
}

/** Per-period scores from cumulative checkpoints: [16, 36, 51, 67] → [16, 20, 15, 16]. */
function periodsFromCheckpoints(cumulative: number[]): number[] {
  let previous = 0;
  return cumulative.map((total) => {
    const period = total - previous;
    previous = total;
    return period;
  });
}

/** Running cumulative sum of per-period scores: [16, 20, 15, 16] → [16, 36, 51, 67]. */
function cumulate(periods: number[]): number[] {
  let running = 0;
  return periods.map((period) => (running += period));
}

/**
 * How many fouls a `FALLI` cell list represents.
 *
 * One mark is one foul regardless of the digit beside it: the digit is free
 * throws awarded to the opponent, and the foul's sequence number is the column
 * it sits in. `P P2 P3` is three fouls, not six.
 */
function foulCount(marks: string[]): number {
  return marks.filter((mark) => /^[PTUD]\d?$/i.test(mark.trim())).length;
}

/* -------------------------------------------------------------------------- */
/* Reading one team                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Derives one side's box score and checks it against the rest of the sheet.
 *
 * Always returns a reading, even a failing one: the review screen shows the
 * derived lines beside the photograph whether or not they reconcile, because a
 * secretary correcting one digit needs to see the other eleven rows.
 */
export function readTeam(team: TranscribedTeam): TeamReading {
  const rungs = baskets(team.ladder);
  const roster = new Map(team.players.map((player) => [player.shirt, player]));

  /*
    Points are accumulated per shirt rather than per roster row, so a scorer
    number that is not in the roster still shows up in the totals instead of
    being silently dropped. KNOWN_SHIRTS is what reports it; losing the points
    here would make POINTS_RECONCILE fail as well and point at the wrong thing.
  */
  const tally = new Map<number, { two: number; three: number; ft: number }>();
  const of = (shirt: number) => {
    const existing = tally.get(shirt);
    if (existing) return existing;
    const fresh = { two: 0, three: 0, ft: 0 };
    tally.set(shirt, fresh);
    return fresh;
  };

  for (const rung of rungs) {
    if (rung.entry.shirt === null) continue;
    const line = of(rung.entry.shirt);
    if (rung.worth === 3) line.three += 1;
    else if (rung.worth === 2) line.two += 1;
    else if (rung.worth === 1) line.ft += 1;
    // A difference outside 1–3 is a broken chain, not a basket: MONOTONIC_LADDER
    // reports it, and attributing it to somebody would invent points.
  }

  const shirts = [...new Set([...roster.keys(), ...tally.keys()])].sort((a, b) => a - b);
  const lines: DerivedLine[] = shirts.map((shirt) => {
    const scored = tally.get(shirt) ?? { two: 0, three: 0, ft: 0 };
    const player = roster.get(shirt);
    return {
      shirt,
      twoPointMade: scored.two,
      threePointMade: scored.three,
      freeThrowMade: scored.ft,
      points: scored.two * 2 + scored.three * 3 + scored.ft,
      foulsCommitted: player ? foulCount(player.fouls) : 0,
      played: player?.played ?? false,
      starter: player?.starter ?? false,
    };
  });

  const points = lines.reduce((sum, line) => sum + line.points, 0);
  const derivedCheckpoints = checkpoints(team.ladder);
  const periods = periodsFromCheckpoints(derivedCheckpoints);

  const checks = [
    pointsReconcile(points, team),
    periodCheckpoints(derivedCheckpoints, team),
    monotonicLadder(rungs),
    attributedScorers(rungs),
    knownShirts(rungs, roster),
    fiveStarters(team),
    foulLimit(team),
    threePointCircles(rungs),
    rosterSize(team),
  ];

  return {
    lines,
    points,
    periods,
    checks,
    ok: checks.every((check) => check.severity !== "HARD" || check.passed),
  };
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                 */
/* -------------------------------------------------------------------------- */

const pass = (id: CheckId, severity: CheckSeverity, detail: string): Check => ({
  id,
  severity,
  passed: true,
  detail,
});
const fail = (id: CheckId, severity: CheckSeverity, detail: string): Check => ({
  id,
  severity,
  passed: false,
  detail,
});

/**
 * Check 1 — per-player points must sum to the team's final score.
 *
 * Worth being precise about what this does and does not catch, because it is
 * easy to credit it with more. The differences telescope: summing them gives
 * the last rung's total and nothing else, so a misread total *in the middle* of
 * the ladder moves a point between two adjacent baskets and leaves the team
 * total untouched. Reading 43 for 42 turns a 2 and a 2 into a 3 and a 1 — two
 * players' lines change, the sum does not.
 *
 * What it does catch is everything that breaks the chain rather than bending
 * it: a basket whose difference falls outside 1–3 is not attributed to anybody
 * (see `readTeam`), so it drops out of the sum; a rung with no readable scorer
 * does the same; and a misread final rung or final score moves the two sides
 * apart directly. Those are the common failures.
 *
 * Mid-ladder digits are caught instead by PERIOD_CHECKPOINTS, which cuts the
 * chain into four, and by THREE_POINT_CIRCLES, which is the only check that
 * sees a point move between two neighbours. That is why a soft check is in the
 * set at all.
 *
 * The final score is preferred over the period box because it is printed
 * largest and misread least; if it could not be read at all, the periods are
 * the fallback, and with neither there is nothing to reconcile against and the
 * sheet cannot be imported.
 */
function pointsReconcile(points: number, team: TranscribedTeam): Check {
  const id: CheckId = "POINTS_RECONCILE";
  const periodTotal = team.periods.length > 0
    ? team.periods.reduce((sum, period) => sum + period, 0)
    : null;
  const stated = team.finalScore ?? periodTotal;
  const source = team.finalScore !== null ? "the final score" : "the period box";

  if (stated === null) {
    return fail(id, "HARD", "Neither the final score nor the period box could be read, so the ladder cannot be checked against anything.");
  }
  if (points === stated) {
    return pass(id, "HARD", `Points add to ${points}, matching ${source}.`);
  }
  return fail(
    id,
    "HARD",
    `Points add to ${points} but ${source} says ${stated}, a difference of ${stated - points}.`,
  );
}

/**
 * Check 2 — four independent checks per team, which localise an error.
 *
 * The circled rungs must equal the cumulative period scores from the box at
 * bottom right. This is the check that turns "something is wrong somewhere" into
 * "the error is in the third quarter, between 36 and 51", which is the
 * difference between a fixable import and an abandoned one.
 */
function periodCheckpoints(derived: number[], team: TranscribedTeam): Check {
  const id: CheckId = "PERIOD_CHECKPOINTS";
  if (team.periods.length === 0) {
    return fail(id, "HARD", "The period box could not be read, so the quarters cannot be checked.");
  }
  const expected = cumulate(team.periods);

  if (derived.length !== expected.length) {
    return fail(
      id,
      "HARD",
      `The period box gives ${expected.length} quarters but ${derived.length} rungs are circled as period ends. A circled total was missed or invented.`,
    );
  }

  const wrong = expected.findIndex((total, index) => total !== derived[index]);
  if (wrong === -1) {
    return pass(id, "HARD", `All ${expected.length} period checkpoints agree (${expected.join(", ")}).`);
  }

  const from = wrong === 0 ? 0 : expected[wrong - 1];
  return fail(
    id,
    "HARD",
    `Quarter ${wrong + 1} does not reconcile: the ladder is circled at ${derived[wrong]} but the period box cumulates to ${expected[wrong]}. The error is between ${from} and ${expected[wrong]}.`,
  );
}

/**
 * Check 3 — the ladder is a pre-printed list of consecutive integers, so the
 * struck rungs must strictly increase and no basket can be worth more than
 * three or less than one. A difference of 4 means a struck total was missed;
 * a difference of 0 or less means a rung was read twice or out of order.
 */
function monotonicLadder(rungs: Basket[]): Check {
  const id: CheckId = "MONOTONIC_LADDER";
  const broken = rungs.find((rung) => rung.worth < 1 || rung.worth > 3);
  if (!broken) {
    return pass(id, "HARD", `${rungs.length} baskets, each worth 1, 2 or 3.`);
  }
  const previous = broken.runningTotal - broken.worth;
  return fail(
    id,
    "HARD",
    broken.worth > 3
      ? `The jump from ${previous} to ${broken.runningTotal} is ${broken.worth} points, so a struck total between them was missed.`
      : `The rung at ${broken.runningTotal} does not advance the score (previous rung ${previous}), so a total was read twice or out of order.`,
  );
}

/**
 * Check 3b — points nobody can be given.
 *
 * A rung whose shirt number is illegible is not a soft problem: the team total
 * would still reconcile while a player's season silently lost a basket. Better
 * to stop and have somebody read the number off the paper.
 */
function attributedScorers(rungs: Basket[]): Check {
  const id: CheckId = "ATTRIBUTED_SCORERS";
  const orphans = rungs.filter((rung) => rung.entry.shirt === null);
  if (orphans.length === 0) {
    return pass(id, "HARD", "Every basket has a scorer.");
  }
  return fail(
    id,
    "HARD",
    `${orphans.length} ${orphans.length === 1 ? "basket has" : "baskets have"} no readable scorer (at ${orphans.map((rung) => rung.runningTotal).join(", ")}), so ${orphans.length === 1 ? "it" : "they"} cannot be assigned to a player.`,
  );
}

/**
 * Check 4 — every scorer must be in the roster block *and* carry an `X`.
 *
 * A number that scored but did not play is a misread number, not a player who
 * sneaked on: the two marks are in different parts of the sheet and agreeing by
 * accident is unlikely.
 */
function knownShirts(
  rungs: Basket[],
  roster: Map<number, { played: boolean }>,
): Check {
  const id: CheckId = "KNOWN_SHIRTS";
  const scorers = [...new Set(rungs.map((rung) => rung.entry.shirt))].filter(
    (shirt): shirt is number => shirt !== null,
  );

  const missing = scorers.filter((shirt) => !roster.has(shirt));
  const benched = scorers.filter((shirt) => roster.get(shirt)?.played === false);

  if (missing.length === 0 && benched.length === 0) {
    return pass(id, "HARD", `All ${scorers.length} scorers are on the team sheet and marked as having played.`);
  }
  const parts = [
    missing.length > 0 ? `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the roster block` : null,
    benched.length > 0 ? `${benched.join(", ")} scored but ${benched.length === 1 ? "is" : "are"} not marked as having played` : null,
  ].filter(Boolean);
  return fail(id, "HARD", `Shirt ${parts.join("; ")}.`);
}

/** Check 5 — exactly five circled `X` marks, and a starter must have played. */
function fiveStarters(team: TranscribedTeam): Check {
  const id: CheckId = "FIVE_STARTERS";
  const starters = team.players.filter((player) => player.starter);
  const notPlaying = starters.filter((player) => !player.played);

  if (notPlaying.length > 0) {
    return fail(
      id,
      "HARD",
      `Shirt ${notPlaying.map((player) => player.shirt).join(", ")} is marked as a starter but not as having played.`,
    );
  }
  if (starters.length === STARTERS) {
    return pass(id, "HARD", `Five starters (${starters.map((player) => player.shirt).join(", ")}).`);
  }
  return fail(
    id,
    "HARD",
    `${starters.length} starters marked (${starters.map((player) => player.shirt).join(", ") || "none"}), and a match starts with five.`,
  );
}

/** Check 6 — five personal fouls and a player is disqualified, so six is a misread. */
function foulLimit(team: TranscribedTeam): Check {
  const id: CheckId = "FOUL_LIMIT";
  const over = team.players
    .map((player) => ({ shirt: player.shirt, fouls: foulCount(player.fouls) }))
    .filter((player) => player.fouls > MAX_FOULS);

  if (over.length === 0) {
    return pass(id, "HARD", "No player has more than five fouls.");
  }
  return fail(
    id,
    "HARD",
    over
      .map((player) => `Shirt ${player.shirt} has ${player.fouls} fouls, and five is disqualification.`)
      .join(" "),
  );
}

/**
 * Check 7 (soft) — the circled scorer numbers should be exactly the baskets
 * whose difference is 3.
 *
 * Soft because the arithmetic is authoritative and the circle is the scorer's
 * annotation of it: when they disagree it is usually a missing circle on a
 * correct three. Worth flagging because the other explanation is a misread
 * total, and then check 1 will have failed too.
 */
function threePointCircles(rungs: Basket[]): Check {
  const id: CheckId = "THREE_POINT_CIRCLES";
  const disagreeing = rungs.filter(
    (rung) => rung.entry.circledScorer !== (rung.worth === 3),
  );
  if (disagreeing.length === 0) {
    return pass(id, "SOFT", "Every circled scorer is a three-pointer, and every three-pointer is circled.");
  }
  return fail(
    id,
    "SOFT",
    disagreeing
      .map((rung) =>
        rung.entry.circledScorer
          ? `The scorer at ${rung.runningTotal} is circled as a three but the totals make it worth ${rung.worth}.`
          : `The basket at ${rung.runningTotal} is worth 3 but its scorer is not circled.`,
      )
      .join(" "),
  );
}

/** Check 9 (soft) — a roster block holds twelve rows. */
function rosterSize(team: TranscribedTeam): Check {
  const id: CheckId = "ROSTER_SIZE";
  if (team.players.length <= MAX_ROSTER) {
    return pass(id, "SOFT", `${team.players.length} players on the team sheet.`);
  }
  return fail(
    id,
    "SOFT",
    `${team.players.length} players read from a block that holds ${MAX_ROSTER}, so a row was read twice.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The failures, worst first, as one block of prose.
 *
 * Stored on the sheet row when an import is refused so the reason survives the
 * request that produced it — a secretary opening the sheet on Tuesday needs to
 * read why Sunday's import stopped.
 */
export function describeFailures(reading: TeamReading): string {
  const hard = reading.checks.filter((check) => check.severity === "HARD" && !check.passed);
  const soft = reading.checks.filter((check) => check.severity === "SOFT" && !check.passed);
  return [...hard, ...soft].map((check) => check.detail).join(" ");
}
