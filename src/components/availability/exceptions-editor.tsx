"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarOff, Plus, Trash2 } from "lucide-react";

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
import { createExceptionAction, deleteExceptionAction } from "@/server/actions/availability";
import type { AvailabilityExceptionRecord } from "@/server/services/availability-service";

/**
 * Date-specific exceptions.
 *
 * Two kinds, deliberately both offered: a closure that removes time, and an
 * override that adds time the weekly pattern doesn't include. Recurring
 * availability is never the only source of truth.
 */
export function ExceptionsEditor({
  domain,
  ownerId,
  exceptions,
  canEdit,
}: {
  domain: "gym" | "trainer" | "team";
  ownerId: string;
  exceptions: AvailabilityExceptionRecord[];
  canEdit: boolean;
}) {
  const t = useTranslations("availability");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { run, isPending } = useAction();

  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState("");
  const [type, setType] = useState<"UNAVAILABLE" | "AVAILABLE_OVERRIDE">("UNAVAILABLE");
  const [wholeDay, setWholeDay] = useState(true);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarOff className="size-4" aria-hidden />
          {t("exceptionsTitle")}
        </CardTitle>
        <CardDescription>{t("exceptionsSubtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {exceptions.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground">{t("noExceptions")}</p>
        ) : null}

        {exceptions.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {exceptions.map((exception) => (
              <li key={exception.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="text-sm font-medium tabular-nums">
                  {format.dateTime(new Date(`${exception.exceptionDate}T00:00:00`), {
                    dateStyle: "medium",
                  })}
                </span>
                <Badge variant={exception.type === "UNAVAILABLE" ? "destructive" : "secondary"}>
                  {t(exception.type)}
                </Badge>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {exception.startTime && exception.endTime
                    ? `${exception.startTime}–${exception.endTime}`
                    : t("wholeDay")}
                </span>
                {exception.reason ? (
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {exception.reason}
                  </span>
                ) : null}
                {canEdit ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-8"
                    disabled={isPending}
                    aria-label={`${tCommon("remove")}: ${exception.exceptionDate}`}
                    onClick={() =>
                      run(() => deleteExceptionAction(domain, exception.id, ownerId), {
                        success: () => t("exceptionRemoved"),
                      })
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {adding ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="exception-date">{t("date")}</Label>
              <Input
                id="exception-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>

            <div className="grid gap-1">
              <Label htmlFor="exception-type">{t("type")}</Label>
              <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                <SelectTrigger id="exception-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNAVAILABLE">{t("UNAVAILABLE")}</SelectItem>
                  <SelectItem value="AVAILABLE_OVERRIDE">{t("AVAILABLE_OVERRIDE")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="exception-scope">{t("wholeDay")}</Label>
              <Select
                value={wholeDay ? "whole" : "part"}
                onValueChange={(value) => setWholeDay(value === "whole")}
              >
                <SelectTrigger id="exception-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whole">{t("wholeDay")}</SelectItem>
                  <SelectItem value="part">{t("partOfDay")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!wholeDay ? (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="exception-start">{t("from")}</Label>
                  <Input
                    id="exception-start"
                    type="time"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="exception-end">{t("to")}</Label>
                  <Input
                    id="exception-end"
                    type="time"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </div>
              </>
            ) : null}

            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="exception-reason">{t("reason")}</Label>
              <Input
                id="exception-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <div className="flex gap-2 sm:col-span-2">
              <Button
                disabled={isPending || !date}
                onClick={() =>
                  run(
                    () =>
                      createExceptionAction({
                        domain,
                        ownerId,
                        exceptionDate: date,
                        type,
                        startTime: wholeDay ? "" : start,
                        endTime: wholeDay ? "" : end,
                        reason,
                      }),
                    {
                      success: () => t("exceptionAdded"),
                      onSuccess: () => {
                        setAdding(false);
                        setDate("");
                        setReason("");
                      },
                    },
                  )
                }
              >
                {tCommon("add")}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                {tCommon("cancel")}
              </Button>
            </div>
          </div>
        ) : canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("addException")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
