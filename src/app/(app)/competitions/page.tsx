import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Swords } from "lucide-react";

import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { ListToolbar } from "@/components/data/list-toolbar";
import { PageHeader } from "@/components/data/page-header";
import { PaginationBar } from "@/components/data/pagination-bar";
import { StatusBadge } from "@/components/data/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAuthContext } from "@/server/auth/context";
import { hasPermission } from "@/server/auth/authorization";
import { listCompetitions } from "@/server/services/competition-service";
import { listSeasonOptions } from "@/server/services/season-service";
import { listTeamOptions } from "@/server/services/team-service";
import { parseListParams } from "@/server/services/list-query";
import { leagueShape } from "@/domain/competitions/fixtures";

import { CompetitionFormDialog } from "./competition-form-dialog";
import { CompetitionRowActions } from "./competition-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("competitions");
  return { title: t("title") };
}

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "competitions.read")) return <AccessDenied />;

  const t = await getTranslations("competitions");
  const tCommon = await getTranslations("common");
  const tList = await getTranslations("list");

  const raw = await searchParams;
  const params = parseListParams(raw);
  const seasonId = typeof raw.season === "string" ? raw.season : undefined;
  const teamId = typeof raw.team === "string" ? raw.team : undefined;
  const status = typeof raw.status === "string" ? raw.status : undefined;

  const [result, seasons, teams] = await Promise.all([
    listCompetitions(context, params, { seasonId, teamId, status }),
    hasPermission(context, "seasons.read") ? listSeasonOptions(context) : Promise.resolve([]),
    hasPermission(context, "teams.read") ? listTeamOptions(context) : Promise.resolve([]),
  ]);

  const canCreate = hasPermission(context, "competitions.create");
  const canUpdate = hasPermission(context, "competitions.update");
  const canDelete = hasPermission(context, "competitions.delete");

  const seasonOptions = seasons.map((season) => ({ value: season.id, label: season.name }));
  const teamOptions = teams.map((team) => ({ value: team.id, label: team.name }));

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          canCreate ? (
            <CompetitionFormDialog
              mode="create"
              seasons={seasonOptions}
              teams={teamOptions}
              defaultSeasonId={seasons.find((season) => season.status === "ACTIVE")?.id}
            />
          ) : null
        }
      />

      <ListToolbar
        placeholder={t("searchPlaceholder")}
        filters={[
          { name: "season", label: tCommon("season"), allLabel: tCommon("all"), options: seasonOptions },
          { name: "team", label: t("team"), allLabel: tCommon("all"), options: teamOptions },
        ]}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Swords}
          title={result.filtered ? tList("noResults") : t("emptyTitle")}
          description={result.filtered ? tList("noResultsBody") : t("emptyBody")}
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("team")}</TableHead>
                  <TableHead>{t("format")}</TableHead>
                  <TableHead className="text-right">{t("clubs")}</TableHead>
                  <TableHead className="text-right">{t("matchdays")}</TableHead>
                  <TableHead>{tCommon("status")}</TableHead>
                  <TableHead className="text-right">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((competition) => {
                  // What the club owes, from the number of clubs alone — no
                  // fixture has to exist for this to be the useful number.
                  const shape = leagueShape(competition.entry_count);
                  return (
                    <TableRow key={competition.id}>
                      <TableCell variant="primary">
                        <Link href={`/competitions/${competition.id}`} className="font-medium hover:underline">
                          {competition.name}
                        </Link>
                      </TableCell>
                      <TableCell data-label={t("team")}>{competition.team_name ?? "—"}</TableCell>
                      <TableCell data-label={t("format")}>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary">{t(competition.format)}</Badge>
                          {competition.phase !== "SINGLE" ? (
                            <Badge variant="outline">{t(competition.phase)}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell data-label={t("clubs")} className="text-right tabular-nums">
                        {competition.entry_count}
                      </TableCell>
                      <TableCell data-label={t("matchdays")} className="text-right tabular-nums">
                        {competition.format === "LEAGUE" ? shape.matchdays : "—"}
                      </TableCell>
                      <TableCell data-label={tCommon("status")}>
                        <StatusBadge status={competition.status} />
                      </TableCell>
                      <TableCell variant="actions" className="text-right">
                        <CompetitionRowActions
                          competition={{
                            id: competition.id,
                            seasonId: competition.season_id,
                            teamId: competition.team_id,
                            name: competition.name,
                            format: competition.format,
                            phase: competition.phase,
                            parentId: competition.parent_id,
                            expectedClubs: competition.expected_clubs,
                            homeBufferBeforeMinutes: competition.home_buffer_before_minutes,
                            homeBufferAfterMinutes: competition.home_buffer_after_minutes,
                            notes: competition.notes,
                            status: competition.status,
                          }}
                          seasons={seasonOptions}
                          teams={teamOptions}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
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
