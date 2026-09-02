"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Target } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { useAction } from "@/hooks/use-action";
import { ISO_WEEKDAYS, WEEKDAY_KEYS } from "@/domain/availability";
import { saveTrainingRequirementAction } from "@/server/actions/availability";
import type { TrainingRequirement } from "@/server/services/training-requirement-service";

/**
 * The team's training requirements.
 *
 * Split into two visually distinct groups on purpose: hard requirements the
 * schedule must satisfy, and preferences it should try to. That distinction is
 * the whole design of the optimizer, and an organizer reading conflict
 * explanations later needs to already understand which is which.
 */
export function RequirementsForm({
  requirement,
  gyms,
  canEdit,
}: {
  requirement: TrainingRequirement;
  gyms: MultiSelectOption[];
  canEdit: boolean;
}) {
  const t = useTranslations("requirements");
  const tCommon = useTranslations("common");
  const tWeekdays = useTranslations("weekdays");
  const { run, isPending } = useAction();

  const [values, setValues] = useState(requirement);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof TrainingRequirement>(key: K, value: TrainingRequirement[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const toggleDay = (field: "allowedWeekdays" | "preferredWeekdays", day: number) =>
    set(
      field,
      values[field].includes(day)
        ? values[field].filter((d) => d !== day)
        : [...values[field], day].sort(),
    );

  function save() {
    setError(null);
    run(
      () =>
        saveTrainingRequirementAction({
          teamId: values.teamId,
          seasonId: values.seasonId,
          sessionsPerWeek: values.sessionsPerWeek,
          durationMinutes: values.durationMinutes,
          allowedWeekdays: values.allowedWeekdays,
          earliestStart: values.earliestStart,
          latestEnd: values.latestEnd,
          minDaysBetween: values.minDaysBetween,
          maxDaysBetween: values.maxDaysBetween ?? "",
          allowedGymIds: values.allowedGymIds,
          preferredWeekdays: values.preferredWeekdays,
          preferredStart: values.preferredStart ?? "",
          preferredEnd: values.preferredEnd ?? "",
          preferredGymIds: values.preferredGymIds,
          notes: values.notes ?? "",
        }),
      { success: () => t("saved") },
    );
  }

  const dayCheckboxes = (field: "allowedWeekdays" | "preferredWeekdays") => (
    <div className="flex flex-wrap gap-3">
      {ISO_WEEKDAYS.map((day) => (
        <div key={day} className="flex items-center gap-1.5">
          <Checkbox
            id={`${field}-${day}`}
            checked={values[field].includes(day)}
            disabled={!canEdit}
            onCheckedChange={() => toggleDay(field, day)}
          />
          <Label htmlFor={`${field}-${day}`} className="font-normal">
            {tWeekdays(WEEKDAY_KEYS[day])}
          </Label>
        </div>
      ))}
    </div>
  );

  const number = (
    key: "sessionsPerWeek" | "durationMinutes" | "minDaysBetween",
    label: string,
    min: number,
    max: number,
    suffix?: string,
  ) => (
    <div className="grid gap-1">
      <Label htmlFor={key}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={key}
          type="number"
          min={min}
          max={max}
          disabled={!canEdit}
          value={values[key]}
          onChange={(event) => set(key, Number(event.target.value))}
          className="w-24"
        />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-4">
          <h3 className="text-sm font-medium">{t("hard")}</h3>

          <div className="grid gap-4 sm:grid-cols-3">
            {number("sessionsPerWeek", t("sessionsPerWeek"), 0, 14)}
            {number("durationMinutes", t("durationMinutes"), 15, 480, t("minutes"))}
            {number("minDaysBetween", t("minDaysBetween"), 0, 7)}
          </div>

          <div className="grid gap-1">
            <Label>{t("allowedWeekdays")}</Label>
            {dayCheckboxes("allowedWeekdays")}
            <p className="text-xs text-muted-foreground">{t("allowedWeekdaysHint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="earliestStart">{t("earliestStart")}</Label>
              <Input
                id="earliestStart"
                type="time"
                disabled={!canEdit}
                value={values.earliestStart}
                onChange={(event) => set("earliestStart", event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="latestEnd">{t("latestEnd")}</Label>
              <Input
                id="latestEnd"
                type="time"
                disabled={!canEdit}
                value={values.latestEnd}
                onChange={(event) => set("latestEnd", event.target.value)}
              />
            </div>
          </div>

          {gyms.length > 0 ? (
            <div className="grid gap-1">
              <Label>{t("allowedGyms")}</Label>
              <MultiSelect
                options={gyms}
                value={values.allowedGymIds}
                onChange={(next) => set("allowedGymIds", next)}
                placeholder={t("allowedGyms")}
                emptyText={tCommon("none")}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">{t("allowedGymsHint")}</p>
            </div>
          ) : null}
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-sm font-medium">{t("soft")}</h3>

          <div className="grid gap-1">
            <Label>{t("preferredWeekdays")}</Label>
            {dayCheckboxes("preferredWeekdays")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="preferredStart">{t("preferredStart")}</Label>
              <Input
                id="preferredStart"
                type="time"
                disabled={!canEdit}
                value={values.preferredStart ?? ""}
                onChange={(event) => set("preferredStart", event.target.value || null)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="preferredEnd">{t("preferredEnd")}</Label>
              <Input
                id="preferredEnd"
                type="time"
                disabled={!canEdit}
                value={values.preferredEnd ?? ""}
                onChange={(event) => set("preferredEnd", event.target.value || null)}
              />
            </div>
          </div>

          {gyms.length > 0 ? (
            <div className="grid gap-1">
              <Label>{t("preferredGyms")}</Label>
              <MultiSelect
                options={gyms}
                value={values.preferredGymIds}
                onChange={(next) => set("preferredGymIds", next)}
                placeholder={t("preferredGyms")}
                emptyText={tCommon("none")}
                disabled={!canEdit}
              />
            </div>
          ) : null}
        </section>

        {canEdit ? (
          <Button onClick={save} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                {tCommon("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
