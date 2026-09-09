"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { declareAbsenceAction, deleteAbsenceAction } from "@/server/actions/attendance";
import type { AthleteAvailabilityExceptionRow } from "@/types/database";

/**
 * Absences the club has been told about.
 *
 * A date range rather than a session, because what a club is actually told is
 * "away from the 20th to the 27th" — one row here, and eight rows and a lie
 * anywhere else.
 *
 * The return on entering one is at the other end: the coach opens Tuesday's
 * register and the three they were told about are already marked, flagged as
 * assumed rather than observed. Nothing here is worth typing on its own.
 */

const REASONS = [
  "INJURY", "ILLNESS", "SCHOOL", "FAMILY", "HOLIDAY", "TRANSPORT", "OTHER",
] as const;

export function AbsencesCard({
  athleteId,
  absences,
  canRecord,
}: {
  athleteId: string;
  absences: AthleteAvailabilityExceptionRow[];
  canRecord: boolean;
}) {
  const t = useTranslations("attendance.absence");
  const tReason = useTranslations("attendance.reason");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { run, isPending } = useAction();

  const today = new Date().toISOString().slice(0, 10);
  const [adding, setAdding] = useState(false);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("ILLNESS");
  const [reportedBy, setReportedBy] = useState("");

  const invalid = endsOn < startsOn;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarOff className="size-4" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("help")}</CardDescription>
        </div>
        {canRecord && !adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="absence-from">{t("from")}</Label>
                <Input
                  id="absence-from"
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="absence-to">{t("to")}</Label>
                <Input
                  id="absence-to"
                  type="date"
                  value={endsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("reason")}</Label>
                <Select
                  value={reason}
                  onValueChange={(value) => setReason(value as (typeof REASONS)[number])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {tReason(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="absence-by">{t("reportedBy")}</Label>
                <Input
                  id="absence-by"
                  value={reportedBy}
                  placeholder={t("reportedByPlaceholder")}
                  onChange={(event) => setReportedBy(event.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAdding(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={isPending || invalid}
                onClick={() =>
                  run(
                    () =>
                      declareAbsenceAction({
                        athleteId,
                        teamId: null,
                        startsOn,
                        endsOn,
                        reason,
                        reportedBy: reportedBy || undefined,
                      }),
                    { success: () => t("saved"), onSuccess: () => setAdding(false) },
                  )
                }
              >
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tCommon("save")}
              </Button>
            </div>
          </div>
        ) : null}

        {absences.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {absences.map((absence) => {
              const over = absence.ends_on < today;
              return (
                <li key={absence.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {format.dateTime(new Date(`${absence.starts_on}T12:00:00`), {
                        day: "numeric",
                        month: "short",
                      })}
                      {absence.ends_on !== absence.starts_on
                        ? ` – ${format.dateTime(new Date(`${absence.ends_on}T12:00:00`), {
                            day: "numeric",
                            month: "short",
                          })}`
                        : ""}
                    </p>
                    {absence.reported_by ? (
                      <p className="text-xs text-muted-foreground">{absence.reported_by}</p>
                    ) : null}
                  </div>
                  <Badge variant={over ? "outline" : "secondary"}>{tReason(absence.reason)}</Badge>
                  {canRecord ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={tCommon("delete")}
                      disabled={isPending}
                      onClick={() =>
                        run(() => deleteAbsenceAction(absence.id), {
                          success: () => t("removed"),
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
