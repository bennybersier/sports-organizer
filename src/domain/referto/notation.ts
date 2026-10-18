/**
 * A compact text form for a transcribed sheet, so a person can correct one.
 *
 * ## Why text and not a grid of inputs
 *
 * A senior game's ladder is around a hundred rungs. Rendering that as a hundred
 * paired inputs is a page nobody scrolls to the bottom of, and the correction a
 * secretary actually needs to make is almost always "rung 46 says 9, it's a 6" —
 * a single character. Text gives them find-and-fix, keyboard only, with the
 * whole sheet visible at once, and it survives being pasted into an email when
 * somebody wants a second opinion.
 *
 * The notation is the one the specification already uses to work gara 9714 by
 * hand (docs/referto-import.md §4), which means the worked example in the docs
 * is directly paste-able into the editor.
 *
 * ## Ladder
 *
 *     2 7, 3 7, 5 9, 16 33|, 49 34*, 67 34|
 *
 * `<total> <shirt>`, then `*` if the scorer's number is circled (a three) and
 * `|` if the total is circled and underlined (a period end). `?` is a shirt
 * nobody could read, and is deliberately expressible: a null must be as easy to
 * write as a guess, or people guess.
 *
 * ## Roster
 *
 *     7 Bersier L. * P1 P2
 *     8 Sanarica S.
 *     34 Rosso A. -
 *
 * `<number> <surname> [initials]`, then `*` for a starter, `-` for a player who
 * did not take part, and the foul marks as written. Fouls are recognised by
 * shape rather than by position, so they may be anywhere after the name.
 */

import type { LadderEntry, TranscribedPlayer } from "./transcription";

export class NotationError extends Error {
  constructor(
    /** 1-based, so it matches what the editor's gutter would show. */
    readonly line: number,
    readonly detail: string,
  ) {
    super(`Line ${line}: ${detail}`);
    this.name = "NotationError";
  }
}

const FOUL = /^[PTUD]\d?$/i;

/* -------------------------------------------------------------------------- */
/* Ladder                                                                     */
/* -------------------------------------------------------------------------- */

/** One rung per line, which is what makes a diff and a line number useful. */
export function formatLadder(ladder: LadderEntry[]): string {
  return ladder
    .map(
      (entry) =>
        `${entry.total} ${entry.shirt ?? "?"}${entry.circledScorer ? "*" : ""}${entry.periodEnd ? "|" : ""}`,
    )
    .join("\n");
}

/**
 * Reads the ladder back.
 *
 * Commas are accepted as well as newlines so the documentation's own one-line
 * form pastes in, and blank lines are ignored rather than being an error —
 * people group quarters with a gap, and refusing that would be pedantry.
 */
export function parseLadder(text: string): LadderEntry[] {
  const entries: LadderEntry[] = [];

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") return;

    for (const chunk of line.split(",")) {
      const rung = chunk.trim();
      if (rung === "") continue;

      const match = /^(\d{1,3})\s+(\d{1,3}|\?)([*|]{0,2})$/.exec(rung);
      if (!match) {
        throw new NotationError(
          index + 1,
          `"${rung}" is not a total followed by a shirt number. Write "46 9", and add * for a circled scorer or | for a period end.`,
        );
      }

      const marks = match[3];
      entries.push({
        total: Number(match[1]),
        shirt: match[2] === "?" ? null : Number(match[2]),
        circledScorer: marks.includes("*"),
        periodEnd: marks.includes("|"),
      });
    }
  });

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Roster                                                                     */
/* -------------------------------------------------------------------------- */

export function formatRoster(players: TranscribedPlayer[]): string {
  return players
    .map((player) =>
      [
        player.shirt,
        player.surname,
        player.givenName,
        player.starter ? "*" : null,
        player.played ? null : "-",
        ...player.fouls,
      ]
        .filter((part) => part !== null && part !== "")
        .join(" "),
    )
    .join("\n");
}

/**
 * Reads the roster back.
 *
 * Fouls are pulled out by shape before the name is taken, because that is the
 * only way the two can share a line without a separator: a foul mark is a
 * single letter from `PTUD` with at most one digit, and no Italian surname or
 * initial looks like that once the dots are kept. `played` defaults to true —
 * a row on a sheet is normally a player who took part, and `-` is the exception
 * worth marking.
 */
export function parseRoster(text: string): TranscribedPlayer[] {
  const players: TranscribedPlayer[] = [];

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") return;

    const tokens = line.split(/\s+/);
    const shirt = Number(tokens[0]);
    if (!/^\d{1,3}$/.test(tokens[0])) {
      throw new NotationError(index + 1, `"${tokens[0]}" is not a shirt number.`);
    }

    const fouls: string[] = [];
    const nameParts: string[] = [];
    let starter = false;
    let played = true;

    for (const token of tokens.slice(1)) {
      if (token === "*") starter = true;
      else if (token === "-") played = false;
      else if (FOUL.test(token)) fouls.push(token.toUpperCase());
      else nameParts.push(token);
    }

    if (nameParts.length === 0) {
      throw new NotationError(index + 1, "No surname. Write the number, then the surname.");
    }
    /*
      More than five fouls is not rejected here. `reading.ts` reports it as a
      named check with the count, which a secretary can act on; a parse error on
      a line would stop them seeing the other eleven rows.
    */
    players.push({
      shirt,
      surname: nameParts[0],
      givenName: nameParts.slice(1).join(" ") || null,
      birthYear: null,
      played,
      starter,
      fouls,
    });
  });

  return players;
}

/** `16, 20, 15, 16` — the period box, as typed. */
export function formatPeriods(periods: number[]): string {
  return periods.join(", ");
}

export function parsePeriods(text: string): number[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  return trimmed.split(/[,\s]+/).map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      throw new NotationError(1, `"${part}" is not a quarter score.`);
    }
    return Number(part);
  });
}
