/**
 * Summing box scores without averaging away the difference between them.
 *
 * ## The problem this file exists to solve
 *
 * A box score row can come from two places, and they do not record the same
 * things. A coach typing off a stats app enters everything. A game sheet — the
 * FIP referto, see docs/referto-import.md §6 — records **only** who played, who
 * started, the baskets each player made, and their fouls. It has no shot
 * attempts, no rebounds, no assists, no steals, no blocks, no turnovers and no
 * minutes.
 *
 * Those absences are stored as zeroes, because the column is `not null default
 * 0` and there is no other honest value to put there. Which means the naive
 * average is actively misleading in two separate ways:
 *
 *   - **Rebounds and assists get dragged towards zero.** A player with 6
 *     rebounds a game in the three matches somebody kept stats for, and ten
 *     more matches imported from sheets, averages 1.4. That number is wrong,
 *     not imprecise.
 *   - **Percentages and valutazione become nonsense.** A referto import sets
 *     `attempted = made`, because the database enforces `made <= attempted` and
 *     attempts are genuinely unknown. So shooting reads 100%, and `efficiency`
 *     — which subtracts missed shots — degenerates to points minus fouls.
 *
 * The rule here is therefore: **a statistic is averaged only over the games
 * that could have recorded it**, and where no game could, it is absent rather
 * than zero. A figure that cannot be known is not displayed at all — not as
 * "0.0", not as "—" with an asterisk. The shape of this type is what forces
 * that on every caller: the figures a sheet cannot produce live behind a
 * nullable `detail`, so rendering them without checking is a type error.
 */

import type { BoxScoreSource } from "@/types/database";

/** The columns this module reads. A row shape, not the whole table. */
export interface BoxScoreFact {
  source: BoxScoreSource;
  secondsPlayed: number;
  twoPointMade: number;
  twoPointAttempted: number;
  threePointMade: number;
  threePointAttempted: number;
  freeThrowMade: number;
  freeThrowAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  foulsCommitted: number;
  foulsDrawn: number;
  points: number;
  rebounds: number;
  efficiency: number;
}

/**
 * The figures a game sheet *can* produce, and therefore the ones that are safe
 * to average over every game a player has.
 */
export interface BasicTotals {
  points: number;
  fouls: number;
  twoPointMade: number;
  threePointMade: number;
  freeThrowMade: number;
}

/**
 * The figures only a full stats entry can produce.
 *
 * Averaged over `games`, which is the count of rows that recorded them — never
 * over the player's whole season.
 */
export interface DetailedTotals {
  /** How many of the player's games these are drawn from. */
  games: number;
  minutes: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  foulsDrawn: number;
  efficiency: number;
  perGame: {
    minutes: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    efficiency: number;
  };
  /**
   * Made over attempted, as a fraction. Null for a shot type never attempted,
   * which is not the same as 0% — a player who never took a three has no
   * three-point percentage.
   */
  shooting: {
    twoPoint: number | null;
    threePoint: number | null;
    freeThrow: number | null;
    /** Points per shot from the floor, which survives a missing split. */
    effectiveFieldGoal: number | null;
  };
}

export interface BoxScoreSummary {
  games: number;
  /** Games whose numbers came off a photographed sheet. */
  sheetGames: number;
  basic: BasicTotals;
  perGame: { points: number; fouls: number };
  /**
   * Null when no game recorded the full set — a player whose whole season was
   * imported from sheets has no rebound average, and must not be shown one.
   */
  detail: DetailedTotals | null;
}

/**
 * Whether a row can be trusted for the detailed statistics.
 *
 * Source is the test rather than "are the numbers all zero", because a genuine
 * stat line of all zeroes exists — a player who came on for two minutes and did
 * nothing — and excluding it would flatter the average. A MANUAL row means
 * somebody sat with the game and filled the columns in; what they wrote is what
 * happened, zeroes included.
 */
function isDetailed(fact: BoxScoreFact): boolean {
  return fact.source === "MANUAL";
}

const ratio = (made: number, attempted: number): number | null =>
  attempted === 0 ? null : made / attempted;

