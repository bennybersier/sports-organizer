import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Trophy } from "lucide-react";

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
import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { ListToolbar } from "@/components/data/list-toolbar";
import { PageHeader } from "@/components/data/page-header";
import { PaginationBar } from "@/components/data/pagination-bar";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listSeasons } from "@/server/services/season-service";
import { parseListParams } from "@/server/services/list-query";

import { SeasonFormDialog } from "./season-form-dialog";
import { SeasonRowActions } from "./season-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seasons");
  return { title: t("title") };
}

export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "seasons.read")) return <AccessDenied />;

  const t = await getTranslations("seasons");
  const tCommon = await getTranslations("common");
  const format = await getFormatter();

  const raw = await searchParams;
  const params = parseListParams(raw);
  const status = typeof raw.status === "string" ? raw.status : undefined;

  const result = await listSeasons(context, params, { status });
  const canCreate = hasPermission(context, "seasons.create");

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={canCreate ? <SeasonFormDialog mode="create" /> : null}
      />

      <ListToolbar
        placeholder={t("searchPlaceholder")}
        filters={[
          {
            name: "status",
            label: t("status"),
            allLabel: tCommon("all"),
            options: [
              { value: "DRAFT", label: t("DRAFT") },
              { value: "ACTIVE", label: t("ACTIVE") },
              { value: "ARCHIVED", label: t("ARCHIVED") },
            ],
          },
        ]}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={result.filtered ? t("emptyTitle") : t("emptyTitle")}
          description={result.filtered ? t("emptyBody") : t("emptyBody")}
          action={canCreate && !result.filtered ? <SeasonFormDialog mode="create" /> : null}
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tCommon("name")}</TableHead>
                  <TableHead>{t("dates")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{t("teams")}</TableHead>
                  <TableHead className="sr-only">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((season) => (
                  <TableRow key={season.id}>
                    <TableCell variant="primary">
                      <div className="font-medium">{season.name}</div>
                      {season.description ? (
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          {season.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell data-label={t("dates")} className="text-sm text-muted-foreground">
                      {format.dateTime(new Date(season.start_date), { dateStyle: "medium" })}
                      {" – "}
                      {format.dateTime(new Date(season.end_date), { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell data-label={t("status")}>
                      <Badge
                        variant={season.status === "ACTIVE" ? "default" : "secondary"}
                      >
                        {t(season.status)}
                      </Badge>
                    </TableCell>
                    <TableCell data-label={t("teams")} className="text-right tabular-nums">{season.team_count}</TableCell>
                    <TableCell variant="actions" className="text-right">
                      <SeasonRowActions
                        season={{
                          id: season.id,
                          name: season.name,
                          startDate: season.start_date,
                          endDate: season.end_date,
                          description: season.description,
                          status: season.status,
                        }}
                        canUpdate={hasPermission(context, "seasons.update")}
                        canArchive={hasPermission(context, "seasons.archive")}
                        canCreate={canCreate}
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
