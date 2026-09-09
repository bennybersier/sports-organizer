"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Download, Loader2, Printer, Swords } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { downloadCsv, slugForFile, toCsv, type CsvColumn } from "@/lib/csv";
import { generateFixturesAction, scheduleFixtureAction } from "@/server/actions/competitions";

export interface FixtureRowView {
  id: string;
  matchday: number;
  opponent: string | null;
  isHome: boolean | null;
  venue: string | null;
  /** Club-local date and time, already formatted on the server. */
  date: string | null;
  time: string | null;
  durationMinutes: number;
}

/**
 * The matches, one row per matchday.
 *
 * Undated is the normal state for most of a season, so it is shown plainly
 * rather than as something missing. Giving a fixture a date puts it on the
 * calendar immediately — that is what makes it block the team and hold the
 * hall — so the dialog says as little as possible and does the rest.
 */
export function FixturesCard({
  competitionId,
  fixtures,
  canGenerate,
  canEdit,
  format,
  competitionName,
  printHeading,
}: {
  competitionId: string;
  fixtures: FixtureRowView[];
  canGenerate: boolean;
  canEdit: boolean;
  format: string;
  competitionName: string;
  printHeading: {
    club: string;
    competition: string;
    team: string;
    phase: string | null;
    printedOn: string;
  };
}) {
  const t = useTranslations("competitions");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [editing, setEditing] = useState<FixtureRowView | null>(null);
  const [scope, setScope] = useState<"all" | "home" | "away">("all");

  /*
    One list, filtered once. What is on screen is what leaves in the file and
    what comes out of the printer — an export that quietly disagreed with the
    table would be the kind of bug nobody reports, they just retype it.
  */
  const shown = fixtures.filter((fixture) =>
    scope === "all" ? true : scope === "home" ? fixture.isHome === true : fixture.isHome === false,
  );

  const dated = shown.filter((fixture) => fixture.date !== null).length;

  function exportCsv() {
    const columns: CsvColumn<FixtureRowView>[] = [
      { header: t("matchday"), value: (fixture) => fixture.matchday },
      { header: t("date"), value: (fixture) => fixture.date },
      { header: t("startTime"), value: (fixture) => fixture.time },
      {
        header: t("homeAway"),
        value: (fixture) => (fixture.isHome === null ? "" : t(fixture.isHome ? "home" : "away")),
      },
      { header: t("opponent"), value: (fixture) => fixture.opponent },
      { header: t("venue"), value: (fixture) => fixture.venue },
    ];

    downloadCsv(`${slugForFile(competitionName)}-${scope}`, toCsv(shown, columns));
  }

  return (
    <Card className="print:border-0 print:shadow-none">
      {/*
        Only the printer sees this. The screen already says what competition
        this is, in the page header above; a sheet of paper carries none of
        that context with it and has to say so itself.
      */}
      <div className="hidden print:block">
        <p className="text-xs uppercase tracking-wide">{printHeading.club}</p>
        <h1 className="mt-1 text-xl font-semibold">{printHeading.competition}</h1>
        <p className="mt-0.5 text-sm">
          {printHeading.team}
          {printHeading.phase ? ` · ${printHeading.phase}` : ""}
          {` · ${t(scope === "all" ? "scopeAll" : scope)}`}
        </p>
        <p className="mt-2 text-xs">
          {t("dated", { dated, total: shown.length })} · {printHeading.printedOn}
        </p>
        <hr className="mt-3 mb-1" />
      </div>

      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 print:hidden">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Swords className="size-4" aria-hidden />
            {t("fixturesCard")}
          </CardTitle>
          <CardDescription>
            {fixtures.length > 0
              ? t("dated", { dated, total: shown.length })
              : t("noFixtures")}
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-1 print:hidden">
          {/* The filter is the export scope as well, so there is one thing to
              get right rather than a menu of six. */}
          {(["all", "home", "away"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={scope === option ? "secondary" : "ghost"}
              onClick={() => setScope(option)}
              aria-pressed={scope === option}
            >
              {t(option === "all" ? "scopeAll" : option)}
            </Button>
          ))}

          {fixtures.length > 0 ? (
            <>
              <Button size="sm" variant="ghost" onClick={exportCsv}>
                <Download aria-hidden />
                {t("exportCsv")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                <Printer aria-hidden />
                {t("print")}
              </Button>
            </>
          ) : null}
        </div>

        {canGenerate && fixtures.length === 0 && format === "LEAGUE" ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => generateFixturesAction({ competitionId }), {
                success: (data) => t("generated", { fixtures: data.fixtures }),
              })
            }
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t("generate")}
          </Button>
        ) : null}
      </CardHeader>

      {shown.length > 0 ? (
        <CardContent className="overflow-x-auto p-0 sm:px-6 print:overflow-visible print:px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t("matchday")}</TableHead>
                <TableHead>{t("opponent")}</TableHead>
                <TableHead>{t("date")}</TableHead>
                {canEdit ? (
                  <TableHead className="text-right print:hidden">{tCommon("actions")}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((fixture) => (
                <TableRow key={fixture.id}>
                  <TableCell data-label={t("matchday")} className="tabular-nums">
                    {fixture.matchday}
                  </TableCell>
                  <TableCell variant="primary">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{fixture.opponent ?? t("tbc")}</span>
                      {fixture.isHome === null ? null : (
                        <Badge variant={fixture.isHome ? "secondary" : "outline"}>
                          {t(fixture.isHome ? "home" : "away")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-label={t("date")} className="whitespace-nowrap">
                    {fixture.date ? (
                      <>
                        {fixture.date}
                        {fixture.time ? (
                          <span className="text-muted-foreground"> · {fixture.time}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("notDated")}</span>
                    )}
                  </TableCell>
                  {canEdit ? (
                    <TableCell variant="actions" className="text-right print:hidden">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("setDate")}
                        title={t("setDate")}
                        onClick={() => setEditing(fixture)}
                      >
                        <CalendarPlus aria-hidden />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}

      {editing ? (
        <ScheduleDialog
          fixture={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) =>
            run(() => scheduleFixtureAction(payload), {
              success: (data) => t(data.dated ? "dateSaved" : "dateCleared"),
              onSuccess: () => setEditing(null),
            })
          }
          pending={isPending}
        />
      ) : null}
    </Card>
  );
}

function ScheduleDialog({
  fixture,
  onClose,
  onSave,
  pending,
}: {
  fixture: FixtureRowView;
  onClose: () => void;
  onSave: (payload: {
    id: string;
    date: string;
    startTime: string;
    durationMinutes: number;
  }) => void;
  pending: boolean;
}) {
  const t = useTranslations("competitions");
  const tCommon = useTranslations("common");
  const [date, setDate] = useState(fixture.date ?? "");
  const [time, setTime] = useState(fixture.time ?? "18:00");
  const [duration, setDuration] = useState(String(fixture.durationMinutes));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("matchday")} {fixture.matchday} · {fixture.opponent ?? t("tbc")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label htmlFor="fixture-date">{t("date")}</Label>
            <Input
              id="fixture-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1">
              <Label htmlFor="fixture-time">{t("startTime")}</Label>
              <Input
                id="fixture-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fixture-duration">{t("duration")}</Label>
              <Input
                id="fixture-duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          {/* Clearing the date is how a fixture comes off the calendar again. */}
          <Button
            variant="outline"
            disabled={pending || !fixture.date}
            onClick={() => onSave({ id: fixture.id, date: "", startTime: "", durationMinutes: 120 })}
          >
            {t("clearDate")}
          </Button>
          <Button
            disabled={pending || !date}
            onClick={() =>
              onSave({
                id: fixture.id,
                date,
                startTime: time,
                durationMinutes: Number(duration) || 120,
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
