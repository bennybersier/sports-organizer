import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const raw = await searchParams;
  const params = parseListParams(raw);
  const seasonId = typeof raw.season === "string" ? raw.season : undefined;
  const sport = typeof raw.sport === "string" ? raw.sport : undefined;
  const status = typeof raw.status === "string" ? raw.status : undefined;

  const canManageTrainers = hasPermission(context, "trainers.read");

  const [result, seasons, sports, trainers] = await Promise.all([
    listTeams(context, params, { seasonId, sport, status }),
    listSeasonOptions(context),
    listTeamSports(context),
    canManageTrainers ? listTrainerOptions(context) : Promise.resolve([]),
  ]);

  const canCreate = hasPermission(context, "teams.create");
  const canUpdate = hasPermission(context, "teams.update");
  const canDelete = hasPermission(context, "teams.delete");

  const trainerOptions = trainers.map((trainer) => ({
    value: trainer.id,
    label: `${trainer.first_name} ${trainer.last_name}`,
  }));
  const seasonOptions = seasons.map((season) => ({ value: season.id, label: season.name }));
  const activeSeasonId = seasons.find((season) => season.status === "ACTIVE")?.id;

  // Teams belong to a season, so with none there is nothing to create against.
  if (seasons.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          canCreate ? (
            <TeamFormDialog
              mode="create"
              seasons={seasonOptions}
              trainers={trainerOptions}
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
                defaultSeasonId={activeSeasonId ?? seasonOptions[0]?.value}
              />
            ) : null
          }
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tCommon("name")}</TableHead>
                  <TableHead>{tCommon("sport")}</TableHead>
                  <TableHead>{tCommon("season")}</TableHead>
                  <TableHead className="text-right">{t("athletes")}</TableHead>
                  <TableHead className="text-right">{t("trainers")}</TableHead>
                  <TableHead>{tCommon("status")}</TableHead>
                  <TableHead className="sr-only">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((team) => (
                  <TableRow key={team.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: team.color }}
                          aria-hidden
                        />
                        <Link href={`/teams/${team.id}`} className="font-medium hover:underline">
                          {team.name}
                        </Link>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[team.age_group, team.gender !== "UNSPECIFIED" ? tGender(team.gender) : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{team.sport}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {team.season_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{team.athlete_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{team.trainer_count}</TableCell>
                    <TableCell>
                      <StatusBadge status={team.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <TeamRowActions
                        team={{
                          id: team.id,
                          seasonId: team.season_id,
                          name: team.name,
                          sport: team.sport,
                          category: team.category,
                          ageGroup: team.age_group,
                          gender: team.gender,
                          color: team.color,
                          notes: team.notes,
                          status: team.status,
                        }}
                        seasons={seasonOptions}
                        trainers={trainerOptions}
                        canUpdate={canUpdate}
                        canDelete={canDelete}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

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
