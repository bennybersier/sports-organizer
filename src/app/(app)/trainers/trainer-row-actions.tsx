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
import { archiveTrainerAction, restoreTrainerAction } from "@/server/actions/trainers";
import { getTrainerTeamIdsAction } from "@/server/actions/trainers-read";
import type { MultiSelectOption } from "@/components/data/multi-select";

import { TrainerFormDialog, type TrainerFormValues } from "./trainer-form-dialog";

export function TrainerRowActions({
  trainer,
  teams,
  canUpdate,
  canDelete,
}: {
  trainer: TrainerFormValues & { id: string; status: string };
  teams: MultiSelectOption[];
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("trainers");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [teamIds, setTeamIds] = useState<string[] | undefined>(undefined);

  // Current assignments are fetched when the dialog is asked for, so the list
  // page does not pay for rows nobody edits.
  async function openEdit() {
    const result = await getTrainerTeamIdsAction(trainer.id);
    setTeamIds(result.ok ? result.data : []);
    setEditOpen(true);
  }

  const isArchived = trainer.status === "ARCHIVED";
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
            <DropdownMenuItem onSelect={() => void openEdit()}>
              <Pencil aria-hidden />
              {tCommon("edit")}
            </DropdownMenuItem>
          ) : null}

          {canUpdate && isArchived ? (
            <DropdownMenuItem
              onSelect={() =>
                run(() => restoreTrainerAction(trainer.id), {
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

      {editOpen ? (
        <TrainerFormDialog
          mode="edit"
          trainer={trainer}
          teams={teams}
          initialTeamIds={teamIds}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("archiveConfirmTitle")}
        description={t("archiveConfirmBody")}
        confirmLabel={tCommon("archive")}
        onConfirm={() =>
          run(() => archiveTrainerAction(trainer.id), {
            success: (data) => t("archived", { name: data.name }),
          })
        }
      />
    </>
  );
}
