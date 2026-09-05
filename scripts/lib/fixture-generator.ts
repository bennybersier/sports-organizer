/**
 * A season's fixtures, invented but plausible.
 *
 * The club has no fixture list to import yet, and a simulation without one is
 * missing the thing that actually shapes a week: a senior home game takes the
 * main hall for an entire evening, and a team that plays on Wednesday does not
 * train on Wednesday. Generating them is the only way to see what the optimizer
 * does under that pressure.
 *
 * Everything here is deterministic — the same club produces the same season
 * every run — so two generation runs can be compared without the fixtures
 * having moved underneath them.
 */

import { addDays, isoWeekdayOfDate, toInstant } from "../../src/domain/scheduling/timezone";

export interface FixturePool {
  /** Shown on the fixture, and what the club calls the competition. */
  competition: string;
  /**
   * Match days, in preference order.
   *
   * A single weekday for most pools. The U19s rotate across Tuesday, Wednesday
   * and Thursday, which is the whole reason the per-date blocking exists:
   * closing all three to training permanently would cap them at two sessions.
   */
  weekdays: number[];
  /** Tip-off, minutes from midnight, per successive fixture on the same day. */
  tipOffs: number[];
  durationMinutes: number;
  /** Fixtures per team. A first team plays a season; minibasket plays a few. */
  rounds: number;
  /** How long the hall is held either side of a home fixture. */
  bufferBefore: number;
  bufferAfter: number;
  opponents: { club: string; town: string }[];
}

export interface FixtureTeam {
  id: string;
  name: string;
  pool: string;
  /** Where a home fixture is played. Null means the team is always away. */
  homeGymId: string | null;
  /** No fixtures before the team has started training. */
  startsOn: string;
}

export interface PlannedFixture {
  teamId: string;
  title: string;
  opponent: string;
  isHome: boolean;
  competition: string;
  gymId: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** Dates a club does not play. Christmas, and the first week of the new year. */
function isBreak(date: string): boolean {
  const [, month, day] = date.split("-").map(Number);
  return (month === 12 && day >= 20) || (month === 1 && day <= 6);
}

/** The first `weekday` on or after `from`. */
function nextWeekday(from: string, weekday: number): string {
  let date = from;
  for (let i = 0; i < 7; i += 1) {
    if (isoWeekdayOfDate(date) === weekday) return date;
    date = addDays(date, 1);
  }
  return from;
}

/**
 * One season of fixtures for every team given.
 *
 * Home and away strictly alternate, so roughly half a pool is at home each
 * week and the halls are contended rather than idle. Opponents cycle through
 * the pool's list, which gives a double round-robin over a long season without
 * needing a real draw.
 */
export function planFixtures(args: {
  teams: FixtureTeam[];
  pools: Record<string, FixturePool>;
  seasonStart: string;
  seasonEnd: string;
  timeZone: string;
}): PlannedFixture[] {
  const fixtures: PlannedFixture[] = [];

  /*
    Two home fixtures cannot share a hall at one time. calendar_events carries
    no exclusion constraint — deliberately, since away fixtures have no gym and
    a shared in-house tournament is legitimate — so nothing downstream would
    reject this. It would simply look wrong on the calendar, which is worse.
  */
  const taken = new Set<string>();

  for (const [index, team] of args.teams.entries()) {
    const pool = args.pools[team.pool];
    if (!pool) continue;

    // Staggered so a pool's teams are not all at home in the same week.
    let home = index % 2 === 0;
    let played = 0;
    // Fixtures start a fortnight after the team does — nobody plays in the
    // first week of pre-season.
    let cursor = addDays(team.startsOn, 14);

    while (played < pool.rounds && cursor <= args.seasonEnd) {
      const weekday = pool.weekdays[played % pool.weekdays.length];
      const date = nextWeekday(cursor, weekday);
      cursor = addDays(date, 7);

      if (date > args.seasonEnd || isBreak(date)) continue;

      const opponent = pool.opponents[played % pool.opponents.length];
      const playingHome = home && team.homeGymId !== null;
      home = !home;

      // Successive fixtures in one hall on one day are stacked, not overlapped.
      let tipOff = pool.tipOffs[0];
      if (playingHome) {
        const slot = pool.tipOffs.find(
          (minutes) => !taken.has(`${team.homeGymId}|${date}|${minutes}`),
        );
        if (slot === undefined) continue;
        tipOff = slot;
        taken.add(`${team.homeGymId}|${date}|${slot}`);
      }

      fixtures.push({
        teamId: team.id,
        title: playingHome ? `${team.name} v ${opponent.club}` : `${opponent.club} v ${team.name}`,
        opponent: opponent.club,
        isHome: playingHome,
        competition: pool.competition,
        gymId: playingHome ? team.homeGymId : null,
        // An away fixture holds none of our halls, but still blocks the team.
        location: playingHome ? null : `Palazzetto ${opponent.town}`,
        startAt: toInstant(date, tipOff, args.timeZone).toISOString(),
        endAt: toInstant(date, tipOff + pool.durationMinutes, args.timeZone).toISOString(),
        bufferBeforeMinutes: playingHome ? pool.bufferBefore : 0,
        bufferAfterMinutes: playingHome ? pool.bufferAfter : 0,
      });

      played += 1;
    }
  }

  return fixtures;
}
