"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { saveResultAction } from "@/server/actions/matches";
import type { MatchResultState } from "@/types/database";
import type { MatchResultSummary } from "@/server/services/match-service";

const STATES: MatchResultState[] = ["PLAYED", "FORFEIT", "ABANDONED", "PENDING"];
/** Four quarters is basketball; a drawn match goes to overtime, not a fifth box. */
const QUARTERS = 4;

/**
 * Typing in Sunday's score.
 *
 * Ours first, always, and labelled "Us" and "Them" rather than home and away —
 * see `ScoreBadge` for the same argument. The quarters are optional because a
 * coach ringing in from the car park knows 67–59 and nothing else, but when
 * they are filled in they must add up, and the form says so on the field
 * instead of failing the save.
 */
export function ResultForm({
  eventId,
  teamId,
  result,
  editable,
}: {
  eventId: string;
  teamId: string;
  result: MatchResultSummary | null;
  editable: boolean;
}) {
  const t = useTranslations("matches");
  const { run, isPending } = useAction();

  const [state, setState] = useState<MatchResultState>(result?.state ?? "PLAYED");
  const [ourScore, setOurScore] = useState(result?.ourScore?.toString() ?? "");
  const [theirScore, setTheirScore] = useState(result?.theirScore?.toString() ?? "");
  const [ourPeriods, setOurPeriods] = useState<string[]>(
    padded(result?.ourPeriods),
  );
  const [theirPeriods, setTheirPeriods] = useState<string[]>(
    padded(result?.theirPeriods),
  );
  const [notes, setNotes] = useState(result?.notes ?? "");

  const pending = state === "PENDING";

  /*
    The quarter sums are shown live rather than only on submit. A secretary
    copying four boxes off a sheet wants to see the total agree as they type;
    being told afterwards that it does not means re-reading all four.
  */
  const ourSum = sum(ourPeriods);
  const theirSum = sum(theirPeriods);
  const ourQuartersGiven = ourPeriods.some((value) => value !== "");
  const theirQuartersGiven = theirPeriods.some((value) => value !== "");
  const ourMismatch = !pending && ourQuartersGiven && ourSum !== Number(ourScore);
  const theirMismatch = !pending && theirQuartersGiven && theirSum !== Number(theirScore);

  function submit() {
    run(
      () =>
        saveResultAction({
          eventId,
          teamId,
          state,
          ...(pending
            ? {}
            : { ourScore: Number(ourScore), theirScore: Number(theirScore) }),
          ourPeriods: ourQuartersGiven && !pending ? ourPeriods.map(Number) : undefined,
          theirPeriods: theirQuartersGiven && !pending ? theirPeriods.map(Number) : undefined,
          notes: notes.trim() || null,
        }),
      { success: () => t("resultSaved") },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("result")}</CardTitle>
        <CardDescription>{t("resultHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ourScore">{t("ourScore")}</Label>
            <Input
              id="ourScore"
              inputMode="numeric"
              className="w-20 text-center text-lg tabular-nums"
              value={ourScore}
              disabled={!editable || pending}
              onChange={(event) => setOurScore(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          <span className="pb-2.5 text-muted-foreground">–</span>
          <div className="space-y-1.5">
            <Label htmlFor="theirScore">{t("theirScore")}</Label>
            <Input
              id="theirScore"
              inputMode="numeric"
              className="w-20 text-center text-lg tabular-nums"
              value={theirScore}
              disabled={!editable || pending}
              onChange={(event) => setTheirScore(event.target.value.replace(/\D/g, ""))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("state")}</Label>
            <Select
              value={state}
              disabled={!editable}
              onValueChange={(next) => setState(next as MatchResultState)}
            >
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "PENDING" ? t("clearResult") : t(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!pending ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t("quarters")}</Label>
              <p className="text-xs text-muted-foreground">{t("quartersHint")}</p>
            </div>

            <QuarterRow
              label={t("ourQuarters")}
              values={ourPeriods}
              disabled={!editable}
              onChange={setOurPeriods}
              sum={ourSum}
              mismatch={ourMismatch}
            />
            <QuarterRow
              label={t("theirQuarters")}
              values={theirPeriods}
              disabled={!editable}
              onChange={setTheirPeriods}
              sum={theirSum}
              mismatch={theirMismatch}
            />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="notes">{t("notes")}</Label>
          <Textarea
            id="notes"
            rows={2}
            value={notes}
            disabled={!editable}
            placeholder={t("notesPlaceholder")}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        {editable ? (
          <Button
            onClick={submit}
            disabled={
              isPending ||
              ourMismatch ||
              theirMismatch ||
              (!pending && (ourScore === "" || theirScore === ""))
            }
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("saveResult")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QuarterRow({
  label,
  values,
  disabled,
  onChange,
  sum,
  mismatch,
}: {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
  sum: number;
  mismatch: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      {values.map((value, index) => (
        <Input
          key={index}
          inputMode="numeric"
          aria-label={`${label} ${index + 1}`}
          className="w-14 text-center tabular-nums"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = [...values];
            next[index] = event.target.value.replace(/\D/g, "");
            onChange(next);
          }}
        />
      ))}
      <span
        className={`text-sm tabular-nums ${mismatch ? "font-medium text-destructive" : "text-muted-foreground"}`}
      >
        = {sum}
      </span>
    </div>
  );
}

/** Four boxes, whatever the stored array holds. */
function padded(periods: number[] | null | undefined): string[] {
  const values = (periods ?? []).map((period) => period.toString());
  return Array.from({ length: Math.max(QUARTERS, values.length) }, (_, index) => values[index] ?? "");
}

function sum(values: string[]): number {
  return values.reduce((total, value) => total + (value === "" ? 0 : Number(value)), 0);
}