export function summariseBoxScores(facts: BoxScoreFact[]): BoxScoreSummary | null {
  if (facts.length === 0) return null;

  const basic = facts.reduce<BasicTotals>(
    (sum, fact) => ({
      points: sum.points + fact.points,
      fouls: sum.fouls + fact.foulsCommitted,
      twoPointMade: sum.twoPointMade + fact.twoPointMade,
      threePointMade: sum.threePointMade + fact.threePointMade,
      freeThrowMade: sum.freeThrowMade + fact.freeThrowMade,
    }),
    { points: 0, fouls: 0, twoPointMade: 0, threePointMade: 0, freeThrowMade: 0 },
  );

  const games = facts.length;
  const detailed = facts.filter(isDetailed);

  return {
    games,
    sheetGames: games - detailed.length,
    basic,
    perGame: { points: basic.points / games, fouls: basic.fouls / games },
    detail: detailed.length === 0 ? null : detailsOf(detailed),
  };
}

function detailsOf(facts: BoxScoreFact[]): DetailedTotals {
  const totals = facts.reduce(
    (sum, fact) => ({
      seconds: sum.seconds + fact.secondsPlayed,
      rebounds: sum.rebounds + fact.rebounds,
      offensiveRebounds: sum.offensiveRebounds + fact.offensiveRebounds,
      defensiveRebounds: sum.defensiveRebounds + fact.defensiveRebounds,
      assists: sum.assists + fact.assists,
      steals: sum.steals + fact.steals,
      blocks: sum.blocks + fact.blocks,
      turnovers: sum.turnovers + fact.turnovers,
      foulsDrawn: sum.foulsDrawn + fact.foulsDrawn,
      efficiency: sum.efficiency + fact.efficiency,
      twoMade: sum.twoMade + fact.twoPointMade,
      twoAttempted: sum.twoAttempted + fact.twoPointAttempted,
      threeMade: sum.threeMade + fact.threePointMade,
      threeAttempted: sum.threeAttempted + fact.threePointAttempted,
      ftMade: sum.ftMade + fact.freeThrowMade,
      ftAttempted: sum.ftAttempted + fact.freeThrowAttempted,
    }),
    {
      seconds: 0, rebounds: 0, offensiveRebounds: 0, defensiveRebounds: 0,
      assists: 0, steals: 0, blocks: 0, turnovers: 0, foulsDrawn: 0, efficiency: 0,
      twoMade: 0, twoAttempted: 0, threeMade: 0, threeAttempted: 0,
      ftMade: 0, ftAttempted: 0,
    },
  );

  const games = facts.length;
  const minutes = totals.seconds / 60;
  const fieldGoalAttempts = totals.twoAttempted + totals.threeAttempted;

  return {
    games,
    minutes,
    rebounds: totals.rebounds,
    offensiveRebounds: totals.offensiveRebounds,
    defensiveRebounds: totals.defensiveRebounds,
    assists: totals.assists,
    steals: totals.steals,
    blocks: totals.blocks,
    turnovers: totals.turnovers,
    foulsDrawn: totals.foulsDrawn,
    efficiency: totals.efficiency,
    perGame: {
      minutes: minutes / games,
      rebounds: totals.rebounds / games,
      assists: totals.assists / games,
      steals: totals.steals / games,
      blocks: totals.blocks / games,
      turnovers: totals.turnovers / games,
      efficiency: totals.efficiency / games,
    },
    shooting: {
      twoPoint: ratio(totals.twoMade, totals.twoAttempted),
      threePoint: ratio(totals.threeMade, totals.threeAttempted),
      freeThrow: ratio(totals.ftMade, totals.ftAttempted),
      /*
        Effective field goal percentage credits a three with the extra point it
        is worth, which is why it is the one shooting figure worth quoting for a
        guard and a centre side by side.
      */
      effectiveFieldGoal:
        fieldGoalAttempts === 0
          ? null
          : (totals.twoMade * 2 + totals.threeMade * 3) / (fieldGoalAttempts * 2),
    },
  };
}
