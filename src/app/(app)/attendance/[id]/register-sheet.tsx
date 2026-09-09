"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCheck,
  CircleSlash,
  Clock,
  Loader2,
  Lock,
  Save,
  ShieldQuestion,
  Star,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { saveRegisterAction } from "@/server/actions/attendance";
import type { RegisterSheet, RegisterLine } from "@/server/services/attendance-service";
import type { AttendanceStateValue } from "@/types/database";

/**
 * Marking a register, at courtside, on a phone.
 *
 * Two decisions run through this component.
 *
 * Nothing is sent until the coach presses save. Every tap changes local state
 * only — so the sheet works with no signal at all, and a gym with two bars
 * costs one request at the end rather than one per player. It is also the only
 * shape that works: Next.js dispatches Server Actions one at a time per client,
 * so sixteen taps firing sixteen actions would queue sixteen deep.
 *
 * And a match sheet is the same sheet. Picking a squad and marking who turned
 * up are the same act separated by three days, and splitting them into two
 * screens would mean the coach who opens it on Saturday cannot see what they
 * decided on Thursday.
 */

const TRAINING_STATES: { value: AttendanceStateValue; icon: typeof CheckCheck }[] = [
  { value: "PRESENT", icon: CheckCheck },
  { value: "LATE", icon: Clock },
  { value: "EXCUSED", icon: ShieldQuestion },
  { value: "ABSENT", icon: X },
];

const ABSENCE_REASONS = [
  "INJURY", "ILLNESS", "SCHOOL", "FAMILY", "HOLIDAY", "TRANSPORT", "OTHER",
] as const;

const BENCH_REASONS = [
  "COACH_DECISION", "ROTATION", "INJURY", "DISCIPLINARY", "OTHER",
] as const;

type Draft = Pick<
  RegisterLine,
  "athleteId" | "state" | "reason" | "minutesLate" | "calledUp" | "started" | "benchReason" | "note"
>;

