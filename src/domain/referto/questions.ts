/**
 * Turning an uncertain reading into a short list of answerable questions.
 *
 * ## The rule this file exists to enforce
 *
 * **Only ask a question whose answer the code can apply.**
 *
 * It is tempting to surface every doubt as a prompt, and it produces a review
 * screen that cannot be finished. "The points add to 65 but the sheet says 67"
 * is a real problem and it is *not* a question: there is no option a person can
 * pick that fixes it, because the error could be any of a hundred rungs. That
 * belongs in `reading.ts` as a stated check with the arithmetic shown, so
 * somebody can look at the paper.
 *
 * What is left — and it is most of what actually goes wrong — are four things
 * with a finite set of answers that each have a mechanical effect:
 *
 *   SIDE            which roster block is ours
 *   SCORER          a shirt number beside a struck total that nobody could read
 *   PLAYER          which of our athletes wore shirt N that day
 *   OPPONENT_SCORE  their final score, when the result cannot be written without it
 *
 * Everything the reader *is* confident about is not asked at all. It is listed
 * once, as a block the uploader confirms in one action, which is the difference
 * between a review that takes fifteen seconds and one that takes twelve
 * decisions.
 */

import type { TeamReading } from "./reading";
import type { RefertoTranscription, SheetSide } from "./transcription";

export interface SquadOption {
  athleteId: string;
  name: string;
  /** The number on file. A suggestion, never a key — see `suggestAssignments`. */
  jerseyNumber: number | null;
}

/** shirt number → athlete, or null for "nobody yet". */
export type Assignments = Record<number, string | null>;

