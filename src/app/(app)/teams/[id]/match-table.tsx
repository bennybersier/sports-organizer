"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarDays, MapPin, Swords } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MatchListItem } from "@/server/services/match-service";

type Scope = "ALL" | "PLAYED" | "UPCOMING";

/**
 * A team's whole season of matches, played and still to come.
 *
 * It replaced a card that said "18" and listed eight of them. Truncating a
 * list whose own heading states its length is the worst of both: the number
 * tells you something is missing without saying what, and there was nowhere
 * to go and see the rest. So every match is here, in date order, and the
 * filter narrows it rather than the page deciding what to leave out.
 *
 * A table on a wide screen; on a phone the next fixture is lifted out on its
 * own — it is the one thing a parent opens a team's page to find — and every
 * match below it is a card.
 */
export function TeamMatchTable({
  matches,
  timeZone,
}: {
  matches: MatchListItem[];
  timeZone: string;
}) {
  const t = useTranslations("matches");
  const tTeams = useTranslations("teams");
  const format = useFormatter();
  const [scope, setScope] = useState<Scope>("ALL");

  if (matches.length === 0) return null;

  // Oldest first: a fixture list is read forwards, unlike a player's form.
  const ordered = [...matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const isPlayed = (match: MatchListItem) =>
    match.result !== null && match.result.state !== "PENDING";
  const played = ordered.filter(isPlayed);
  const upcoming = ordered.filter((match) => !isPlayed(match));
  // The next fixture: the first unplayed one that has not started yet.
  const now = new Date().toISOString();
  const next = upcoming.find((match) => match.startsAt >= now) ?? null;
  const shown = scope === "ALL" ? ordered : scope === "PLAYED" ? played : upcoming;

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: "2-digit", month: "short", year: "2-digit", timeZone });
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone });
  const href = (match: MatchListItem) => `/matches/${match.eventId}/${match.teamId}`;

  const scopes: { value: Scope; label: string }[] = [
    { value: "ALL", label: tTeams("allMatches", { count: ordered.length }) },
    { value: "PLAYED", label: tTeams("playedMatches", { count: played.length }) },
    { value: "UPCOMING", label: tTeams("upcomingMatches", { count: upcoming.length }) },
  ];

  /** Won, Lost, Next match or Not played — the last column's chip. */
  function status(match: MatchListItem) {
    const outcome = match.result?.outcome;
    if (outcome === "WIN") return { label: t("WIN"), tone: "win" as const };
    if (outcome === "LOSS") return { label: t("LOSS"), tone: "loss" as const };
    if (outcome === "DRAW") return { label: t("DRAW"), tone: "muted" as const };
    if (match === next) return { label: tTeams("nextMatch"), tone: "muted" as const };
    return { label: t("notPlayedYet"), tone: "muted" as const };
  }

  const chip = (tone: "win" | "loss" | "muted") =>
    cn(
      "label-caps inline-block rounded px-2 py-1",
      tone === "win" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      tone === "loss" && "bg-destructive/15 text-destructive",
      tone === "muted" && "bg-muted text-muted-foreground",
    );

  /** Ours first: this is the club's own list, read for whether it won. */
  function score(match: MatchListItem, className?: string) {
    const result = match.result;
    if (result?.ourScore == null || result.theirScore == null) {
      return <span className={cn("font-mono text-muted-foreground", className)}>{time(match.startsAt)}</span>;
    }
    return (
      <span className={cn("font-mono font-semibold", className)}>
        <span
          className={cn(
            result.outcome === "WIN" && "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {result.ourScore}
        </span>
        <span className="text-muted-foreground"> – </span>
        {result.theirScore}
      </span>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Swords className="size-4 text-orange-500" aria-hidden />
          {tTeams("scheduleTitle")}
          <span className="label-caps rounded-full bg-muted px-2 py-1 text-muted-foreground">
            {tTeams("matchesFinished", { total: ordered.length, played: played.length })}
          </span>
        </CardTitle>
        <div className="inline-flex rounded-md border p-0.5" role="group">
          {scopes.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={scope === entry.value}
              onClick={() => setScope(entry.value)}
              className={cn(
                "label-caps rounded px-2.5 py-1.5 text-muted-foreground",
                scope === entry.value && "bg-orange-500 text-[#0b0f17]",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The next fixture, lifted out on a phone. */}
        {next && scope !== "PLAYED" ? (
          <Link
            href={href(next)}
            className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 sm:hidden"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="label-caps flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                <CalendarDays className="size-3.5" aria-hidden />
                {tTeams("nextMatch")}
              </p>
              <p className="text-lg leading-tight font-bold">
                {t("versus", { opponent: next.opponent })}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden />
                {[next.gymName, next.isHome === null ? null : next.isHome ? t("home") : t("away")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="shrink-0 rounded-md bg-muted px-3 py-2 text-center">
              <p className="label-caps text-orange-600 dark:text-orange-400">{day(next.startsAt)}</p>
              <p className="font-mono text-lg font-bold">{time(next.startsAt)}</p>
            </div>
          </Link>
        ) : null}

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tTeams("noMatchesInScope")}</p>
        ) : null}

        {/* Phone: a card per match. */}
        <ul className="space-y-2 sm:hidden">
          {shown
            .filter((match) => !(match === next && scope !== "PLAYED"))
            .map((match) => {
              const state = status(match);
              return (
                <li key={`${match.eventId}:${match.teamId}`}>
                  <Link
                    href={href(match)}
                    className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        {day(match.startsAt)}
                        {match.isHome !== null ? (
                          <span className="label-caps rounded bg-muted px-1.5 py-0.5">
                            {match.isHome ? t("home") : t("away")}
                          </span>
                        ) : null}
                      </p>
                      <p className="font-semibold text-balance">{match.opponent}</p>
                      {match.competition ? (
                        <p className="truncate text-xs text-muted-foreground">{match.competition}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 space-y-1 text-end">
                      {score(match, "block text-xl")}
                      <span className={chip(state.tone)}>{state.label}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
        </ul>

        {/* Wider: one table, every column aligned. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="label-caps bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2.5 font-semibold">{t("date")}</th>
                <th className="px-3 py-2.5 font-semibold">{tTeams("opponentAndVenue")}</th>
                <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">
                  {t("competitionColumn")}
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">{t("venue")}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{tTeams("resultOrTime")}</th>
                <th className="px-3 py-2.5 text-end font-semibold">{t("state")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((match) => {
                const state = status(match);
                const upcomingRow = !isPlayed(match);
                return (
                  <tr key={`${match.eventId}:${match.teamId}`} className="hover:bg-muted/30">
                    <td
                      className={cn(
                        "px-3 py-2.5 font-mono whitespace-nowrap",
                        upcomingRow && "text-orange-600 dark:text-orange-400",
                      )}
                    >
                      {day(match.startsAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={href(match)} className="font-medium hover:underline">
                        {match.opponent}
                      </Link>
                      {match.gymName ? (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          {match.gymName}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">
                      {match.competition ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-muted-foreground">
                      {match.isHome === null ? "—" : match.isHome ? t("homeShort") : t("awayShort")}
                    </td>
                    <td className="px-3 py-2.5 text-end whitespace-nowrap">{score(match)}</td>
                    <td className="px-3 py-2.5 text-end whitespace-nowrap">
                      <span className={chip(state.tone)}>{state.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
