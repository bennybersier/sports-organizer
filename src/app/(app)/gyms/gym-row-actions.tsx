"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Archive, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { archiveGymAction, restoreGymAction } from "@/server/actions/gyms";

import { GymFormDialog, type GymFormValues } from "./gym-form-dialog";

export function GymRowActions({
  gym,
  canUpdate,
  canDelete,
}: {
  gym: GymFormValues & { id: string; status: string };
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("gyms");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const isArchived = gym.status === "ARCHIVED";
  if (!canUpdate && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isPending} aria-label={tCommon("actions")}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canUpdate ? (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              {tCommon("edit")}
            </DropdownMenuItem>
          ) : null}

          {canUpdate && isArchived ? (
            <DropdownMenuItem
              onSelect={() =>
                run(() => restoreGymAction(gym.id), {
                  success: (data) => t("updated", { name: data.name }),
                })
              }
            >
              <RotateCcw aria-hidden />
              {tCommon("restore")}
            </DropdownMenuItem>
          ) : null}

          {canDelete && !isArchived ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiveOpen(true)}>
                <Archive aria-hidden />
                {tCommon("archive")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <GymFormDialog mode="edit" gym={gym} open={editOpen} onOpenChange={setEditOpen} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("archiveConfirmTitle")}
        description={t("archiveConfirmBody")}
        confirmLabel={tCommon("archive")}
        onConfirm={() =>
          run(() => archiveGymAction(gym.id), {
            success: (data) => t("archived", { name: data.name }),
          })
        }
      />
    </>
  );
}
