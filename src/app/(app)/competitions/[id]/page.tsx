import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { StatusBadge } from "@/components/data/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAppError } from "@/lib/errors";
import { requireAuthContext } from "@/server/auth/context";
import { hasPermission } from "@/server/auth/authorization";
import {
  getCompetition,
  listEntries,
  listFixtures,
} from "@/server/services/competition-service";
import { getTeam } from "@/server/services/team-service";
import { toWallClock } from "@/domain/scheduling/timezone";
import { fromMinutes } from "@/domain/availability";

import { EntriesCard } from "./entries-card";
import { FixturesCard } from "./fixtures-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "competitions.read")) return {};
  try {
    const competition = await getCompetition(context, (await params).id);
    return { title: competition.name };
  } catch {
    return {};
  }
}

export default async function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "competitions.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("competitions");
  const format = await getFormatter();

  let competition;
  try {
    competition = await getCompetition(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [entries, fixtures, team] = await Promise.all([
    listEntries(context, id),
    listFixtures(context, id),
    getTeam(context, competition.team_id),
  ]);

  const canEdit = hasPermission(context, "competitions.update");
  const canGenerate = hasPermission(context, "competitions.create");
  const zone = context.tenant.timezone;

  return (
    <div className="flex w-full flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/competitions">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={competition.name}
        description={team.name}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(competition.format)}</Badge>
            {competition.phase !== "SINGLE" ? (
              <Badge variant="outline">{t(competition.phase)}</Badge>
            ) : null}
            <StatusBadge status={competition.status} />
          </div>
        }
      />

      <EntriesCard
        competitionId={id}
        canEdit={canEdit}
        entries={entries.map((entry) => ({
          id: entry.id,
          clubName: entry.club_name,
          town: entry.town,
          isUs: entry.team_id !== null,
        }))}
      />

      <FixturesCard
        competitionId={id}
        canEdit={canEdit}
        canGenerate={canGenerate}
        format={competition.format}
        fixtures={fixtures.map((fixture) => {
          // Split on the club's clock, not the server's, so a late kick-off
          // does not show tomorrow's date.
          const wall = fixture.starts_at ? toWallClock(fixture.starts_at, zone) : null;
          const end = fixture.ends_at ? toWallClock(fixture.ends_at, zone) : null;
          return {
            id: fixture.id,
            matchday: fixture.matchday,
            opponent: fixture.opponent?.clubName ?? null,
            isHome: fixture.isHome,
            venue: fixture.opponent?.venue ?? null,
            date: wall?.date ?? null,
            time: wall ? fromMinutes(wall.minutes) : null,
            durationMinutes: wall && end ? end.minutes - wall.minutes : 120,
          };
        })}
      />

      {competition.notes ? (
        <p className="text-muted-foreground text-sm whitespace-pre-line">{competition.notes}</p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {format.dateTime(new Date(competition.created_at), { dateStyle: "medium" })}
      </p>
    </div>
  );
}