export interface ReviewState {
  transcription: RefertoTranscription;
  side: SheetSide;
  assignments: Assignments;
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                  */
/* -------------------------------------------------------------------------- */

export type Question =
  | {
      kind: "SIDE";
      id: string;
      options: { side: SheetSide; clubName: string | null; players: number; points: number }[];
    }
  | {
      kind: "SCORER";
      id: string;
      /** Where to write the answer back. */
      ladderIndex: number;
      /** The running total this basket reached, so it can be found on the paper. */
      total: number;
      /** What the difference says it was worth: 1, 2 or 3. */
      worth: number;
      /** Shirts the roster says took part — the only numbers this can be. */
      options: number[];
    }
  | {
      kind: "PLAYER";
      id: string;
      shirt: number;
      /** Surname and initials as written, which is usually enough to recognise. */
      nameOnSheet: string | null;
      points: number;
      /** Why this one is being asked rather than filled in. */
      reason: "NO_NUMBER_ON_FILE" | "NUMBER_CLAIMED_TWICE";
      /** Squad members not already spoken for by another shirt. */
      options: SquadOption[];
    }
  | {
      kind: "OPPONENT_SCORE";
      id: string;
      clubName: string | null;
      /** What their quarters add to, when those could be read. */
      suggestion: number | null;
    };

export type Answer =
  | { kind: "SIDE"; side: SheetSide }
  | { kind: "SCORER"; ladderIndex: number; shirt: number | null }
  | { kind: "PLAYER"; shirt: number; athleteId: string | null }
  | { kind: "OPPONENT_SCORE"; score: number | null };

/**
 * First guess at who is who, from the numbers on file.
 *
 * A suggestion and nothing more. `athlete_teams.jersey_number` is the number a
 * player is *registered* with; the number on the sheet is the one they wore that
 * day, and a borrowed shirt is a normal Saturday. They agree most weeks, which
 * is what makes this worth doing, and the weeks they do not are what the PLAYER
 * question is for.
 *
 * A number claimed by two shirts is given to neither: silently handing it to
 * whichever row came first would hide exactly the case a human needs to see.
 */
export function suggestAssignments(shirts: number[], squad: SquadOption[]): Assignments {
  const byNumber = new Map<number, string[]>();
  for (const member of squad) {
    if (member.jerseyNumber === null) continue;
    byNumber.set(member.jerseyNumber, [
      ...(byNumber.get(member.jerseyNumber) ?? []),
      member.athleteId,
    ]);
  }

  /*
    How many shirts on the sheet want each athlete. Counted before anything is
    assigned, so the decision does not depend on the order of the list.
  */
  const wantedBy = new Map<string, number>();
  for (const shirt of shirts) {
    for (const athleteId of byNumber.get(shirt) ?? []) {
      wantedBy.set(athleteId, (wantedBy.get(athleteId) ?? 0) + 1);
    }
  }

  const assignments: Assignments = {};
  for (const shirt of shirts) {
    const candidates = byNumber.get(shirt) ?? [];
    // One number, one athlete, and that athlete wanted by only this shirt.
    const confident =
      candidates.length === 1 && wantedBy.get(candidates[0]) === 1 ? candidates[0] : null;
    assignments[shirt] = confident;
  }
  return assignments;
}

/**
 * The questions this reading still needs answered, in the order to ask them.
 *
 * SIDE comes first because it changes every other answer: asking who wore shirt
 * 9 before knowing whose shirt 9 is would mean asking again. SCORER comes next
 * because an unattributed basket changes the points a PLAYER question is shown
 * alongside. PLAYER questions are ordered by points scored, so the ones that
 * matter most to somebody's season are answered while attention is freshest.
 */
export function askQuestions(
  state: ReviewState,
  reading: TeamReading,
  squad: SquadOption[],
  options: { needsOpponentScore?: boolean } = {},
): Question[] {
  const questions: Question[] = [];
  const { transcription, side, assignments } = state;
  const team = transcription.teams[side];

  /*
    Which block is ours is only worth asking when the club names did not settle
    it. When one block carries our name there is nothing to ask, and asking
    anyway trains people to click through the one question that would have
    mattered.
  */
  if (!sideIsObvious(transcription)) {
    questions.push({
      kind: "SIDE",
      id: "side",
      options: (["a", "b"] as const).map((candidate) => {
        const block = transcription.teams[candidate];
        return {
          side: candidate,
          clubName: block.clubName,
          players: block.players.length,
          points: block.finalScore ?? 0,
        };
      }),
    });
  }

  // Shirts the sheet says took part: the only numbers an unreadable scorer
  // could be. Offering the whole roster would include players who never left
  // the bench, which is a wrong answer dressed up as a choice.
  const playedShirts = team.players
    .filter((player) => player.played)
    .map((player) => player.shirt)
    .sort((a, b) => a - b);

  team.ladder.forEach((entry, index) => {
    if (entry.shirt !== null) return;
    const previous = index === 0 ? 0 : team.ladder[index - 1].total;
    questions.push({
      kind: "SCORER",
      id: `scorer:${index}`,
      ladderIndex: index,
      total: entry.total,
      worth: entry.total - previous,
      options: playedShirts,
    });
  });

  const taken = new Set(
    Object.values(assignments).filter((athleteId): athleteId is string => athleteId !== null),
  );
  const numbersOnFile = new Set(
    squad.map((member) => member.jerseyNumber).filter((number) => number !== null),
  );

  const needsPlayer = reading.lines
    .filter((line) => line.played || line.points > 0)
    .filter((line) => (assignments[line.shirt] ?? null) === null)
    .sort((a, b) => b.points - a.points);

  for (const line of needsPlayer) {
    const player = team.players.find((entry) => entry.shirt === line.shirt);
    questions.push({
      kind: "PLAYER",
      id: `player:${line.shirt}`,
      shirt: line.shirt,
      nameOnSheet: player
        ? [player.surname, player.givenName].filter(Boolean).join(" ")
        : null,
      points: line.points,
      /*
        The two reasons read very differently to the person answering. "No
        player is registered with 14" is a gap in the club's own records;
        "two shirts both want number 14" means somebody wore a borrowed shirt,
        and they will know which.
      */
      reason: numbersOnFile.has(line.shirt) ? "NUMBER_CLAIMED_TWICE" : "NO_NUMBER_ON_FILE",
      options: squad.filter((member) => !taken.has(member.athleteId)),
    });
  }

  /*
    Their score, only when it is actually needed. The import writes a result
    from both finals, so an unreadable opponent total is the difference between
    recording 67–59 and recording nothing — but if the club has already typed
    the result in by hand there is nothing to ask.
  */
  if (options.needsOpponentScore) {
    const otherSide: SheetSide = side === "a" ? "b" : "a";
    const theirs = transcription.teams[otherSide];
    if (theirs.finalScore === null) {
      const fromPeriods = theirs.periods.length > 0
        ? theirs.periods.reduce((total, period) => total + period, 0)
        : null;
      questions.push({
        kind: "OPPONENT_SCORE",
        id: "opponentScore",
        clubName: theirs.clubName,
        suggestion: fromPeriods,
      });
    }
  }

  return questions;
}

/**
 * Whether the club names already decide which block is ours.
 *
 * Mirrors `chooseSide` in the sheet service, which picks the side in the first
 * place; this only asks whether that pick was a reading of the paper or a
 * fallback. The two must agree, or the screen would ask about a side it had
 * already chosen confidently — or worse, not ask about one it guessed.
 */
function sideIsObvious(transcription: RefertoTranscription): boolean {
  const a = (transcription.teams.a.clubName ?? "").trim();
  const b = (transcription.teams.b.clubName ?? "").trim();
  // Exactly one name legible is enough to place ourselves; neither, or two that
  // both could be ours, is not.
  return (a === "") !== (b === "") || (a !== "" && b !== "");
}

/* -------------------------------------------------------------------------- */
/* Applying an answer                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Folds one answer into the review state.
 *
 * Pure, so the screen can re-derive the reading and the remaining questions
 * from the result without a round trip, and so this can be tested without a
 * browser. Switching sides re-suggests the assignments from scratch: the old
 * ones were about the other club's shirt numbers and keeping them would quietly
 * import the opponent's players.
 */
export function applyAnswer(
  state: ReviewState,
  answer: Answer,
  squad: SquadOption[],
): ReviewState {
  switch (answer.kind) {
    case "SIDE": {
      const team = state.transcription.teams[answer.side];
      const shirts = team.players.map((player) => player.shirt);
      return {
        ...state,
        side: answer.side,
        assignments: suggestAssignments(shirts, squad),
      };
    }

    case "SCORER": {
      const team = state.transcription.teams[state.side];
      const ladder = team.ladder.map((entry, index) =>
        index === answer.ladderIndex ? { ...entry, shirt: answer.shirt } : entry,
      );
      return {
        ...state,
        transcription: withTeam(state.transcription, state.side, { ...team, ladder }),
      };
    }

    case "PLAYER":
      return {
        ...state,
        assignments: { ...state.assignments, [answer.shirt]: answer.athleteId },
      };

    case "OPPONENT_SCORE": {
      const otherSide: SheetSide = state.side === "a" ? "b" : "a";
      const theirs = state.transcription.teams[otherSide];
      return {
        ...state,
        transcription: withTeam(state.transcription, otherSide, {
          ...theirs,
          finalScore: answer.score,
        }),
      };
    }
  }
}

function withTeam(
  transcription: RefertoTranscription,
  side: SheetSide,
  team: RefertoTranscription["teams"]["a"],
): RefertoTranscription {
  return {
    ...transcription,
    teams: { ...transcription.teams, [side]: team } as RefertoTranscription["teams"],
  };
}

/* -------------------------------------------------------------------------- */
/* What the reader is certain about                                           */
/* -------------------------------------------------------------------------- */

/**
 * The things that need no question, as a list to confirm in one action.
 *
 * Data rather than prose, so the screen can render it in the uploader's own
 * language. Each entry is something that would have been a question if it had
 * gone wrong, which is what makes the list worth reading rather than reassuring
 * noise.
 */
export type Certainty =
  | { kind: "SIDE"; clubName: string }
  | { kind: "PLAYERS_MATCHED"; matched: number; total: number }
  | { kind: "POINTS"; points: number }
  | { kind: "QUARTERS"; periods: number[] }
  | { kind: "STARTERS"; shirts: number[] }
  | { kind: "FOULS"; players: number }
  | { kind: "SCORE"; ourScore: number; theirScore: number };

export function certainties(
  state: ReviewState,
  reading: TeamReading,
  options: { needsOpponentScore?: boolean } = {},
): Certainty[] {
  const { transcription, side, assignments } = state;
  const team = transcription.teams[side];
  const list: Certainty[] = [];

  if (team.clubName && sideIsObvious(transcription)) {
    list.push({ kind: "SIDE", clubName: team.clubName });
  }

  const relevant = reading.lines.filter((line) => line.played || line.points > 0);
  const matched = relevant.filter((line) => (assignments[line.shirt] ?? null) !== null).length;
  if (matched > 0) {
    list.push({ kind: "PLAYERS_MATCHED", matched, total: relevant.length });
  }

  // Only claimed where the check that proves it actually passed. A points total
  // that does not reconcile is not a certainty, however confident it looks.
  const passed = (id: string) =>
    reading.checks.some((check) => check.id === id && check.passed);

  if (passed("POINTS_RECONCILE")) list.push({ kind: "POINTS", points: reading.points });
  if (passed("PERIOD_CHECKPOINTS")) {
    list.push({ kind: "QUARTERS", periods: reading.periods });
  }
  if (passed("FIVE_STARTERS")) {
    list.push({
      kind: "STARTERS",
      shirts: reading.lines.filter((line) => line.starter).map((line) => line.shirt),
    });
  }
  if (passed("FOUL_LIMIT")) {
    list.push({
      kind: "FOULS",
      players: reading.lines.filter((line) => line.foulsCommitted > 0).length,
    });
  }

  const otherSide: SheetSide = side === "a" ? "b" : "a";
  const theirScore = transcription.teams[otherSide].finalScore;
  if (options.needsOpponentScore && theirScore !== null && passed("POINTS_RECONCILE")) {
    list.push({ kind: "SCORE", ourScore: reading.points, theirScore });
  }

  return list;
}
