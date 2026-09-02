"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, CheckCircle2, Copy, MoreHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activateSeasonAction, archiveSeasonAction } from "@/server/actions/seasons";

import { DuplicateSeasonDialog } from "./duplicate-season-dialog";
import { SeasonFormDialog, type SeasonFormValues } from "./season-form-dialog";

interface Season extends SeasonFormValues {
  id: string;
  status: string;
}

/**
 * Per-row actions.
 *
 * Every item is gated on the permission the server will actually check, so the
 * menu never offers something that fails on click — but the action re-checks
 * regardless, because hiding UI is not authorization.
 */
export function SeasonRowActions({
  season,
  canUpdate,
  canArchive,
  canCreate,
}: {
  season: Season;
  canUpdate: boolean;
  canArchive: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("seasons");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const isArchived = season.status === "ARCHIVED";

  function run(
    action: () => Promise<{ ok: boolean; data?: { name: string }; error?: { code: string; message: string } }>,
    message: (name: string) => string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message || tErrors("INTERNAL_ERROR"));
        return;
      }
      toast.success(message(result.data!.name));
      router.refresh();
    });
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
          {canUpdate && !isArchived ? (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              {tCommon("edit")}
            </DropdownMenuItem>
          ) : null}

          {canUpdate && season.status !== "ACTIVE" ? (
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () => activateSeasonAction(season.id),
                  (name) => t("activated", { name }),
                )
              }
            >
              <CheckCircle2 aria-hidden />
              {t("setActive")}
            </DropdownMenuItem>
          ) : null}

          {canCreate ? (
            <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>
              <Copy aria-hidden />
              {t("duplicate")}
            </DropdownMenuItem>
          ) : null}

          {canArchive && !isArchived ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiveOpen(true)}>
                <Archive aria-hidden />
                {t("archiveAction")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <SeasonFormDialog mode="edit" season={season} open={editOpen} onOpenChange={setEditOpen} />
      <DuplicateSeasonDialog
        season={season}
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archiveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("archiveConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                run(
                  () => archiveSeasonAction(season.id),
                  (name) => t("archived", { name }),
                )
              }
            >
              {t("archiveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
