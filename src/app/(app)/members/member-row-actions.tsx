"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal, ShieldCheck, UserMinus, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { changeRoleAction, removeMemberAction } from "@/server/actions/members";

import { PermissionsSheet } from "./permissions-sheet";
import type { RoleOption } from "./invite-member-dialog";

export function MemberRowActions({
  member,
  roles,
  actorRank,
  canUpdate,
  canRemove,
  canOverride,
}: {
  member: {
    membershipId: string;
    userId: string;
    name: string;
    roleId: string;
    roleRank: number;
    isSelf: boolean;
  };
  roles: RoleOption[];
  actorRank: number;
  canUpdate: boolean;
  canRemove: boolean;
  canOverride: boolean;
}) {
  const t = useTranslations("members");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);

  /*
    Owners may act on other owners so co-ownership stays workable; everyone else
    needs to strictly outrank the target. Mirrors assertOutranks on the server,
    which is what actually enforces it.
  */
  const outranks = actorRank === 0 ? member.roleRank >= actorRank : member.roleRank > actorRank;
  const canAct = outranks && !member.isSelf;

  if (!canUpdate && !canRemove && !canOverride) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={isPending}
            aria-label={tCommon("actions")}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-48">
          {!canAct ? (
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {member.isSelf ? t("you") : t("cannotEditHigher")}
            </DropdownMenuLabel>
          ) : null}

          {canUpdate && canAct ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserCog aria-hidden />
                {t("changeRole")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={member.roleId}
                  onValueChange={(roleId) =>
                    run(() => changeRoleAction({ membershipId: member.membershipId, roleId }), {
                      success: () => t("roleChanged"),
                    })
                  }
                >
                  {roles.map((role) => (
                    <DropdownMenuRadioItem key={role.id} value={role.id}>
                      {role.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}

          {canOverride && canAct ? (
            <DropdownMenuItem onSelect={() => setPermissionsOpen(true)}>
              <ShieldCheck aria-hidden />
              {t("permissions")}
            </DropdownMenuItem>
          ) : null}

          {canRemove && canAct ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
                <UserMinus aria-hidden />
                {t("remove")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {permissionsOpen ? (
        <PermissionsSheet
          userId={member.userId}
          name={member.name}
          open={permissionsOpen}
          onOpenChange={setPermissionsOpen}
        />
      ) : null}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t("removeConfirmTitle")}
        description={t("removeConfirmBody")}
        confirmLabel={t("remove")}
        onConfirm={() =>
          run(() => removeMemberAction(member.membershipId), { success: () => t("removed") })
        }
      />
    </>
  );
}
