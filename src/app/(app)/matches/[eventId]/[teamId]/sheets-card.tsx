"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, FileImage, Loader2, ScanLine, Trash2, Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { READABLE_IMAGE_TYPES } from "@/domain/ai";
import {
  deleteSheetAction,
  readSheetAction,
  uploadSheetAction,
} from "@/server/actions/matches";
import type { SheetView } from "@/server/services/match-sheet-service";
import type { SquadMember } from "@/server/services/match-service";

import { SheetReview } from "./sheet-review";

/**
 * The game sheet, from phone to box score.
 *
 * Three steps, each of which a person starts: upload the photograph, have it
 * read, accept what it says. They are deliberately not one button. Reading
 * spends the club's own API key, and importing writes into children's seasons —
 * neither should happen as a side effect of choosing a file.
 */
export function SheetsCard({
  eventId,
  teamId,
  registerId,
  sheets,
  squad,
  canRecord,
  canManage,
  canRead,
  hasProvider,
  needsResult,
}: {
  eventId: string;
  teamId: string;
  /** Null until somebody opens one; uploading opens it. */
  registerId: string | null;
  sheets: SheetView[];
  squad: SquadMember[];
  canRecord: boolean;
  canManage: boolean;
  /** Whether the caller may spend the club's AI key. */
  canRead: boolean;
  /** Whether the club has configured a provider at all. */
  hasProvider: boolean;
  /**
   * False when the match already has a result. The review then stops asking
   * for the opponent's final score, which is the one question whose only
   * purpose is to let the import write one.
   */
  needsResult: boolean;
}) {
  const t = useTranslations("matches");
  const { run, isPending } = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  // The sheet awaiting a delete confirmation. ConfirmDialog is controlled, so
  // one dialog is shared rather than one rendered per row.
  const [confirming, setConfirming] = useState<string | null>(null);

  function upload(file: File) {
    const formData = new FormData();
    // Either is enough: the action opens a register for the match when there
    // is none, so a photograph never waits on a squad being picked first.
    if (registerId) formData.set("registerId", registerId);
    formData.set("eventId", eventId);
    formData.set("teamId", teamId);
    formData.set("file", file);

    run(() => uploadSheetAction(formData), {
      success: () => t("uploaded"),
      // Cleared so choosing the same file again re-fires `onChange`, which it
      // would not do while the input still holds that file.
      onSuccess: () => {
        if (fileInput.current) fileInput.current.value = "";
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileImage className="size-4" aria-hidden />
          {t("sheets")}
        </CardTitle>
        <CardDescription>{t("sheetsHint")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {canRecord ? (
          <div className="space-y-1.5">
            <Input
              ref={fileInput}
              type="file"
              accept={READABLE_IMAGE_TYPES.join(",")}
              disabled={isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
            <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
            {isPending ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                {t("uploading")}
              </p>
            ) : null}
          </div>
        ) : null}

        {sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSheets")}</p>
        ) : (
          <ul className="space-y-6">
            {sheets.map((sheet) => (
              <li key={sheet.id} className="space-y-4">
                <div className="flex flex-wrap items-start gap-4">
                  {sheet.imageUrl ? (
                    // The photograph itself, small, beside the numbers derived
                    // from it. A plain <img>: the URL is signed and short-lived,
                    // so the image optimiser could not fetch it twice anyway.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sheet.imageUrl}
                      alt=""
                      className="h-28 w-40 rounded-md border object-cover"
                    />
                  ) : null}

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          sheet.state === "IMPORTED"
                            ? "default"
                            : sheet.state === "FAILED"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {t(`sheetState.${sheet.state}`)}
                      </Badge>
                      {sheet.readModel ? (
                        <span className="text-xs text-muted-foreground">
                          {t("wasRead", { model: sheet.readModel })}
                        </span>
                      ) : null}
                    </div>

                    {sheet.failure ? (
                      <Alert variant="destructive">
                        <AlertDescription>{sheet.failure}</AlertDescription>
                      </Alert>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {sheet.imageUrl ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={sheet.imageUrl} target="_blank" rel="noreferrer">
                            <Eye aria-hidden />
                            {t("openFullSize")}
                          </a>
                        </Button>
                      ) : null}

                      {canRead && hasProvider && sheet.state !== "IMPORTED" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(() => readSheetAction({ sheetId: sheet.id }), {
                              success: () => t("checks"),
                            })
                          }
                        >
                          {isPending ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : (
                            <ScanLine aria-hidden />
                          )}
                          {sheet.state === "UPLOADED" ? t("read") : t("rereadSheet")}
                        </Button>
                      ) : null}

                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirming(sheet.id)}
                        >
                          <Trash2 aria-hidden />
                          {t("deleteSheet")}
                        </Button>
                      ) : null}
                    </div>

                    {!hasProvider && sheet.state === "UPLOADED" ? (
                      <Alert>
                        <AlertDescription>{t("noProvider")}</AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                </div>

                {sheet.state === "READ" ? (
                  <SheetReview
                    sheet={sheet}
                    squad={squad}
                    canRecord={canRecord}
                    needsResult={needsResult}
                  />
                ) : null}

                {sheet.state === "IMPORTED" ? (
                  <Alert>
                    <Upload aria-hidden />
                    <AlertDescription>{t("sheetState.IMPORTED")}</AlertDescription>
                  </Alert>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(open) => setConfirming(open ? confirming : null)}
          title={t("deleteSheetConfirm")}
          description={t("deleteSheetBody")}
          confirmLabel={t("deleteSheet")}
          onConfirm={() => {
            const id = confirming;
            setConfirming(null);
            if (id) {
              run(() => deleteSheetAction(id), { success: () => t("sheetDeleted") });
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
