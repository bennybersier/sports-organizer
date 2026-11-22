"use server";

import { z } from "zod";

import { parseInput, runAction, type ActionResult } from "@/lib/action";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAthletes } from "@/server/services/athlete-service";
import { listCompetitions } from "@/server/services/competition-service";
import { listGyms } from "@/server/services/gym-service";
import { listMatches } from "@/server/services/match-service";
import { listTeams } from "@/server/services/team-service";
import { listTrainers } from "@/server/services/trainer-service";

export type SearchKind = "athlete" | "team" | "trainer" | "gym" | "competition" | "match";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  href: string;
  title: string;
  /** One line of context — the age group, the town, the date of a match. */
  meta: string | null;
  /** The team's colour, where the hit has one. */
  color?: string | null;
}

/** Enough to recognise the record; the full list is one click away. */
const PER_KIND = 5;

const searchSchema = z.object({ q: z.string().trim().min(2).max(120) });

/**
 * The search in the top bar: one query, every kind of record.
 *
 * Each kind goes through its own list service with the same `q` its list page
 * uses, so what the box finds and what the list finds can never disagree, and
 * each is asked only when the caller may read it — a coach without the hall
 * register gets no halls, rather than an error that sinks the whole search.
 *
 * Matches are the exception: they have no text search of their own, so a
 * season's fixtures are read and matched here on the opponent, the team and
 * the competition. A few hundred rows at most, and only when asked.
 */
export async function globalSearchAction(input: unknown): Promise<ActionResult<SearchHit[]>> {
  return runAction(async () => {
    const context = await requireAuthContext();
    const { q } = parseInput(searchSchema, input);
    const params = { q, page: 1, pageSize: PER_KIND, dir: "asc" as const };
    const can = (permission: Parameters<typeof hasPermission>[1]) =>
      hasPermission(context, permission);

    const [athletes, teams, trainers, gyms, competitions, matches] = await Promise.all([
      can("athletes.read") ? listAthletes(context, params) : null,
      can("teams.read") ? listTeams(context, params) : null,
      can("trainers.read") ? listTrainers(context, params) : null,
      can("gyms.read") ? listGyms(context, params) : null,
      can("competitions.read") ? listCompetitions(context, params) : null,
      can("attendance.read") ? listMatches(context, {}) : null,
    ]);

    const needle = q.toLowerCase();
    const hits: SearchHit[] = [];

    for (const athlete of athletes?.rows ?? []) {
      hits.push({
        kind: "athlete",
        id: athlete.id,
        href: `/athletes/${athlete.id}`,
        title: `${athlete.first_name} ${athlete.last_name}`,
        meta: athlete.email,
      });
    }
    for (const team of teams?.rows ?? []) {
      hits.push({
        kind: "team",
        id: team.id,
        href: `/teams/${team.id}`,
        title: team.name,
        meta: [team.age_group, team.sport, team.season_name].filter(Boolean).join(" · "),
        color: team.color,
      });
    }
    for (const trainer of trainers?.rows ?? []) {
      hits.push({
        kind: "trainer",
        id: trainer.id,
        href: `/trainers/${trainer.id}`,
        title: `${trainer.first_name} ${trainer.last_name}`,
        meta: trainer.email,
        color: trainer.color,
      });
    }
    for (const gym of gyms?.rows ?? []) {
      hits.push({
        kind: "gym",
        id: gym.id,
        href: `/gyms/${gym.id}`,
        title: gym.name,
        meta: gym.city,
      });
    }
    for (const competition of competitions?.rows ?? []) {
      hits.push({
        kind: "competition",
        id: competition.id,
        href: `/competitions/${competition.id}`,
        title: competition.name,
        meta: competition.team_name,
      });
    }

    const found = (matches ?? [])
      .filter((match) =>
        [match.opponent, match.teamName, match.competition ?? ""].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      )
      // Nearest first, either side of today: the match being looked for is
      // usually last weekend's or next weekend's.
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.startsAt) - Date.now()) -
          Math.abs(Date.parse(b.startsAt) - Date.now()),
      )
      .slice(0, PER_KIND);
    for (const match of found) {
      const score =
        match.result?.ourScore != null && match.result.theirScore != null
          ? ` · ${match.result.ourScore}–${match.result.theirScore}`
          : "";
      hits.push({
        kind: "match",
        id: `${match.eventId}:${match.teamId}`,
        href: `/matches/${match.eventId}/${match.teamId}`,
        title: `${match.teamName} – ${match.opponent}`,
        meta: `${match.startsAt.slice(0, 10)}${score}`,
        color: match.teamColor,
      });
    }

    return hits;
  });
}
