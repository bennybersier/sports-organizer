import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { ListToolbar } from "@/components/data/list-toolbar";
import { PageHeader } from "@/components/data/page-header";
import { PaginationBar } from "@/components/data/pagination-bar";
import { StatusBadge } from "@/components/data/status-badge";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { parseListParams } from "@/server/services/list-query";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTeamSports, listTeams } from "@/server/services/team-service";
import { listTrainerOptions } from "@/server/services/trainer-service";
import { listGymOptions } from "@/server/services/gym-service";
import { listMatches } from "@/server/services/match-service";
import type { Outcome } from "@/domain/competitions/record";

import { TeamFormDialog } from "./team-form-dialog";
import { TeamRowActions } from "./team-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("teams");
  return { title: t("title") };
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "teams.read")) return <AccessDenied />;

  const t = await getTranslations("teams");
  const tCommon = await getTranslations("common");
  const tList = await getTranslations("list");
  const tGender = await getTranslations("gender");
  const tMatches = await getTranslations("matches");

  const raw = await searchParams;
  const params = parseListParams(raw);
  const seasonId = typeof raw.season === "string" ? raw.season : undefined;
  const sport = typeof raw.sport === "string" ? raw.sport : undefined;
  const status = typeof raw.status === "string" ? raw.status : undefined;

  const canManageTrainers = hasPermission(context, "trainers.read");

  const [result, seasons, sports, trainers, gyms, played] = await Promise.all([
    listTeams(context, params, { seasonId, sport, status }),
    listSeasonOptions(context),
    listTeamSports(context),
    canManageTrainers ? listTrainerOptions(context) : Promise.resolve([]),
    hasPermission(context, "gyms.read") ? listGymOptions(context) : Promise.resolve([]),
    // Results are their own permission; without it the cards simply carry no record.
    hasPermission(context, "attendance.read")
      ? listMatches(context, { only: "PLAYED" })
      : Promise.resolve([]),
  ]);

  /*
    Each side's record and its last five, from one query for every played
    match rather than one per card. Most recent first, as form is read.
  */
  const records = new Map<string, { won: number; lost: number; drawn: number; form: Outcome[] }>();
  for (const match of [...played].sort((a, b) => b.startsAt.localeCompare(a.startsAt))) {
    const outcome = match.result?.outcome;
    if (!outcome) continue;
    const entry = records.get(match.teamId) ?? { won: 0, lost: 0, drawn: 0, form: [] };
    if (outcome === "WIN") entry.won += 1;
    else if (outcome === "LOSS") entry.lost += 1;
    else entry.drawn += 1;
    if (entry.form.length < 5) entry.form.push(outcome);
    records.set(match.teamId, entry);
  }

  const canCreate = hasPermission(context, "teams.create");
  const canUpdate = hasPermission(context, "teams.update");
  const canDelete = hasPermission(context, "teams.delete");

  const trainerOptions = trainers.map((trainer) => ({
    value: trainer.id,
    label: `${trainer.first_name} ${trainer.last_name}`,
  }));
  const seasonOptions = seasons.map((season) => ({ value: season.id, label: season.name }));
  const gymOptions = gyms.map((gym) => ({ value: gym.id, label: gym.name }));
  const activeSeasonId = seasons.find((season) => season.status === "ACTIVE")?.id;

  // Teams belong to a season, so with none there is nothing to create against.
  if (seasons.length === 0) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t("title")} description={t("subtitle")} />
        <EmptyState
          icon={Users}
          title={t("emptyNoSeasonTitle")}
          description={t("emptyNoSeasonBody")}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        eyebrow={t("teamsCount", { count: result.total })}
        action={
          canCreate ? (
            <TeamFormDialog
              mode="create"
              seasons={seasonOptions}
              trainers={trainerOptions}
              gyms={gymOptions}
              defaultSeasonId={seasonId ?? activeSeasonId ?? seasonOptions[0]?.value}
            />
          ) : null
        }
      />

      <ListToolbar
        placeholder={t("searchPlaceholder")}
        filters={[
          {
            name: "season",
            label: tCommon("season"),
            allLabel: t("allSeasons"),
            options: seasonOptions,
          },
          ...(sports.length > 0
            ? [
                {
                  name: "sport",
                  label: tCommon("sport"),
                  allLabel: t("allSports"),
                  options: sports.map((s) => ({ value: s, label: s })),
                },
              ]
            : []),
          {
            name: "status",
            label: tCommon("status"),
            allLabel: tCommon("all"),
            options: [
              { value: "ACTIVE", label: tCommon("ACTIVE") },
              { value: "ARCHIVED", label: tCommon("ARCHIVED") },
            ],
          },
        ]}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={result.filtered ? tList("noResults") : t("emptyTitle")}
          description={result.filtered ? tList("noResultsBody") : t("emptyBody")}
          action={
            canCreate && !result.filtered ? (
              <TeamFormDialog
                mode="create"
                seasons={seasonOptions}
                trainers={trainerOptions}
                gyms={gymOptions}
                defaultSeasonId={activeSeasonId ?? seasonOptions[0]?.value}
              />
            ) : null
          }
        />
      ) : (
        <>
          {/*
            A card per side rather than a table row. What is asked of this page
            is "how is each team doing", and a card has room for the record and
            the form beside the squad's size — a row of eight columns did not.
          */}
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.rows.map((team) => {
              const record = records.get(team.id);
              const subtitle = [
                team.age_group,
                team.gender !== "UNSPECIFIED" ? tGender(team.gender) : null,
                team.sport,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={team.id}>
                  <Card className="relative h-full gap-0 border-t-0 py-0">
                    {/* The team's own colour, as the calendar shows it. */}
                    <span
                      className="absolute inset-x-0 top-0 h-1"
                      style={{ backgroundColor: team.color }}
                      aria-hidden
                    />
                    <CardContent className="flex h-full flex-col gap-4 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {team.status !== "ACTIVE" ? <StatusBadge status={team.status} /> : null}
                            <span className="label-caps text-muted-foreground">{team.season_name}</span>
                          </div>
                          <Link
                            href={`/teams/${team.id}`}
                            className="block text-lg leading-tight font-bold tracking-tight text-balance hover:underline"
                          >
                            {team.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{subtitle || "—"}</p>
                        </div>
                        <TeamRowActions
                          team={{
                            id: team.id,
                            seasonId: team.season_id,
                            name: team.name,
                            sport: team.sport,
                            category: team.category,
                            ageGroup: team.age_group,
                            gender: team.gender,
                            homeGymId: team.home_gym_id,
                            color: team.color,
                            notes: team.notes,
                            status: team.status,
                          }}
                          seasons={seasonOptions}
                          trainers={trainerOptions}
                          gyms={gymOptions}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                        />
                      </div>

                      {/* Plural on purpose: a league, the phase it came out of, a cup. */}
                      {team.competitions.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {team.competitions.map((competition) => (
                            <Link
                              key={competition.id}
                              href={`/competitions/${competition.id}`}
                              className="label-caps rounded-full border border-orange-500/40 px-2 py-0.5 text-orange-700 hover:bg-orange-500/10 dark:text-orange-400"
                            >
                              {competition.name}
                            </Link>
                          ))}
                        </div>
                      ) : null}

                      <dl className="grid grid-cols-3 gap-2">
                        <div className="space-y-1 rounded-md border bg-muted/30 p-2.5">
                          <dt className="label-caps text-muted-foreground">{t("athletes")}</dt>
                          <dd className="font-mono text-xl font-bold">{team.athlete_count}</dd>
                        </div>
                        <div className="space-y-1 rounded-md border bg-muted/30 p-2.5">
                          <dt className="label-caps text-muted-foreground">{t("trainers")}</dt>
                          <dd className="font-mono text-xl font-bold">{team.trainer_count}</dd>
                        </div>
                        <div className="space-y-1 rounded-md border bg-muted/30 p-2.5">
                          <dt className="label-caps text-muted-foreground">{tMatches("record")}</dt>
                          <dd className="font-mono text-xl font-bold">
                            {record ? (
                              <>
                                {record.won}
                                <span className="text-muted-foreground">–</span>
                                {record.lost}
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
                        <div className="flex gap-1" aria-label={tMatches("form")}>
                          {record?.form.map((outcome, index) => (
                            <span
                              key={index}
                              title={tMatches(outcome)}
                              className={
                                outcome === "WIN"
                                  ? "flex size-6 items-center justify-center rounded bg-emerald-600 font-mono text-[10px] font-bold text-white"
                                  : outcome === "LOSS"
                                    ? "flex size-6 items-center justify-center rounded bg-red-700 font-mono text-[10px] font-bold text-white"
                                    : "flex size-6 items-center justify-center rounded bg-muted font-mono text-[10px] font-bold"
                              }
                            >
                              {tMatches(outcome).charAt(0)}
                            </span>
                          ))}
                        </div>
                        <Link
                          href={`/teams/${team.id}`}
                          className="label-caps flex items-center gap-1 text-orange-600 hover:underline dark:text-orange-400"
                        >
                          {t("openTeam")}
                          <ArrowRight className="size-3" aria-hidden />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>

          <PaginationBar
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={result.pageSize}
          />
        </>
      )}
    </div>
  );
}
