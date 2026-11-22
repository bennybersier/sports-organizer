import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronRight, MapPin, Swords, Trophy } from "lucide-react";

import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { ListToolbar } from "@/components/data/list-toolbar";
import { PageHeader } from "@/components/data/page-header";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listMatches, type MatchListItem } from "@/server/services/match-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTrainerOptions } from "@/server/services/trainer-service";
import { NewEventButton } from "@/app/(app)/calendar/new-event-button";
import { listCompetitionOptions } from "@/server/services/competition-service";
import { listTeamOptions } from "@/server/services/team-service";

export const metadata: Metadata = { title: "Matches" };

/**
 * Every match of ours, newest first.
 *
 * Deliberately separate from Competitions, which answers "what do we owe this
 * season". This page answers "what happened", and the two are read by different
 * people at different times — a secretary planning in September, a coach or a
 * parent on Sunday evening.
 *
 * The scope tab defaults to results rather than to everything: somebody opening
 * this page has almost always just come from a match.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; competition?: string; scope?: string; q?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return <AccessDenied />;

  const t = await getTranslations("matches");
  const tTeams = await getTranslations("teams");
  const format = await getFormatter();
  const { team, competition, scope, q } = await searchParams;

  const only =
    scope === "pending" ? ("PENDING" as const) : scope === "all" ? undefined : ("PLAYED" as const);
  const active = scope === "pending" ? "pending" : scope === "all" ? "all" : "played";

  /*
    Both pickers are gated on their own permission rather than on this page's.
    A coach may read attendance without reading the club's team list, and a
    service that asserts a permission the caller lacks throws — so an ungated
    call here would turn a missing filter into a 500.
  */
  const canCreate = hasPermission(context, "calendar.create");
  const [listed, teams, competitions, seasons, gyms, trainers] = await Promise.all([
    listMatches(context, { teamId: team, competitionId: competition, only }),
    hasPermission(context, "teams.read") ? listTeamOptions(context) : Promise.resolve([]),
    hasPermission(context, "competitions.read")
      ? listCompetitionOptions(context)
      : Promise.resolve([]),
    canCreate ? listSeasonOptions(context) : Promise.resolve([]),
    canCreate ? listGymOptions(context) : Promise.resolve([]),
    canCreate ? listTrainerOptions(context) : Promise.resolve([]),
  ]);

  /*
    The search box. Typed words match our team's name, the opponent or the
    competition, so "under 13" finds every under-13 side's games at once —
    which the team picker, one side at a time, cannot. Filtered here rather
    than in the query: a season's matches are a few hundred rows at most, and
    they are already loaded for the page.
  */
  const needle = q?.trim().toLowerCase() ?? "";
  const matches = needle
    ? listed.filter((match) =>
        [match.teamName, match.opponent, match.competition ?? ""].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      )
    : listed;

  const tabHref = (next: string) => {
    const query = new URLSearchParams({
      ...(team ? { team } : {}),
      ...(competition ? { competition } : {}),
      ...(q ? { q } : {}),
      scope: next,
    });
    return `/matches?${query}`;
  };

  const filtered = Boolean(team || competition || needle);
  const timeZone = context.tenant.timezone;
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: "2-digit", month: "short", year: "2-digit", timeZone });
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone });
  const href = (match: MatchListItem) => `/matches/${match.eventId}/${match.teamId}`;

  // The next fixture, whatever the scope, when the list holds one.
  const now = new Date().toISOString();
  const next =
    active !== "played"
      ? ([...matches]
          .filter((match) => (!match.result || match.result.state === "PENDING") && match.startsAt >= now)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null)
      : null;

  /** Won, Lost, Drew, Forfeit… or not played yet — the last column's chip. */
  function status(match: MatchListItem) {
    const result = match.result;
    if (!result || result.state === "PENDING") {
      return { label: match === next ? tTeams("nextMatch") : t("notPlayedYet"), tone: "muted" as const };
    }
    if (result.state === "FORFEIT" || result.state === "ABANDONED") {
      return { label: t(result.state), tone: "muted" as const };
    }
    if (result.outcome === "WIN") return { label: t("WIN"), tone: "win" as const };
    if (result.outcome === "LOSS") return { label: t("LOSS"), tone: "loss" as const };
    return { label: t("DRAW"), tone: "muted" as const };
  }
  const chip = (tone: "win" | "loss" | "muted") =>
    cn(
      "label-caps inline-block rounded px-2 py-1",
      tone === "win" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      tone === "loss" && "bg-destructive/15 text-destructive",
      tone === "muted" && "bg-muted text-muted-foreground",
    );
  /*
    Our score first always, rather than home first. A club reading its own list
    wants to know whether it won, and making that depend on remembering which
    side of the fixture it was turns a glance into arithmetic.
  */
  function score(match: MatchListItem, className?: string) {
    const result = match.result;
    if (result?.ourScore == null || result.theirScore == null) {
      return <span className={cn("font-mono text-muted-foreground", className)}>{time(match.startsAt)}</span>;
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
  const teamDot = (match: MatchListItem) => (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: match.teamColor }}
      aria-hidden
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        eyebrow={t("matchesCount", { count: matches.length })}
        action={
          canCreate ? (
            /*
              The calendar's own dialog. A match is a calendar event, so a
              separate form for one would be a second set of rules about what a
              fixture may hold, and the two would drift apart.
            */
            <NewEventButton
              seasons={seasons.map((season) => ({ value: season.id, label: season.name }))}
              gyms={gyms.map((gym) => ({ value: gym.id, label: gym.name }))}
              trainers={trainers.map((trainer) => ({
                value: trainer.id,
                label: `${trainer.first_name} ${trainer.last_name}`,
              }))}
              teams={teams.map((entry) => ({ value: entry.id, label: entry.name }))}
              timeZone={timeZone}
              defaultTeamIds={team ? [team] : undefined}
            />
          ) : null
        }
      />

      <div className="space-y-3">
        <div className="inline-flex rounded-md border bg-card p-0.5">
          {(
            [
              ["played", t("scopePlayed")],
              ["pending", t("scopePending")],
              ["all", t("scopeAll")],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={active === key ? "page" : undefined}
              className={cn(
                "label-caps rounded px-3 py-2 text-muted-foreground hover:text-foreground",
                active === key && "bg-orange-500 text-[#0b0f17] hover:text-[#0b0f17]",
              )}
            >
              {label}
            </Link>
          ))}
        </div>

        <ListToolbar
          placeholder={t("searchPlaceholder")}
          filters={[
            ...(teams.length > 0
              ? [
                  {
                    name: "team",
                    label: t("team"),
                    allLabel: t("allTeams"),
                    options: teams.map((entry) => ({ value: entry.id, label: entry.name })),
                  },
                ]
              : []),
            ...(competitions.length > 0
              ? [
                  {
                    name: "competition",
                    label: t("competition"),
                    allLabel: t("allCompetitions"),
                    options: competitions.map((entry) => ({ value: entry.id, label: entry.name })),
                  },
                ]
              : []),
          ]}
        />
      </div>

      {next ? (
        <Link
          href={href(next)}
          className="flex flex-wrap items-center gap-4 rounded-xl border bg-linear-to-r from-orange-500/10 via-card to-card p-4 hover:border-orange-500/50"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="label-caps flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
              <CalendarDays className="size-3.5" aria-hidden />
              {tTeams("nextMatch")}
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {teamDot(next)}
              {next.teamName}
            </p>
            <p className="text-xl leading-tight font-bold">{t("versus", { opponent: next.opponent })}</p>
            {next.gymName || next.isHome !== null ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden />
                {[next.gymName, next.isHome === null ? null : next.isHome ? t("home") : t("away")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 rounded-md bg-muted px-4 py-2 text-center">
            <p className="label-caps text-orange-600 dark:text-orange-400">{day(next.startsAt)}</p>
            <p className="font-mono text-2xl font-bold">{time(next.startsAt)}</p>
          </div>
        </Link>
      ) : null}

      {matches.length === 0 ? (
        <EmptyState
          icon={filtered ? Swords : Trophy}
          title={filtered ? t("emptyFiltered") : t("emptyTitle")}
          description={filtered ? t("emptyFilteredBody") : t("emptyBody")}
        />
      ) : (
        <>
          {/* Phone: a card per match. */}
          <ul className="space-y-2 sm:hidden">
            {matches.map((match) => {
              const state = status(match);
              return (
                <li key={`${match.eventId}:${match.teamId}`}>
                  <Link
                    href={href(match)}
                    className="flex items-center gap-3 rounded-lg border bg-card p-3"
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
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {teamDot(match)}
                        <span className="truncate">{match.teamName}</span>
                      </p>
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

          {/*
            Wider: a table, not a stack of rows. The questions asked of this
            page are comparative — which of these has a result, which
            competition is this one, when is the next away game — and
            comparison wants columns.
          */}
          <div className="hidden overflow-x-auto rounded-xl border bg-card sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="label-caps bg-muted/50 text-left text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">{t("date")}</th>
                  <th className="px-4 py-3 font-semibold">{t("team")}</th>
                  <th className="px-4 py-3 font-semibold">{tTeams("opponentAndVenue")}</th>
                  <th className="hidden px-4 py-3 font-semibold xl:table-cell">
                    {t("competitionColumn")}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold">{t("venue")}</th>
                  <th className="px-4 py-3 text-end font-semibold">{tTeams("resultOrTime")}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t("state")}</th>
                  <th className="w-8" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y">
                {matches.map((match) => {
                  const state = status(match);
                  const upcoming = !match.result || match.result.state === "PENDING";
                  return (
                    /*
                      The whole row opens the match. The opponent's name is the
                      real link, stretched over the row by its ::after, so the
                      row reads as one target while a screen reader still finds
                      a single named link rather than seven.
                    */
                    <tr
                      key={`${match.eventId}:${match.teamId}`}
                      className="group relative cursor-pointer hover:bg-muted/40 has-[a:focus-visible]:bg-muted/40 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-orange-500"
                    >
                      <td
                        className={cn(
                          "px-4 py-3 font-mono whitespace-nowrap",
                          upcoming && "text-orange-600 dark:text-orange-400",
                        )}
                      >
                        {day(match.startsAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex min-w-0 items-center gap-2">
                          {teamDot(match)}
                          <span className="truncate">{match.teamName}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={href(match)}
                          className="font-medium after:absolute after:inset-0 after:content-[''] group-hover:underline focus-visible:outline-none"
                        >
                          {match.opponent}
                        </Link>
                        {match.gymName ? (
                          <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            {match.gymName}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">
                        {match.competition ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-muted-foreground">
                        {match.isHome === null ? "—" : match.isHome ? t("homeShort") : t("awayShort")}
                      </td>
                      <td className="px-4 py-3 text-end whitespace-nowrap">{score(match)}</td>
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <span className={chip(state.tone)}>{state.label}</span>
                      </td>
                      <td className="pe-3 text-muted-foreground group-hover:text-orange-500" aria-hidden>
                        <ChevronRight className="size-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
