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
import type { MultiSelectOption } from "@/components/data/multi-select";
import { useAction } from "@/hooks/use-action";
import {
  archiveCompetitionAction,
  restoreCompetitionAction,
} from "@/server/actions/competitions";

import { CompetitionFormDialog, type CompetitionFormValues } from "./competition-form-dialog";

export function CompetitionRowActions({
  competition,
  seasons,
  teams,
  canUpdate,
  canDelete,
}: {
  competition: CompetitionFormValues & { id: string; status: string };
  seasons: MultiSelectOption[];
  teams: MultiSelectOption[];
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("competitions");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const isArchived = competition.status === "ARCHIVED";
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
                run(() => restoreCompetitionAction(competition.id), {
                  success: (data) => t("restored", { name: data.name }),
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
        <CompetitionFormDialog
          mode="edit"
          competition={competition}
          seasons={seasons}
          teams={teams}
          open
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
          run(() => archiveCompetitionAction(competition.id), {
            success: (data) => t("archived", { name: data.name }),
          })
        }
      />
    </>
  );
}