export function RegisterSheetEditor({ sheet }: { sheet: RegisterSheet }) {
  const t = useTranslations("attendance");
  const router = useRouter();
  const { run, isPending } = useAction();

  const isMatch = sheet.register.occasion === "MATCH";
  const [lines, setLines] = useState<Draft[]>(() => sheet.lines.map(toDraft));
  const [dirty, setDirty] = useState(false);

  const byId = useMemo(
    () => new Map(sheet.lines.map((line) => [line.athleteId, line])),
    [sheet.lines],
  );

  const called = lines.filter((line) => line.calledUp).length;
  const starters = lines.filter((line) => line.started).length;
  const limit = sheet.team.callUpLimit;
  const overLimit = limit !== null && called > limit;
  const tooManyStarters = starters > 5;

  function update(athleteId: string, patch: Partial<Draft>) {
    setDirty(true);
    setLines((current) =>
      current.map((line) => (line.athleteId === athleteId ? { ...line, ...patch } : line)),
    );
  }

  /** The bulk action that makes a sixteen-player register a two-tap job. */
  function markAllPresent() {
    setDirty(true);
    setLines((current) =>
      current.map((line) => ({ ...line, state: "PRESENT", reason: null, minutesLate: null })),
    );
  }

  function save(state: "OPEN" | "RECORDED") {
    run(
      () =>
        saveRegisterAction({
          registerId: sheet.register.id,
          state,
          lines: lines.map((line) => ({
            athleteId: line.athleteId,
            state: line.state,
            reason: line.reason,
            minutesLate: line.minutesLate,
            calledUp: line.calledUp,
            started: line.started,
            benchReason: line.benchReason,
            note: line.note,
          })),
        }),
      {
        success: () => (state === "RECORDED" ? t("savedAndClosed") : t("saved")),
        onSuccess: () => {
          setDirty(false);
          router.refresh();
        },
      },
    );
  }

  const blocked = overLimit || tooManyStarters;

  return (
    <div className="space-y-4 pb-32">
      {isMatch ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("squadSelection")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant={overLimit ? "destructive" : "secondary"} className="tabular-nums">
              {limit === null ? t("calledNoLimit", { called }) : t("calledOfLimit", { called, limit })}
            </Badge>
            <Badge variant={tooManyStarters ? "destructive" : "outline"} className="tabular-nums">
              {t("startersOfFive", { starters })}
            </Badge>
            {overLimit ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <TriangleAlert className="size-4" aria-hidden />
                {t("overLimit", { limit: limit ?? 0 })}
              </span>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={markAllPresent} disabled={!sheet.editable}>
            <CheckCheck aria-hidden />
            {t("allPresent")}
          </Button>
        </div>
      )}

      <ul className="divide-y rounded-lg border">
        {lines.map((line) => {
          const info = byId.get(line.athleteId)!;
          return (
            <li key={line.athleteId} className="p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {info.jerseyNumber !== null ? (
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums">
                        {info.jerseyNumber}
                      </span>
                    ) : null}
                    <span className="truncate font-medium">{info.name}</span>
                  </div>
                  {info.position ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{info.position}</p>
                  ) : null}
                  {/* Says what the sheet assumed before anyone touched it. */}
                  {info.declaredAbsence ? (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                      {t("declaredAbsence", { reason: t(`reason.${info.declaredAbsence.reason}`) })}
                    </p>
                  ) : null}
                </div>

                {isMatch ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={line.calledUp ? "default" : "outline"}
                      disabled={!sheet.editable}
                      aria-pressed={Boolean(line.calledUp)}
                      onClick={() =>
                        update(line.athleteId, {
                          calledUp: !line.calledUp,
                          // Dropping someone from the sheet cannot leave them
                          // marked as a starter.
                          started: false,
                          benchReason: null,
                        })
                      }
                    >
                      {line.calledUp ? t("called") : t("notCalled")}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant={line.started ? "default" : "outline"}
                      disabled={!sheet.editable || !line.calledUp}
                      aria-label={t("starter")}
                      aria-pressed={Boolean(line.started)}
                      onClick={() => update(line.athleteId, { started: !line.started })}
                    >
                      <Star className={cn("size-4", line.started && "fill-current")} aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Turnout. On a match sheet this only matters for the picked. */}
              {(!isMatch || line.calledUp) ? (
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {TRAINING_STATES.map(({ value, icon: Icon }) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={line.state === value ? "default" : "outline"}
                      disabled={!sheet.editable}
                      aria-pressed={line.state === value}
                      className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-9 sm:flex-row sm:text-xs"
                      onClick={() =>
                        update(line.athleteId, {
                          state: value,
                          reason: value === "PRESENT" ? null : line.reason,
                          minutesLate: value === "LATE" ? line.minutesLate : null,
                        })
                      }
                    >
                      <Icon className="size-4" aria-hidden />
                      {t(`state.${value}`)}
                    </Button>
                  ))}
                </div>
              ) : null}

              {/* Why. Only asked once there is something to explain. */}
              {(!isMatch || line.calledUp) && line.state !== "PRESENT" ? (
                <div className="mt-2">
                  <Select
                    value={line.reason ?? ""}
                    disabled={!sheet.editable}
                    onValueChange={(value) =>
                      update(line.athleteId, { reason: value as Draft["reason"] })
                    }
                  >
                    <SelectTrigger size="sm" className="w-full sm:w-56">
                      <SelectValue placeholder={t("reasonPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {ABSENCE_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {t(`reason.${reason}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {/* Picked, turned up, never came on. */}
              {isMatch && line.calledUp && (line.state === "PRESENT" || line.state === "LATE") ? (
                <div className="mt-2">
                  <Select
                    value={line.benchReason ?? "PLAYED"}
                    disabled={!sheet.editable}
                    onValueChange={(value) =>
                      update(line.athleteId, {
                        benchReason: value === "PLAYED" ? null : (value as Draft["benchReason"]),
                      })
                    }
                  >
                    <SelectTrigger size="sm" className="w-full sm:w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLAYED">{t("played")}</SelectItem>
                      {BENCH_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {t(`didNotPlay.${reason}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Held above the fold of a phone: the coach's thumb is already down here. */}
      {sheet.editable ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:left-[var(--sidebar-width,0px)]">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {dirty ? t("unsaved") : t("upToDate")}
            </p>
            <Button variant="outline" onClick={() => save("OPEN")} disabled={isPending || blocked}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              {t("saveDraft")}
            </Button>
            <Button onClick={() => save("RECORDED")} disabled={isPending || blocked}>
              <Lock aria-hidden />
              {t("saveAndClose")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <CircleSlash className="size-4 shrink-0" aria-hidden />
          {t("readOnly")}
        </div>
      )}

      <Separator className="sr-only" />
    </div>
  );
}

function toDraft(line: RegisterLine): Draft {
  return {
    athleteId: line.athleteId,
    state: line.state,
    reason: line.reason,
    minutesLate: line.minutesLate,
    calledUp: line.calledUp,
    started: line.started,
    benchReason: line.benchReason,
    note: line.note,
  };
}
