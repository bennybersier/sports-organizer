"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarDays, ChevronRight, MapPin, Swords } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PublicMatch } from "@/server/services/public-team-service";

type Scope = "UPCOMING" | "PLAYED";

/**
 * The team's matches on the parents' page, in the app's own design: the next
 * fixture lifted out on a phone, a card per match below it, a table from `sm`
 * up. Two tabs rather than the app's three — a parent is asking either "when
 * is the next one?" or "how did it go?", never for both lists at once.
 */
export function PublicMatchList({
  token,
  upcoming,
  played,
  timeZone,
}: {
  token: string;
  /** Soonest first. */
  upcoming: PublicMatch[];
  /** Most recent first. */
  played: PublicMatch[];
  timeZone: string;
}) {
  const t = useTranslations("matches");
  const tTeams = useTranslations("teams");
  const tPublic = useTranslations("publicTeam");
  const format = useFormatter();
  const [scope, setScope] = useState<Scope>(upcoming.length > 0 ? "UPCOMING" : "PLAYED");

  const next = upcoming[0] ?? null;
  const shown = scope === "UPCOMING" ? upcoming : played;

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: "2-digit", month: "short", year: "2-digit", timeZone });
  const weekday = (iso: string) =>
    format.dateTime(new Date(iso), { weekday: "short", day: "numeric", month: "short", timeZone });
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone });
  const href = (match: PublicMatch) => `/public/teams/${token}/matches/${match.eventId}`;

  const scopes: { value: Scope; label: string }[] = [
    { value: "UPCOMING", label: tTeams("upcomingMatches", { count: upcoming.length }) },
    { value: "PLAYED", label: tTeams("playedMatches", { count: played.length }) },
  ];

  /** Won, Lost, Next match or Not played — the last column's chip. */
  function status(match: PublicMatch) {
    const result = match.result;
    if (result && result.state !== "PENDING" && result.state !== "PLAYED") {
      return { label: t(result.state), tone: "muted" as const };
    }
    const outcome = result?.outcome;
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

  /** Ours first, as in the app. Before the game, the time takes its place. */
  function score(match: PublicMatch, className?: string) {
    const result = match.result;
    if (result?.ourScore == null || result.theirScore == null) {
      return (
        <span className={cn("font-mono text-muted-foreground", className)}>
          {time(match.startsAt)}
        </span>
      );
    }
    return (
      <span className={cn("font-mono font-semibold", className)}>
        <span className={cn(result.outcome === "WIN" && "text-emerald-600 dark:text-emerald-400")}>
          {result.ourScore}
        </span>
        <span className="text-muted-foreground"> – </span>
        {result.theirScore}
      </span>
    );
  }

  const homeAway = (match: PublicMatch) =>
    match.isHome === null ? null : match.isHome ? t("home") : t("away");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Swords className="size-4 text-orange-500" aria-hidden />
          {tPublic("matches")}
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
        {next && scope === "UPCOMING" ? (
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
                {[next.venue?.name, homeAway(next)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="shrink-0 rounded-md bg-muted px-3 py-2 text-center">
              <p className="label-caps text-orange-600 dark:text-orange-400">
                {weekday(next.startsAt)}
              </p>
              <p className="font-mono text-lg font-bold">{time(next.startsAt)}</p>
            </div>
          </Link>
        ) : null}

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {scope === "UPCOMING" ? tPublic("noUpcoming") : t("recordEmpty")}
          </p>
        ) : null}

        {/* Phone: a card per match. */}
        <ul className="space-y-2 sm:hidden">
          {shown
            .filter((match) => !(match === next && scope === "UPCOMING"))
            .map((match) => {
              const state = status(match);
              return (
                <li key={match.eventId}>
                  <Link
                    href={href(match)}
                    className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        {day(match.startsAt)}
                        {homeAway(match) ? (
                          <span className="label-caps rounded bg-muted px-1.5 py-0.5">
                            {homeAway(match)}
                          </span>
                        ) : null}
                      </p>
                      <p className="font-semibold text-balance">{match.opponent}</p>
                      {match.competition ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {match.competition}
                        </p>
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
        {shown.length > 0 ? (
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
                  <th className="w-8" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((match) => {
                  const state = status(match);
                  return (
                    // The whole row opens the match, through the link's ::after.
                    <tr
                      key={match.eventId}
                      className="group relative cursor-pointer hover:bg-muted/40 has-[a:focus-visible]:bg-muted/40 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-orange-500"
                    >
                      <td
                        className={cn(
                          "px-3 py-2.5 font-mono whitespace-nowrap",
                          scope === "UPCOMING" && "text-orange-600 dark:text-orange-400",
                        )}
                      >
                        {day(match.startsAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={href(match)}
                          className="font-medium after:absolute after:inset-0 after:content-[''] group-hover:underline focus-visible:outline-none"
                        >
                          {match.opponent}
                        </Link>
                        {match.venue ? (
                          <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            {match.venue.name}
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
                      <td
                        className="pe-2 text-muted-foreground group-hover:text-orange-500"
                        aria-hidden
                      >
                        <ChevronRight className="size-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
