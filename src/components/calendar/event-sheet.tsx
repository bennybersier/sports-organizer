"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, MapPin, Trash2, UserCog, Users } from "lucide-react";

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
import { cancelEventAction } from "@/server/actions/calendar";
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
  canDelete,
  formatRange,
}: {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canDelete: boolean;
  formatRange: (item: CalendarItem) => string;
}) {
  const t = useTranslations("calendar");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!item) return null;

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

            {canDelete && item.source === "EVENT" && item.status !== "CANCELLED" ? (
              <>
                <Separator />
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={isPending}
                  onClick={() => setCancelOpen(true)}
                >
                  <Trash2 aria-hidden />
                  {t("cancel")}
                </Button>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

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
