import { describe, expect, it } from "vitest";

import {
  applyAnswer,
  askQuestions,
  certainties,
  suggestAssignments,
  type ReviewState,
  type SquadOption,
} from "./questions";
import { readTeam } from "./reading";
import { parseLadder, parsePeriods, parseRoster } from "./notation";
import type { RefertoTranscription, TranscribedTeam } from "./transcription";

/* Gara 9714 again — the sheet that reconciles, so anything asked about it is
   something genuinely uncertain rather than a consequence of bad arithmetic. */

const LADDER = `
  2 7, 3 7, 5 9, 7 7, 9 14, 11 9, 13 34, 15 14, 16 33|,
  18 33, 20 23, 22 7, 24 14, 26 13, 28 13, 30 9, 32 6, 34 23, 36 14|,
  38 9, 40 9, 42 14, 44 34, 46 9, 49 34*, 51 33|,
  53 34, 54 9, 55 9, 57 9, 59 33, 60 14, 61 14, 63 34, 65 9, 66 34, 67 34|
`;

const ROSTER = `
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
`;

function team(overrides: Partial<TranscribedTeam> = {}): TranscribedTeam {
  return {
    clubName: "Future Basket Lodigiano",
    shirtColour: "bianco",
    players: parseRoster(ROSTER),
    periods: parsePeriods("16, 20, 15, 16"),
    finalScore: 67,
    ladder: parseLadder(LADDER),
    ...overrides,
  };
}

function opponent(overrides: Partial<TranscribedTeam> = {}): TranscribedTeam {
  return {
    clubName: "ASD Brescia Academy",
    shirtColour: "blu",
    players: [],
    periods: parsePeriods("12, 13, 19, 15"),
    finalScore: 59,
    ladder: [],
    ...overrides,
  };
}

function transcription(
  a: Partial<TranscribedTeam> = {},
  b: Partial<TranscribedTeam> = {},
): RefertoTranscription {
  return {
    gameNumber: "9714",
    date: "2026-10-18",
    time: "11:00",
    venue: "Palazzetto dello Sport Codogno",
    competition: "Under 13 Gold",
    teams: { a: team(a), b: opponent(b) },
  };
}

/** The whole squad registered with the numbers they actually wore. */
const SQUAD: SquadOption[] = [
  { athleteId: "ath-1", name: "Doko E.", jerseyNumber: 1 },
  { athleteId: "ath-4", name: "Magistrali L.", jerseyNumber: 4 },
  { athleteId: "ath-5", name: "Perin A.", jerseyNumber: 5 },
  { athleteId: "ath-6", name: "Sotgia L.", jerseyNumber: 6 },
  { athleteId: "ath-7", name: "Bersier L.", jerseyNumber: 7 },
  { athleteId: "ath-8", name: "Sanarica S.", jerseyNumber: 8 },
  { athleteId: "ath-9", name: "Rossi T.", jerseyNumber: 9 },
  { athleteId: "ath-13", name: "Russano K.D.", jerseyNumber: 13 },
  { athleteId: "ath-14", name: "Scarpetta L.", jerseyNumber: 14 },
  { athleteId: "ath-23", name: "Sampietro F.", jerseyNumber: 23 },
  { athleteId: "ath-33", name: "Guglielmetti F.", jerseyNumber: 33 },
  { athleteId: "ath-34", name: "Rosso A.", jerseyNumber: 34 },
];

function stateFor(
  overrides: { a?: Partial<TranscribedTeam>; b?: Partial<TranscribedTeam> } = {},
  squad: SquadOption[] = SQUAD,
): ReviewState {
  const doc = transcription(overrides.a, overrides.b);
  return {
    transcription: doc,
    side: "a",
    assignments: suggestAssignments(
      doc.teams.a.players.map((player) => player.shirt),
      squad,
    ),
  };
}

const ask = (state: ReviewState, squad = SQUAD, needsOpponentScore = true) =>
  askQuestions(state, readTeam(state.transcription.teams[state.side]), squad, {
    needsOpponentScore,
  });

