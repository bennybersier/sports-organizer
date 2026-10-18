import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { MapPin, Swords, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { PageHeader } from "@/components/data/page-header";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listMatches } from "@/server/services/match-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTrainerOptions } from "@/server/services/trainer-service";
import { NewEventButton } from "@/app/(app)/calendar/new-event-button";
import { listCompetitionOptions } from "@/server/services/competition-service";
import { listTeamOptions } from "@/server/services/team-service";

import { MatchFilters } from "./match-filters";
import { ScoreBadge } from "./score-badge";

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
  searchParams: Promise<{ team?: string; competition?: string; scope?: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return <AccessDenied />;

  const t = await getTranslations("matches");
  const format = await getFormatter();
  const { team, competition, scope } = await searchParams;

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
  const [matches, teams, competitions, seasons, gyms, trainers] = await Promise.all([
    listMatches(context, { teamId: team, competitionId: competition, only }),
    hasPermission(context, "teams.read") ? listTeamOptions(context) : Promise.resolve([]),
    hasPermission(context, "competitions.read")
      ? listCompetitionOptions(context)
      : Promise.resolve([]),
    canCreate ? listSeasonOptions(context) : Promise.resolve([]),
    canCreate ? listGymOptions(context) : Promise.resolve([]),
    canCreate ? listTrainerOptions(context) : Promise.resolve([]),
  ]);

  const tabHref = (next: string) => {
    const query = new URLSearchParams({
      ...(team ? { team } : {}),
      ...(competition ? { competition } : {}),
      scope: next,
    });
    return `/matches?${query}`;
  };

  const filtered = Boolean(team || competition);
  const labels = {
    notPlayed: t("notPlayed"),
    pending: t("noResult"),
    forfeit: t("FORFEIT"),
    abandoned: t("ABANDONED"),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
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
              timeZone={context.tenant.timezone}
              defaultTeamIds={team ? [team] : undefined}
            />
          ) : null
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["played", t("scopePlayed")],
              ["pending", t("scopePending")],
              ["all", t("scopeAll")],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              asChild
              size="sm"
              variant={active === key ? "secondary" : "ghost"}
            >
              <Link href={tabHref(key)}>{label}</Link>
            </Button>
          ))}
        </div>

        <MatchFilters
          teams={teams.map((entry) => ({ id: entry.id, name: entry.name }))}
          competitions={competitions.map((entry) => ({ id: entry.id, name: entry.name }))}
          team={team ?? null}
          competition={competition ?? null}
        />
      </div>

      {matches.length === 0 ? (
        <EmptyState
          icon={filtered ? Swords : Trophy}
          title={filtered ? t("emptyFiltered") : t("emptyTitle")}
          description={filtered ? t("emptyFilteredBody") : t("emptyBody")}
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {matches.map((match) => (
            <li key={`${match.eventId}:${match.teamId}`}>
              <Link
                href={`/matches/${match.eventId}/${match.teamId}`}
                className="flex flex-wrap items-center gap-3 p-3 transition-colors hover:bg-muted/50 sm:p-4"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: match.teamColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {match.teamName}
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-normal">{t("versus", { opponent: match.opponent })}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {format.dateTime(new Date(match.startsAt), {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {match.gymName ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {match.gymName}
                      </span>
                    ) : null}
                    {match.competition ? <span>{match.competition}</span> : null}
                  </p>
                </div>
                {match.isHome !== null ? (
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {match.isHome ? t("home") : t("away")}
                  </Badge>
                ) : null}
                <ScoreBadge result={match.result} labels={labels} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
