"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
 * The weekly availability editor.
 *
 * Laid out by weekday rather than as a flat table, because that is how a club
 * actually thinks about it — "what happens on Tuesdays" is the question being
 * answered, not "list every row in the database".
 *
 * Overlapping windows on the same day are rejected by the database; the
 * translated explanation arrives as a toast from the action hook.
 */
export function WeeklyAvailabilityEditor({
  domain,
  ownerId,
  windows,
  seasonStart,
  canEdit,
}: {
  domain: "gym" | "trainer" | "team";
  ownerId: string;
  windows: AvailabilityWindow[];
  seasonStart: string;
  canEdit: boolean;
}) {
  const t = useTranslations("availability");
  const tWeekdays = useTranslations("weekdays");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();

  const [addingTo, setAddingTo] = useState<IsoWeekday | null>(null);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");

  const byWeekday = new Map<IsoWeekday, AvailabilityWindow[]>();
  for (const window of windows) {
    byWeekday.set(window.isoWeekday, [...(byWeekday.get(window.isoWeekday) ?? []), window]);
  }

  const totalHours =
    Math.round(
      (windows.reduce((sum, window) => {
        const [sh, sm] = window.startTime.split(":").map(Number);
        const [eh, em] = window.endTime.split(":").map(Number);
        return sum + (eh * 60 + em - (sh * 60 + sm));
      }, 0) /
        60) *
        10,
    ) / 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4" aria-hidden />
          {t("weeklyTitle")}
        </CardTitle>
        <CardDescription>
          {t("weeklySubtitle")}
          {windows.length > 0 ? ` · ${t("weeklyTotal", { hours: totalHours })}` : null}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <ul className="divide-y rounded-lg border">
          {ISO_WEEKDAYS.map((weekday) => {
            const dayWindows = byWeekday.get(weekday) ?? [];
            return (
              <li key={weekday} className="flex flex-wrap items-start gap-3 p-3">
                <span className="w-24 shrink-0 pt-1 text-sm font-medium">
                  {tWeekdays(WEEKDAY_KEYS[weekday])}
                </span>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {dayWindows.length === 0 && addingTo !== weekday ? (
                    <span className="text-sm text-muted-foreground">{t("noWindows")}</span>
                  ) : null}

                  {dayWindows.map((window) => (
                    <span
                      key={window.id}
                      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2 text-sm tabular-nums"
                    >
                      {window.startTime}–{window.endTime}
                      {canEdit ? (
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
                      ) : null}
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

                {canEdit && addingTo !== weekday ? (
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

        {canEdit ? <p className="text-xs text-muted-foreground">{t("overlapWarning")}</p> : null}
      </CardContent>
    </Card>
  );
}
