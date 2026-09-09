/**
 * Which sides carry a match-day cap, and which keep a scoresheet.
 *
 * Both are club policy rather than anything derivable from the schema, so they
 * live on `teams` as editable columns — but a club with thirty sides should not
 * have to set them thirty times by hand, and a seed that left them null would
 * silently disable the two features they drive.
 *
 * The rule is stated once here because both the seed and any back-fill need it
 * to agree; a second copy is how the live database and a fresh seed start
 * disagreeing about what a squad is.
 */

export interface TeamMatchSettings {
  /** Players allowed on the sheet. Null means no cap. */
  matchCallUpLimit: number | null;
  /** Whether anyone actually records per-player statistics for this side. */
  tracksBoxScore: boolean;
}

/**
 * Minibasket is the exception that shapes the rule: FIP requires every child
 * present to play a period, so a cap there would be a bug rather than a policy,
 * and nobody keeps a box score for Pulcini. Esordienti is minibasket by nature
 * whichever section runs it, which is why the name is checked and not just the
 * category.
 */
export function matchSettingsFor(team: { name: string; category: string | null }): TeamMatchSettings {
  const isMinibasket = team.category === "Minibasket" || team.name.startsWith("Esordienti");

  if (isMinibasket) return { matchCallUpLimit: null, tracksBoxScore: false };

  return {
    matchCallUpLimit: 12,
    // Worth the effort where somebody is already keeping the scoresheet: the
    // seniors, the Eccellenza sides, and the FBL squads.
    tracksBoxScore:
      team.category === "Senior" ||
      team.category === "Eccellenza ABA" ||
      team.category === "Giovanili FBL",
  };
}
