"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { ISO_WEEKDAYS, WEEKDAY_KEYS, type IsoWeekday } from "@/domain/availability";
import {
  createAvailabilityAction,
  deleteAvailabilityAction,
} from "@/server/actions/availability";
import type { AvailabilityWindow } from "@/server/services/availability-service";

/**
 * The weekly availability pattern.
 *
 * Read and edit are deliberately separate. Reading is the common case — someone
 * on a hall's page wants to know when it is open, and seven rows of which four
 * say "not available" answers that question by burying it. So the card lists
 * only the days that have hours, and the days with nothing to say are simply
 * absent.
 *
 * Editing is a deliberate act and gets the room it needs. All seven days appear
 * in the dialog, because a day with no hours is exactly the day you have opened
 * the editor to fill in — the emptiness that is noise while reading is the
 * target while writing.
 *
 * An empty day does not mean the same thing for every owner, and the copy says
 * so rather than leaving it to be discovered. A hall or a coach with no hours
 * on a weekday is unavailable; a team is simply not restricted that day, and
 * falls back to the time window in its training requirements.
 */

export interface WeeklyAvailabilityProps {
  domain: "gym" | "trainer" | "team";
  ownerId: string;
  windows: AvailabilityWindow[];
  seasonStart: string;
  canEdit: boolean;
}

function groupByWeekday(windows: AvailabilityWindow[]) {
  const byWeekday = new Map<IsoWeekday, AvailabilityWindow[]>();
  for (const window of windows) {
    byWeekday.set(window.isoWeekday, [...(byWeekday.get(window.isoWeekday) ?? []), window]);
  }
  return byWeekday;
}

function weeklyHours(windows: AvailabilityWindow[]) {
  const minutes = windows.reduce((sum, window) => {
    const [sh, sm] = window.startTime.split(":").map(Number);
    const [eh, em] = window.endTime.split(":").map(Number);
    return sum + (eh * 60 + em - (sh * 60 + sm));
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}

export function WeeklyAvailabilityEditor({
  domain,
  ownerId,
  windows,
  seasonStart,
  canEdit,
}: WeeklyAvailabilityProps) {
  const t = useTranslations("availability");
  const tWeekdays = useTranslations("weekdays");

  const [editing, setEditing] = useState(false);

  // Teams are open until told otherwise; halls and coaches are shut until told.
  const isTeam = domain === "team";
  const byWeekday = groupByWeekday(windows);
  const days = ISO_WEEKDAYS.filter((weekday) => (byWeekday.get(weekday) ?? []).length > 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4" aria-hidden />
            {t("weeklyTitle")}
          </CardTitle>
          <CardDescription>
            {isTeam ? t("weeklySubtitleTeam") : t("weeklySubtitle")}
            {windows.length > 0 ? ` · ${t("weeklyTotal", { hours: weeklyHours(windows) })}` : null}
          </CardDescription>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("editHours")}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent>
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isTeam ? t("noWeeklyPatternTeam") : t("noWeeklyPattern")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {days.map((weekday) => (
              <li key={weekday} className="flex flex-wrap items-center gap-3 p-3">
                <span className="w-24 shrink-0 text-sm font-medium">
                  {tWeekdays(WEEKDAY_KEYS[weekday])}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {(byWeekday.get(weekday) ?? []).map((window) => (
                    <span
                      key={window.id}
                      className="inline-flex items-center rounded-md border bg-muted/40 px-2 py-1 text-sm tabular-nums"
                    >
                      {window.startTime}–{window.endTime}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {canEdit ? (
        <WeeklyAvailabilityDialog
          open={editing}
          onOpenChange={setEditing}
          domain={domain}
          ownerId={ownerId}
          windows={windows}
          seasonStart={seasonStart}
        />
      ) : null}
    </Card>
  );
}

/**
 * The editor itself, at nine-tenths of the viewport.
 *
 * Big on purpose: this is a seven-row grid whose rows grow a time picker when
 * you touch them, and squeezing it into a normal dialog meant the row being
 * edited pushed the rest out of sight — you could no longer see the hours you
 * were adding *around*.
 */
function WeeklyAvailabilityDialog({
  open,
  onOpenChange,
  domain,
  ownerId,
  windows,
  seasonStart,
}: Omit<WeeklyAvailabilityProps, "canEdit"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("availability");
  const tWeekdays = useTranslations("weekdays");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();

  const [addingTo, setAddingTo] = useState<IsoWeekday | null>(null);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");

  const isTeam = domain === "team";
  const byWeekday = groupByWeekday(windows);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] w-[90vw] max-w-none flex-col gap-4 sm:max-w-none"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{t("weeklyTitle")}</DialogTitle>
          <DialogDescription>
            {isTeam ? t("weeklySubtitleTeam") : t("weeklySubtitle")}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex-1 divide-y overflow-y-auto rounded-lg border">
          {ISO_WEEKDAYS.map((weekday) => {
            const dayWindows = byWeekday.get(weekday) ?? [];
            return (
              <li key={weekday} className="flex flex-wrap items-start gap-3 p-3">
                <span className="w-24 shrink-0 pt-1 text-sm font-medium">
                  {tWeekdays(WEEKDAY_KEYS[weekday])}
                </span>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {dayWindows.length === 0 && addingTo !== weekday ? (
                    <span className="text-sm text-muted-foreground">
                      {isTeam ? t("unrestricted") : t("noWindows")}
                    </span>
                  ) : null}

                  {dayWindows.map((window) => (
                    <span
                      key={window.id}
                      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2 text-sm tabular-nums"
                    >
                      {window.startTime}–{window.endTime}
                      <button
                        type="button"
                        disabled={isPending}
                        aria-label={`${t("removeWindow")}: ${tWeekdays(WEEKDAY_KEYS[weekday])} ${window.startTime}–${window.endTime}`}
                        className="rounded-sm p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() =>
                          run(() => deleteAvailabilityAction(domain, window.id, ownerId), {
                            success: () => t("removed"),
                          })
                        }
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ))}

                  {addingTo === weekday ? (
                    <span className="flex flex-wrap items-end gap-2">
                      <span className="grid gap-1">
                        <Label htmlFor={`start-${weekday}`} className="text-xs">
                          {t("from")}
                        </Label>
                        <Input
                          id={`start-${weekday}`}
                          type="time"
                          value={start}
                          onChange={(event) => setStart(event.target.value)}
                          className="h-8 w-28"
                        />
                      </span>
                      <span className="grid gap-1">
                        <Label htmlFor={`end-${weekday}`} className="text-xs">
                          {t("to")}
                        </Label>
                        <Input
                          id={`end-${weekday}`}
                          type="time"
                          value={end}
                          onChange={(event) => setEnd(event.target.value)}
                          className="h-8 w-28"
                        />
                      </span>
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () =>
                              createAvailabilityAction({
                                domain,
                                ownerId,
                                isoWeekday: weekday,
                                startTime: start,
                                endTime: end,
                                validFrom: seasonStart,
                              }),
                            { success: () => t("added"), onSuccess: () => setAddingTo(null) },
                          )
                        }
                      >
                        {tCommon("add")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setAddingTo(null)}
                      >
                        {tCommon("cancel")}
                      </Button>
                    </span>
                  ) : null}
                </div>

                {addingTo !== weekday ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={isPending}
                    onClick={() => setAddingTo(weekday)}
                  >
                    <Plus aria-hidden />
                    {t("addWindow")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">{t("overlapWarning")}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