describe("suggestAssignments", () => {
  it("fills in a number only one player is registered with", () => {
    const assignments = suggestAssignments([7, 9], SQUAD);
    expect(assignments).toEqual({ 7: "ath-7", 9: "ath-9" });
  });

  it("leaves a shirt nobody is registered with for a person to answer", () => {
    const assignments = suggestAssignments([77], SQUAD);
    expect(assignments[77]).toBeNull();
  });

  it("gives a contested number to neither shirt, whatever the list order", () => {
    /*
      Two children registered as 10. Handing it to whichever came first would
      hide exactly the case somebody needs to see, and would do it differently
      depending on how the squad query happened to sort.
      */
    const squad: SquadOption[] = [
      { athleteId: "x", name: "One", jerseyNumber: 10 },
      { athleteId: "y", name: "Two", jerseyNumber: 10 },
    ];
    expect(suggestAssignments([10], squad)[10]).toBeNull();
    expect(suggestAssignments([10], squad.slice().reverse())[10]).toBeNull();
  });

  it("does not let one athlete stand in for two shirts on the sheet", () => {
    // 9 and 19 both resolve to the child registered as 9 only if we are sloppy.
    const squad: SquadOption[] = [{ athleteId: "ath-9", name: "Rossi", jerseyNumber: 9 }];
    const assignments = suggestAssignments([9, 19], squad);
    expect(assignments[9]).toBe("ath-9");
    expect(assignments[19]).toBeNull();
  });
});

