import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { UserCog } from "lucide-react";

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
import { StatusBadge } from "@/components/data/status-badge";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { parseListParams } from "@/server/services/list-query";
import { listTrainers } from "@/server/services/trainer-service";

import { TrainerFormDialog } from "./trainer-form-dialog";
import { TrainerRowActions } from "./trainer-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trainers");
  return { title: t("title") };
}

export default async function TrainersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "trainers.read")) return <AccessDenied />;

  const t = await getTranslations("trainers");
  const tCommon = await getTranslations("common");
  const tList = await getTranslations("list");

  const raw = await searchParams;
  const params = parseListParams(raw);
  const status = typeof raw.status === "string" ? raw.status : undefined;

  const result = await listTrainers(context, params, { status });
  const canCreate = hasPermission(context, "trainers.create");
  const canUpdate = hasPermission(context, "trainers.update");
  const canDelete = hasPermission(context, "trainers.delete");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={canCreate ? <TrainerFormDialog mode="create" /> : null}
      />

      <ListToolbar
        placeholder={t("searchPlaceholder")}
        filters={[
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
          icon={UserCog}
          title={result.filtered ? tList("noResults") : t("emptyTitle")}
          description={result.filtered ? tList("noResultsBody") : t("emptyBody")}
          action={canCreate && !result.filtered ? <TrainerFormDialog mode="create" /> : null}
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tCommon("name")}</TableHead>
                  <TableHead>{tCommon("email")}</TableHead>
                  <TableHead>{t("qualifications")}</TableHead>
                  <TableHead className="text-right">{t("teams")}</TableHead>
                  <TableHead>{tCommon("status")}</TableHead>
                  <TableHead className="sr-only">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((trainer) => (
                  <TableRow key={trainer.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {trainer.color ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: trainer.color }}
                            aria-hidden
                          />
                        ) : null}
                        <Link
                          href={`/trainers/${trainer.id}`}
                          className="font-medium hover:underline"
                        >
                          {trainer.first_name} {trainer.last_name}
                        </Link>
                      </div>
                      {trainer.phone ? (
                        <div className="text-xs text-muted-foreground">{trainer.phone}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {trainer.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {trainer.qualifications.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          trainer.qualifications.map((q) => (
                            <Badge key={q} variant="outline">
                              {q}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {trainer.team_count}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={trainer.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <TrainerRowActions
                        trainer={{
                          id: trainer.id,
                          firstName: trainer.first_name,
                          lastName: trainer.last_name,
                          email: trainer.email,
                          phone: trainer.phone,
                          qualifications: trainer.qualifications,
                          color: trainer.color,
                          notes: trainer.notes,
                          status: trainer.status,
                        }}
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
