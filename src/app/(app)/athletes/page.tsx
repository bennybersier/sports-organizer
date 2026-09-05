import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Dumbbell } from "lucide-react";

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
import { listAthletes } from "@/server/services/athlete-service";
import { parseListParams } from "@/server/services/list-query";
import { listTeamOptions } from "@/server/services/team-service";

import { AthleteFormDialog } from "./athlete-form-dialog";
import { AthleteRowActions } from "./athlete-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("athletes");
  return { title: t("title") };
}

const MEMBERSHIP_STATES = ["ACTIVE", "TRIAL", "INACTIVE", "SUSPENDED"] as const;

export default async function AthletesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "athletes.read")) return <AccessDenied />;

  const t = await getTranslations("athletes");
  const tCommon = await getTranslations("common");
  const tList = await getTranslations("list");
  const tMembership = await getTranslations("membershipState");
  const format = await getFormatter();

  const raw = await searchParams;
  const params = parseListParams(raw);
  const teamId = typeof raw.team === "string" ? raw.team : undefined;
  const membershipStatus = typeof raw.membership === "string" ? raw.membership : undefined;

  const canSeeTeams = hasPermission(context, "teams.read");
  const [result, teams] = await Promise.all([
    listAthletes(context, params, { teamId, membershipStatus }),
    canSeeTeams ? listTeamOptions(context) : Promise.resolve([]),
  ]);

  const canCreate = hasPermission(context, "athletes.create");
  const canUpdate = hasPermission(context, "athletes.update");
  const canDelete = hasPermission(context, "athletes.delete");

  const teamOptions = teams.map((team) => ({ value: team.id, label: team.name }));

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={canCreate ? <AthleteFormDialog mode="create" teams={teamOptions} /> : null}
      />

      <ListToolbar
        placeholder={t("searchPlaceholder")}
        filters={[
          ...(teamOptions.length > 0
            ? [
                {
                  name: "team",
                  label: tCommon("team"),
                  allLabel: t("allTeams"),
                  options: teamOptions,
                },
              ]
            : []),
          {
            name: "membership",
            label: t("membershipStatus"),
            allLabel: t("allStatuses"),
            options: MEMBERSHIP_STATES.map((state) => ({
              value: state,
              label: tMembership(state),
            })),
          },
        ]}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title={result.filtered ? tList("noResults") : t("emptyTitle")}
          description={result.filtered ? tList("noResultsBody") : t("emptyBody")}
          action={
            canCreate && !result.filtered ? (
              <AthleteFormDialog mode="create" teams={teamOptions} />
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
                  <TableHead>{t("teams")}</TableHead>
                  <TableHead>{t("dateOfBirth")}</TableHead>
                  <TableHead>{t("membershipStatus")}</TableHead>
                  <TableHead className="sr-only">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((athlete) => (
                  <TableRow key={athlete.id}>
                    <TableCell variant="primary">
                      <Link
                        href={`/athletes/${athlete.id}`}
                        className="font-medium hover:underline"
                      >
                        {athlete.first_name} {athlete.last_name}
                      </Link>
                      {athlete.email ? (
                        <div className="text-xs text-muted-foreground">{athlete.email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell data-label={t("teams")}>
                      <div className="flex flex-wrap gap-1">
                        {athlete.teams.length === 0 ? (
                          <span className="text-sm text-muted-foreground">{t("noTeams")}</span>
                        ) : (
                          athlete.teams.map((team) => (
                            <Badge key={team.id} variant="outline" className="gap-1">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: team.color }}
                                aria-hidden
                              />
                              {team.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-label={t("dateOfBirth")} className="text-sm text-muted-foreground">
                      {athlete.date_of_birth
                        ? format.dateTime(new Date(athlete.date_of_birth), { dateStyle: "medium" })
                        : "—"}
                    </TableCell>
                    <TableCell data-label={t("membershipStatus")}>
                      <Badge
                        variant={athlete.membership_status === "ACTIVE" ? "secondary" : "outline"}
                      >
                        {tMembership(athlete.membership_status)}
                      </Badge>
                    </TableCell>
                    <TableCell variant="actions" className="text-right">
                      <AthleteRowActions
                        athlete={{
                          id: athlete.id,
                          firstName: athlete.first_name,
                          lastName: athlete.last_name,
                          dateOfBirth: athlete.date_of_birth,
                          gender: athlete.gender,
                          email: athlete.email,
                          phone: athlete.phone,
                          addressLine1: athlete.address_line1,
                          postalCode: athlete.postal_code,
                          city: athlete.city,
                          emergencyContactName: athlete.emergency_contact_name,
                          emergencyContactPhone: athlete.emergency_contact_phone,
                          emergencyContactRelation: athlete.emergency_contact_relation,
                          membershipStatus: athlete.membership_status,
                          notes: athlete.notes,
                          status: athlete.status,
                        }}
                        teams={teamOptions}
                        currentTeamIds={athlete.teams.map((team) => team.id)}
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