describe("askQuestions", () => {
  it("asks nothing when the sheet reconciles and every number is on file", () => {
    // The case worth protecting: a good photograph of a normal match should be
    // a single confirmation, not twelve decisions.
    expect(ask(stateFor())).toEqual([]);
  });

  it("asks which side is ours only when the names do not settle it", () => {
    expect(ask(stateFor()).filter((question) => question.kind === "SIDE")).toHaveLength(0);

    const unreadable = stateFor({ a: { clubName: null }, b: { clubName: null } });
    const sideQuestion = ask(unreadable).find((question) => question.kind === "SIDE");
    expect(sideQuestion).toBeDefined();
    if (sideQuestion?.kind !== "SIDE") throw new Error("wrong kind");
    expect(sideQuestion.options.map((option) => option.side)).toEqual(["a", "b"]);
  });

  it("asks who scored a basket whose shirt could not be read", () => {
    const state = stateFor({
      a: {
        ladder: parseLadder(LADDER).map((entry) =>
          entry.total === 65 ? { ...entry, shirt: null } : entry,
        ),
      },
    });

    const question = ask(state).find((candidate) => candidate.kind === "SCORER");
    expect(question).toBeDefined();
    if (question?.kind !== "SCORER") throw new Error("wrong kind");
    expect(question.total).toBe(65);
    // 63 → 65 is two points, which narrows what the answer can plausibly be.
    expect(question.worth).toBe(2);
    // Only players the sheet says took part; a bench player is not an option.
    expect(question.options).toContain(9);
    expect(question.options).toHaveLength(12);
  });

  it("asks who wore a shirt nobody is registered with, and says why", () => {
    const thinSquad = SQUAD.filter((member) => member.jerseyNumber !== 14);
    const state = stateFor({}, thinSquad);

    const question = ask(state, thinSquad).find(
      (candidate) => candidate.kind === "PLAYER" && candidate.shirt === 14,
    );
    expect(question).toBeDefined();
    if (question?.kind !== "PLAYER") throw new Error("wrong kind");
    expect(question.reason).toBe("NO_NUMBER_ON_FILE");
    // The name off the paper is what makes this answerable at a glance.
    expect(question.nameOnSheet).toBe("Scarpetta L.");
    expect(question.points).toBe(12);
    // Nobody already spoken for is offered.
    expect(question.options.map((option) => option.athleteId)).not.toContain("ath-9");
  });

  it("distinguishes a borrowed shirt from a missing registration", () => {
    const squad: SquadOption[] = [
      ...SQUAD.filter((member) => member.jerseyNumber !== 14),
      { athleteId: "ath-14", name: "Scarpetta L.", jerseyNumber: 14 },
      { athleteId: "ath-99", name: "Ghiglione M.", jerseyNumber: 14 },
    ];
    const state = stateFor({}, squad);

    const question = ask(state, squad).find(
      (candidate) => candidate.kind === "PLAYER" && candidate.shirt === 14,
    );
    if (question?.kind !== "PLAYER") throw new Error("wrong kind");
    expect(question.reason).toBe("NUMBER_CLAIMED_TWICE");
  });

  it("asks the biggest scorer's identity first", () => {
    const state = stateFor({}, []);
    const players = ask(state, []).filter((question) => question.kind === "PLAYER");
    const points = players.map((question) =>
      question.kind === "PLAYER" ? question.points : -1,
    );
    expect(points).toEqual([...points].sort((a, b) => b - a));
    expect(points[0]).toBe(18);
  });

  it("asks for the opponent's score only when a result needs it", () => {
    const missing = stateFor();
    missing.transcription.teams.b = opponent({ finalScore: null });

    expect(
      ask(missing, SQUAD, true).filter((question) => question.kind === "OPPONENT_SCORE"),
    ).toHaveLength(1);
    // Not asked when the club is not writing a result from this sheet.
    expect(
      ask(missing, SQUAD, false).filter((question) => question.kind === "OPPONENT_SCORE"),
    ).toHaveLength(0);
  });

  it("offers their quarters as the suggestion when the final is smudged", () => {
    const missing = stateFor();
    missing.transcription.teams.b = opponent({ finalScore: null });

    const question = ask(missing).find((candidate) => candidate.kind === "OPPONENT_SCORE");
    if (question?.kind !== "OPPONENT_SCORE") throw new Error("wrong kind");
    // 12 + 13 + 19 + 15, which is the number on the paper read another way.
    expect(question.suggestion).toBe(59);
  });

  it("does not ask about a player who never left the bench", () => {
    // Nobody needs assigning a box score line they cannot have.
    const state = stateFor({
      a: {
        players: parseRoster(ROSTER).map((player) =>
          player.shirt === 4 ? { ...player, played: false } : player,
        ),
      },
    }, []);

    const asked = ask(state, []).filter(
      (question) => question.kind === "PLAYER" && question.shirt === 4,
    );
    expect(asked).toHaveLength(0);
  });
});

