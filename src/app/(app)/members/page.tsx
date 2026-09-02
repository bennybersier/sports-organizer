import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Mail, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import {
  listAssignableRoles,
  listMembers,
  listPendingInvitations,
} from "@/server/services/membership-service";
import { roleLabel } from "@/i18n/roles";

import { InviteMemberDialog } from "./invite-member-dialog";
import { InvitationActions } from "./invitation-actions";
import { MemberRowActions } from "./member-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members");
  return { title: t("title") };
}

export default async function MembersPage() {
  const context = await requireAuthContext();
  if (!hasPermission(context, "members.read")) return <AccessDenied />;

  const t = await getTranslations("members");
  const tCommon = await getTranslations("common");
  const tRoles = await getTranslations("roles");
  const format = await getFormatter();

  const [members, invitations, roles] = await Promise.all([
    listMembers(context),
    hasPermission(context, "members.invite")
      ? listPendingInvitations(context)
      : Promise.resolve([]),
    listAssignableRoles(context),
  ]);

  const canInvite = hasPermission(context, "members.invite");
  const canUpdate = hasPermission(context, "members.update");
  const canRemove = hasPermission(context, "members.remove");
  const canOverride = hasPermission(context, "roles.update");

  const roleOptions = roles.map((role) => ({
    id: role.id,
    name: roleLabel(tRoles, role.key, role.name),
    rank: role.rank,
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          canInvite ? (
            <InviteMemberDialog roles={roleOptions} clubName={context.tenant.name} />
          ) : null
        }
      />

      {invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="size-4" aria-hidden />
              {t("pending")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{invitation.email}</span>
                  <Badge variant="outline">{invitation.roleName}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("expires", {
                      date: format.dateTime(new Date(invitation.expiresAt), {
                        dateStyle: "medium",
                      }),
                    })}
                  </span>
                  <InvitationActions invitationId={invitation.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("member")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("joined")}</TableHead>
              <TableHead className="text-right">{t("overrides")}</TableHead>
              <TableHead className="sr-only">{tCommon("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.membershipId}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{member.fullName ?? member.email}</span>
                    {member.isSelf ? <Badge variant="secondary">{t("you")}</Badge> : null}
                  </div>
                  {member.fullName ? (
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={member.roleRank === 0 ? "default" : "outline"}>
                    {roleLabel(tRoles, member.roleKey, member.roleName)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(member.joinedAt), { dateStyle: "medium" })}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.overrideCount > 0 ? (
                    <Badge variant="secondary">{member.overrideCount}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <MemberRowActions
                    member={{
                      membershipId: member.membershipId,
                      userId: member.userId,
                      name: member.fullName ?? member.email,
                      roleId: member.roleId,
                      roleRank: member.roleRank,
                      isSelf: member.isSelf,
                    }}
                    roles={roleOptions}
                    /* Rank gates the whole menu: you may never act on someone
                       at or above your own level. The server checks again. */
                    actorRank={context.role.rank}
                    canUpdate={canUpdate}
                    canRemove={canRemove}
                    canOverride={canOverride}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {members.length === 1 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Users className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">{t("emptyTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
