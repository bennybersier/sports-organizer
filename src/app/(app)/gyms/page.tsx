import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MapPin } from "lucide-react";

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
import { listGymSports, listGyms } from "@/server/services/gym-service";
import { parseListParams } from "@/server/services/list-query";

import { GymFormDialog } from "./gym-form-dialog";
import { GymRowActions } from "./gym-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gyms");
  return { title: t("title") };
}

export default async function GymsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "gyms.read")) return <AccessDenied />;

  const t = await getTranslations("gyms");
  const tCommon = await getTranslations("common");
  const tList = await getTranslations("list");

  const raw = await searchParams;
  const params = parseListParams(raw);
  const status = typeof raw.status === "string" ? raw.status : undefined;
  const sport = typeof raw.sport === "string" ? raw.sport : undefined;

  const [result, sports] = await Promise.all([
    listGyms(context, params, { status, sport }),
    listGymSports(context),
  ]);

  const canCreate = hasPermission(context, "gyms.create");
  const canUpdate = hasPermission(context, "gyms.update");
  const canDelete = hasPermission(context, "gyms.delete");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={canCreate ? <GymFormDialog mode="create" /> : null}
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
          ...(sports.length > 0
            ? [
                {
                  name: "sport",
                  label: tCommon("sport"),
                  allLabel: tCommon("all"),
                  options: sports.map((s) => ({ value: s, label: s })),
                },
              ]
            : []),
        ]}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={result.filtered ? tList("noResults") : t("emptyTitle")}
          description={result.filtered ? tList("noResultsBody") : t("emptyBody")}
          action={canCreate && !result.filtered ? <GymFormDialog mode="create" /> : null}
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tCommon("name")}</TableHead>
                  <TableHead>{t("location")}</TableHead>
                  <TableHead>{t("sportTypes")}</TableHead>
                  <TableHead className="text-right">{t("capacity")}</TableHead>
                  <TableHead>{tCommon("status")}</TableHead>
                  <TableHead className="sr-only">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((gym) => (
                  <TableRow key={gym.id}>
                    <TableCell variant="primary">
                      <div className="flex items-center gap-2">
                        {gym.color ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: gym.color }}
                            aria-hidden
                          />
                        ) : null}
                        <Link href={`/gyms/${gym.id}`} className="font-medium hover:underline">
                          {gym.name}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell data-label={t("location")} className="text-sm text-muted-foreground">
                      {[gym.address_line1, gym.city].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell data-label={t("sportTypes")}>
                      <div className="flex flex-wrap gap-1">
                        {gym.sport_types.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          gym.sport_types.map((sportType) => (
                            <Badge key={sportType} variant="outline">
                              {sportType}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-label={t("capacity")} className="text-right tabular-nums">
                      {gym.capacity ?? "—"}
                    </TableCell>
                    <TableCell data-label={tCommon("status")}>
                      <StatusBadge status={gym.status} />
                    </TableCell>
                    <TableCell variant="actions" className="text-right">
                      <GymRowActions
                        gym={{
                          id: gym.id,
                          name: gym.name,
                          description: gym.description,
                          addressLine1: gym.address_line1,
                          postalCode: gym.postal_code,
                          city: gym.city,
                          country: gym.country,
                          capacity: gym.capacity,
                          sportTypes: gym.sport_types,
                          equipment: gym.equipment,
                          color: gym.color,
                          notes: gym.notes,
                          status: gym.status,
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