describe("applyAnswer", () => {
  it("writes a scorer back onto the ladder and re-derives the points", () => {
    const state = stateFor({
      a: {
        ladder: parseLadder(LADDER).map((entry) =>
          entry.total === 65 ? { ...entry, shirt: null } : entry,
        ),
      },
    });

    // Before: the basket is unattributed, so the sheet does not reconcile.
    expect(readTeam(state.transcription.teams.a).ok).toBe(false);

    const next = applyAnswer(state, { kind: "SCORER", ladderIndex: 34, shirt: 9 }, SQUAD);
    const reading = readTeam(next.transcription.teams.a);

    expect(reading.ok).toBe(true);
    expect(reading.points).toBe(67);
    expect(reading.lines.find((line) => line.shirt === 9)?.points).toBe(18);
  });

  it("records who wore a shirt", () => {
    const next = applyAnswer(
      stateFor({}, []),
      { kind: "PLAYER", shirt: 14, athleteId: "ath-14" },
      SQUAD,
    );
    expect(next.assignments[14]).toBe("ath-14");
  });

  it("re-suggests from scratch when the side changes", () => {
    /*
      The old assignments were about the other club's numbers. Keeping them
      would import the opponent's players under our athletes' names, which is
      the worst thing this screen could do.
    */
    const doc = transcription(
      { clubName: null },
      {
        clubName: null,
        players: parseRoster("7 Other P.\n9 Another Q."),
        ladder: parseLadder("2 7, 4 9"),
        finalScore: 4,
        periods: parsePeriods("4"),
      },
    );
    const state: ReviewState = {
      transcription: doc,
      side: "a",
      assignments: { 7: "ath-7", 9: "ath-9", 14: "ath-14" },
    };

    const next = applyAnswer(state, { kind: "SIDE", side: "b" }, SQUAD);
    expect(next.side).toBe("b");
    expect(Object.keys(next.assignments).map(Number).sort((a, b) => a - b)).toEqual([7, 9]);
    expect(next.assignments[14]).toBeUndefined();
  });

  it("writes the opponent's score onto their block, not ours", () => {
    const missing = stateFor();
    missing.transcription.teams.b = opponent({ finalScore: null });

    const next = applyAnswer(missing, { kind: "OPPONENT_SCORE", score: 59 }, SQUAD);
    expect(next.transcription.teams.b.finalScore).toBe(59);
    expect(next.transcription.teams.a.finalScore).toBe(67);
  });

  it("answering every question empties the queue", () => {
    // The property that makes the dialog finishable: each answer removes its
    // own question and introduces none.
    let state = stateFor({}, []);
    let questions = ask(state, []);
    expect(questions.length).toBeGreaterThan(0);

    let guard = 0;
    while (questions.length > 0 && guard < 50) {
      const [question] = questions;
      if (question.kind === "PLAYER") {
        state = applyAnswer(
          state,
          { kind: "PLAYER", shirt: question.shirt, athleteId: `ath-${question.shirt}` },
          [],
        );
      } else if (question.kind === "SCORER") {
        state = applyAnswer(
          state,
          { kind: "SCORER", ladderIndex: question.ladderIndex, shirt: question.options[0] },
          [],
        );
      } else if (question.kind === "OPPONENT_SCORE") {
        state = applyAnswer(state, { kind: "OPPONENT_SCORE", score: 59 }, []);
      } else {
        state = applyAnswer(state, { kind: "SIDE", side: "a" }, []);
      }
      questions = ask(state, []);
      guard += 1;
    }

    expect(questions).toEqual([]);
    expect(guard).toBeLessThan(50);
  });
});

describe("certainties", () => {
  it("lists what needed no question on a clean sheet", () => {
    const state = stateFor();
    const list = certainties(state, readTeam(state.transcription.teams.a), {
      needsOpponentScore: true,
    });
    const kinds = list.map((entry) => entry.kind);

    expect(kinds).toContain("SIDE");
    expect(kinds).toContain("PLAYERS_MATCHED");
    expect(kinds).toContain("POINTS");
    expect(kinds).toContain("QUARTERS");
    expect(kinds).toContain("STARTERS");
    expect(kinds).toContain("SCORE");

    expect(list.find((entry) => entry.kind === "PLAYERS_MATCHED")).toMatchObject({
      matched: 12,
      total: 12,
    });
    expect(list.find((entry) => entry.kind === "SCORE")).toMatchObject({
      ourScore: 67,
      theirScore: 59,
    });
  });

  it("never claims a total that did not reconcile", () => {
    // A figure that failed its check is not a certainty, however plausible.
    const state = stateFor({ a: { finalScore: 68 } });
    const list = certainties(state, readTeam(state.transcription.teams.a));

    expect(list.map((entry) => entry.kind)).not.toContain("POINTS");
    expect(list.map((entry) => entry.kind)).not.toContain("SCORE");
  });

  it("counts only the players actually matched", () => {
    const thin = SQUAD.filter((member) => member.jerseyNumber !== 14);
    const state = stateFor({}, thin);
    const list = certainties(state, readTeam(state.transcription.teams.a));

    expect(list.find((entry) => entry.kind === "PLAYERS_MATCHED")).toMatchObject({
      matched: 11,
      total: 12,
    });
  });
});
