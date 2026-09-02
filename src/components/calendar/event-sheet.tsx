"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarClock,
  CalendarSync,
  CalendarX,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import {
  cancelEventAction,
  deleteEventAction,
  getEventAction,
} from "@/server/actions/calendar";
import {
  cancelScheduleEntryAction,
  cancelScheduleSeriesAction,
  restoreScheduleEntryAction,
  restoreScheduleSeriesAction,
} from "@/server/actions/organizer";
import {
  NewEventButton,
  type EventDialogOptions,
  type EventFormValues,
} from "@/app/(app)/calendar/new-event-button";
import type { CalendarItem } from "@/server/services/calendar-service";
import type { Finding, PlacementSeverity } from "@/domain/scheduling/conflicts";

import { ConflictList } from "./conflict-list";

/**
 * Detail panel for a calendar item.
 *
 * Surfaces the stored validation findings, which is the "why this slot?"
 * explanation the spec calls a core UX feature — an organizer looking at a
 * flagged session should be able to see the reason without leaving the
 * calendar.
 */
export function EventSheet({
  item,
  open,
  onOpenChange,
  canEdit,
  canDelete,
  options,
  formatRange,
}: {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  canDelete: boolean;
  /** Pickers for the edit form. */
  options: EventDialogOptions;
  formatRange: (item: CalendarItem) => string;
}) {
  const t = useTranslations("calendar");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelSessionOpen, setCancelSessionOpen] = useState(false);
  const [cancelSeriesOpen, setCancelSeriesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<EventFormValues | null>(null);

  if (!item) return null;

  // Only manual events can be edited or removed here. Training belongs to a
  // schedule version, and changing it out from under that version would leave
  // the schedule's history describing something that no longer exists.
  const isManualEvent = item.source === "EVENT";
  const isCancelled = item.status === "CANCELLED";

  async function openEditor() {
    const result = await getEventAction(item!.id);
    if (result.ok) setEditing(result.data as EventFormValues);
  }

  const findings = ((item as unknown as { validationDetails?: { findings?: Finding[] } })
    .validationDetails?.findings ?? []) as Finding[];

  const rows = [
    { icon: CalendarClock, label: t("starts"), value: formatRange(item) },
    { icon: MapPin, label: t("gym"), value: item.gymName },
    { icon: UserCog, label: t("trainer"), value: item.trainerName },
    { icon: Users, label: tCommon("team"), value: item.teamName },
  ].filter((row) => row.value);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t(item.type as "TRAINING")}</Badge>
              <Badge variant={item.status === "CANCELLED" ? "destructive" : "secondary"}>
                {t(item.status as "SCHEDULED")}
              </Badge>
            </div>
            <SheetTitle>{item.title}</SheetTitle>
            <SheetDescription>{formatRange(item)}</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4">
            <dl className="space-y-2">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center gap-2 text-sm">
                  <row.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <dt className="sr-only">{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("whyThisSlot")}</h3>
              {findings.length > 0 ? (
                <ConflictList
                  severity={item.validationState as PlacementSeverity}
                  findings={findings}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("noIssues")}</p>
              )}
            </div>

            {isManualEvent ? (
              <>
                <Separator />

                <div className="flex flex-wrap gap-2">
                  {canEdit && !isCancelled ? (
                    <Button variant="outline" onClick={() => void openEditor()}>
                      <Pencil aria-hidden />
                      {t("edit")}
                    </Button>
                  ) : null}

                  {canDelete && !isCancelled ? (
                    <Button
                      variant="outline"
                      disabled={isPending}
                      onClick={() => setCancelOpen(true)}
                    >
                      <XCircle aria-hidden />
                      {t("cancel")}
                    </Button>
                  ) : null}

                  {canDelete ? (
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      disabled={isPending}
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 aria-hidden />
                      {t("delete")}
                    </Button>
                  ) : null}
                </div>

                {canDelete ? (
                  <p className="text-xs text-muted-foreground">{t("cancelVsDelete")}</p>
                ) : null}
              </>
            ) : (
              <>
                <Separator />

                {/*
                  A generated session cannot be edited in place — it belongs to
                  a schedule version — but it can be called off for one week,
                  which is the thing clubs actually need most often.
                */}
                {canDelete ? (
                  <div className="flex flex-wrap gap-2">
                    {isCancelled ? (
                      <Button
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          run(() => restoreScheduleEntryAction(item.id), {
                            success: () => t("sessionRestored"),
                            onSuccess: () => onOpenChange(false),
                          })
                        }
                      >
                        <RotateCcw aria-hidden />
                        {t("restoreSession")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="text-destructive"
                        disabled={isPending}
                        onClick={() => setCancelSessionOpen(true)}
                      >
                        <XCircle aria-hidden />
                        {t("cancelSession")}
                      </Button>
                    )}

                    {/*
                      The series, not the schedule. Cancelling the event calls
                      off this slot's remaining weeks and touches nothing else —
                      other teams, other days and other slots are unaffected.
                    */}
                    {isCancelled ? (
                      <Button
                        variant="ghost"
                        disabled={isPending}
                        onClick={() =>
                          run(() => restoreScheduleSeriesAction(item.id), {
                            success: (data) => t("seriesRestored", { count: data.count }),
                            onSuccess: () => onOpenChange(false),
                          })
                        }
                      >
                        <CalendarSync aria-hidden />
                        {t("restoreSeries")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        disabled={isPending}
                        onClick={() => setCancelSeriesOpen(true)}
                      >
                        <CalendarX aria-hidden />
                        {t("cancelSeries")}
                      </Button>
                    )}
                  </div>
                ) : null}

                <p className="text-xs text-muted-foreground">{t("trainingActions")}</p>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {editing ? (
        <NewEventButton
          {...options}
          event={editing}
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={cancelSeriesOpen}
        onOpenChange={setCancelSeriesOpen}
        title={t("cancelSeriesConfirmTitle")}
        description={t("cancelSeriesConfirmBody")}
        confirmLabel={t("cancelSeries")}
        onConfirm={() =>
          run(() => cancelScheduleSeriesAction(item.id), {
            success: (data) => t("seriesCancelled", { count: data.count }),
            onSuccess: () => onOpenChange(false),
          })
        }
      />

      <ConfirmDialog
        open={cancelSessionOpen}
        onOpenChange={setCancelSessionOpen}
        title={t("cancelSessionConfirmTitle")}
        description={t("cancelSessionConfirmBody")}
        confirmLabel={t("cancelSession")}
        onConfirm={() =>
          run(() => cancelScheduleEntryAction(item.id), {
            success: () => t("sessionCancelled"),
            onSuccess: () => onOpenChange(false),
          })
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmBody")}
        confirmLabel={t("delete")}
        onConfirm={() =>
          run(() => deleteEventAction(item.id), {
            success: () => t("deleted"),
            onSuccess: () => onOpenChange(false),
          })
        }
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("cancelConfirmTitle")}
        description={t("cancelConfirmBody")}
        confirmLabel={t("cancel")}
        onConfirm={() =>
          run(() => cancelEventAction({ id: item.id }), {
            success: () => t("cancelled"),
            onSuccess: () => onOpenChange(false),
          })
        }
      />
    </>
  );
}
