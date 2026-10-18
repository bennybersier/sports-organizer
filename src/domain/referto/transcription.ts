/**
 * What a model is asked to report having seen on a FIP referto.
 *
 * Every field here is a *mark on paper*, never a conclusion. The model says
 * "the total 49 is struck through and the number 34 beside it is circled"; it
 * is never asked what that was worth, who is winning, or whether the sheet adds
 * up. All of that is arithmetic, and arithmetic belongs in `reading.ts` where it
 * can be tested against a known sheet and cannot quietly be wrong.
 *
 * The division matters for a second reason. A transcription is expensive — it
 * costs a model call against a photograph — and a reading is free. Keeping them
 * apart means a disputed import can be re-derived in March from what the model
 * said in October, and the question "did the model misread the paper, or did we
 * misread the model?" has an answer.
 *
 * The document this describes is specified in docs/referto-import.md.
 */

/** A player's row in a roster block. */
export interface TranscribedPlayer {
  /**
   * The `N.` column: the shirt number. The key the progressive score refers
   * back to, so a misreading here corrupts everything downstream — which is
   * why check 4 in `reading.ts` refuses any scorer that is not in this list.
   */
  shirt: number;
  /** `Cognome`, as written. */
  surname: string;
  /** `Nome`, usually an initial only (`E.`, `K.D.`). Stored as written. */
  givenName: string | null;
  /**
   * `ANNO NASC`, expanded to four digits. A registration year, not a date of
   * birth: the sheet gives two digits and nothing else is knowable from it.
   */
  birthYear: number | null;
  /** An `X` in the `E/N.` column: this player took part. */
  played: boolean;
  /** That `X` circled or struck through: this player started. */
  starter: boolean;
  /**
   * The `FALLI` marks in sequence, as written: `P`, `P1`, `P2`, `P3`, `T`,
   * `U`, `D`. One entry per foul committed — the digit is free throws awarded
   * to the opponent, not a count, so `["P", "P2", "P3"]` is three fouls.
   */
  fouls: string[];
}

/**
 * One rung of the `PUNTEGGIO PROGRESSIVO` ladder.
 *
 * The scorer never writes what a basket was worth. They strike through the
 * running total the team has now *reached* and put the scorer's shirt number
 * beside it, so the value of a basket is a difference between consecutive rungs.
 */
export interface LadderEntry {
  /** The running total struck through. */
  total: number;
  /** The shirt number written beside it; null when it cannot be made out. */
  shirt: number | null;
  /**
   * The scorer's number is circled, which the scorer uses to mark a
   * three-pointer. Redundant with the arithmetic and therefore a free check.
   */
  circledScorer: boolean;
  /**
   * The *total* is circled and underlined: a period ended here, and this is
   * the team's cumulative score at that buzzer. Not to be confused with the
   * circle above — that one is in the scorer column and is never underlined.
   */
  periodEnd: boolean;
}

/** One of the two roster blocks, with its ladder and its scores. */
export interface TranscribedTeam {
  /** `Denominazione Sociale`. */
  clubName: string | null;
  /** `COLORE MAGLIA` — how to tell the blocks apart when the photo is cropped. */
  shirtColour: string | null;
  players: TranscribedPlayer[];
  /**
   * The period box bottom right, per quarter and *not* cumulative: a sheet
   * reading `1º 16, 2º 20, 3º 15, 4º 16` gives `[16, 20, 15, 16]`.
   */
  periods: number[];
  /** `RISULTATO FINALE` for this side. */
  finalScore: number | null;
  /** Every struck rung, in the order they were struck. */
  ladder: LadderEntry[];
}

/**
 * A whole sheet, as seen.
 *
 * Squadra A is always the home side, which is the only way to attach the two
 * blocks to the right clubs when the header is unreadable.
 */
export interface RefertoTranscription {
  /** `GARA N.` */
  gameNumber: string | null;
  /** `Data`, as an ISO date if it could be read. */
  date: string | null;
  /** `Ore`, as `HH:MM`. */
  time: string | null;
  /** `Campo`. */
  venue: string | null;
  /** `Campionato` and `Girone`, joined as printed. */
  competition: string | null;
  /** Squadra A — the home side — then squadra B. */
  teams: { a: TranscribedTeam; b: TranscribedTeam };
}

/** The side of the sheet one of our teams played on. */
export type SheetSide = "a" | "b";
