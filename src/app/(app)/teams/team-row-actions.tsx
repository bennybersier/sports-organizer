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
import { archiveTeamAction, restoreTeamAction } from "@/server/actions/teams";
import { getTeamTrainerIdsAction } from "@/server/actions/teams-read";

import { TeamFormDialog, type TeamFormValues } from "./team-form-dialog";

export function TeamRowActions({
  team,
  seasons,
  trainers,
  gyms,
  canUpdate,
  canDelete,
}: {
  team: TeamFormValues & { id: string; status: string };
  seasons: MultiSelectOption[];
  trainers: MultiSelectOption[];
  gyms: MultiSelectOption[];
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [trainerIds, setTrainerIds] = useState<string[] | undefined>(undefined);

  const isArchived = team.status === "ARCHIVED";
  if (!canUpdate && !canDelete) return null;

  // Current assignments are loaded on demand rather than for every row on the
  // page — most rows are never edited.
  async function openEdit() {
    const result = await getTeamTrainerIdsAction(team.id);
    setTrainerIds(result.ok ? result.data : []);
    setEditOpen(true);
  }

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
                run(() => restoreTeamAction(team.id), {
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
        <TeamFormDialog
          mode="edit"
          team={team}
          seasons={seasons}
          trainers={trainers}
          gyms={gyms}
          initialTrainerIds={trainerIds}
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
          run(() => archiveTeamAction(team.id), {
            success: (data) => t("archived", { name: data.name }),
          })
        }
      />
    </>
  );
}
