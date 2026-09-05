"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { useAction } from "@/hooks/use-action";
import { useFormDialog } from "@/hooks/use-form-dialog";
import { ISO_WEEKDAYS, WEEKDAY_KEYS, type IsoWeekday } from "@/domain/availability";
import { saveTrainingRequirementAction } from "@/server/actions/availability";
import type { TrainingRequirement } from "@/server/services/training-requirement-service";

/** Abbreviated weekday names, for the summary where seven full ones do not fit. */
const WEEKDAY_SHORT_KEYS = {
  1: "monShort",
  2: "tueShort",
  3: "wedShort",
  4: "thuShort",
  5: "friShort",
  6: "satShort",
  7: "sunShort",
} as const satisfies Record<IsoWeekday, string>;

/**
 * The team's training requirements.
 *
 * The page shows them read-only and edits them in a dialog. There are two
 * dozen fields here — days, windows, gaps, halls, twice over for hard rules and
 * preferences — and inline they pushed the team's actual schedule off the
 * screen. Read is the common case; edit is a deliberate act, and gets the room
 * it needs (near enough the whole viewport) when it happens.
 *
 * Hard requirements and preferences stay visually separate in both views: that
 * distinction is the whole design of the optimizer, and an organizer reading a
 * conflict explanation later needs to already understand which is which.
 */
export function RequirementsCard({
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
  // Reopening starts from what the server last told us, so an abandoned edit
  // does not linger in the next one.
  const [open, setOpen] = useFormDialog({ onOpen: () => setValues(requirement) });

  const set = <K extends keyof TrainingRequirement>(key: K, value: TrainingRequirement[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const toggleDay = (field: "allowedWeekdays" | "preferredWeekdays", day: number) =>
    set(
      field,
      values[field].includes(day)
        ? values[field].filter((d) => d !== day)
        : [...values[field], day].sort(),
    );

  const gymNames = (ids: string[]) =>
    gyms
      .filter((gym) => ids.includes(gym.value))
      .map((gym) => gym.label)
      .join(", ");

  const dayNames = (days: number[]) =>
    days
      .map((day) => tWeekdays(WEEKDAY_SHORT_KEYS[day as IsoWeekday]))
      .join(", ");

  function save() {
    run(
      () =>
        saveTrainingRequirementAction({
          teamId: values.teamId,
          seasonId: values.seasonId,
          sessionsPerWeek: values.sessionsPerWeek,
          durationMinutes: values.durationMinutes,
          priority: values.priority,
          startsOn: values.startsOn ?? "",
          allowedWeekdays: values.allowedWeekdays,
          earliestStart: values.earliestStart,
          latestEnd: values.latestEnd,
          minDaysBetween: values.minDaysBetween,
          matchRestDays: values.matchRestDays,
          maxDaysBetween: values.maxDaysBetween ?? "",
          allowedGymIds: values.allowedGymIds,
          preferredWeekdays: values.preferredWeekdays,
          preferredStart: values.preferredStart ?? "",
          preferredEnd: values.preferredEnd ?? "",
          preferredGymIds: values.preferredGymIds,
          notes: values.notes ?? "",
        }),
      { success: () => t("saved"), onSuccess: () => setOpen(false) },
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
    key: "sessionsPerWeek" | "durationMinutes" | "minDaysBetween" | "matchRestDays",
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

  /** One read-only fact on the summary card. */
  const fact = (label: string, value: string) => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value || tCommon("none")}</dd>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Pencil aria-hidden />
              {canEdit ? tCommon("edit") : tCommon("view")}
            </Button>
          </DialogTrigger>

          {/*
            Deliberately near-full-screen: the form is two dozen controls in two
            groups, and at dialog width they wrap into a column so long that the
            hard rules and the preferences can never be seen together.
          */}
          <DialogContent className="grid-rows-[auto_1fr_auto] gap-0 overflow-hidden p-0 h-[90dvh] max-h-[90dvh] w-[90vw] max-w-[90vw] sm:max-w-[90vw]">
            <DialogHeader className="border-b p-4">
              <DialogTitle className="flex items-center gap-2">
                <Target className="size-4" aria-hidden />
                {t("title")}
              </DialogTitle>
              <DialogDescription>{t("subtitle")}</DialogDescription>
            </DialogHeader>

            {/*
              Side by side once there is room for it. The two groups are read
              against each other — "allowed Monday to Friday, prefer Tuesday and
              Thursday" is one thought — and stacking them puts a scroll between
              the halves of it.
            */}
            <div className="min-h-0 overflow-y-auto p-4">
              <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-4">
                <h3 className="text-sm font-medium">{t("hard")}</h3>

                <div className="grid gap-4 sm:grid-cols-3">
                  {number("sessionsPerWeek", t("sessionsPerWeek"), 0, 14)}
                  {number("durationMinutes", t("durationMinutes"), 15, 480, t("minutes"))}
                  {number("minDaysBetween", t("minDaysBetween"), 0, 7)}
                </div>

                {/*
                  The match day itself is always kept clear, so zero here is a
                  real answer and the common one: a minibasket group plays on
                  Saturday morning and trains that afternoon quite happily.
                */}
                <div className="grid gap-1">
                  <div className="sm:max-w-48">
                    {number("matchRestDays", t("matchRestDays"), 0, 3)}
                  </div>
                  <p className="text-muted-foreground text-xs">{t("matchRestDaysHint")}</p>
                </div>

                {/*
                  Priority decides who wins a contested slot, so it belongs with
                  the hard rules rather than the preferences — it is a club
                  decision, not a nudge the optimizer may trade away.
                */}
                <div className="grid gap-1 sm:max-w-xs">
                  <Label htmlFor="priority">{t("priority")}</Label>
                  <Select
                    value={String(values.priority)}
                    disabled={!canEdit}
                    onValueChange={(value) => set("priority", Number(value))}
                  >
                    <SelectTrigger id="priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((level) => (
                        <SelectItem key={level} value={String(level)}>
                          {t(`priority${level}` as "priority1")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("priorityHint")}</p>
                </div>

                {/*
                  Teams do not all start on the same day — a first team may be
                  back in August while a youth side waits for the school term.
                  Empty means "start when the schedule does".
                */}
                <div className="grid gap-1 sm:max-w-xs">
                  <Label htmlFor="startsOn">{t("startsOn")}</Label>
                  <Input
                    id="startsOn"
                    type="date"
                    value={values.startsOn ?? ""}
                    disabled={!canEdit}
                    onChange={(event) => set("startsOn", event.target.value || null)}
                  />
                  <p className="text-xs text-muted-foreground">{t("startsOnHint")}</p>
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

              <section className="space-y-4 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
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
              </div>
            </div>

            <DialogFooter className="mx-0 mb-0">
              <DialogClose asChild>
                <Button variant="outline">{tCommon("cancel")}</Button>
              </DialogClose>
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fact(t("sessionsPerWeek"), String(requirement.sessionsPerWeek))}
          {fact(t("durationMinutes"), `${requirement.durationMinutes} ${t("minutes")}`)}
          {fact(t("priority"), t(`priority${requirement.priority}` as "priority1"))}
          {fact(t("startsOn"), requirement.startsOn ?? "—")}
          {fact(t("allowedWeekdays"), dayNames(requirement.allowedWeekdays))}
          {fact(t("window"), `${requirement.earliestStart} – ${requirement.latestEnd}`)}
          {fact(t("minDaysBetween"), String(requirement.minDaysBetween))}
          {fact(t("matchRestDays"), String(requirement.matchRestDays))}
          {fact(t("allowedGyms"), gymNames(requirement.allowedGymIds))}
        </dl>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("soft")}</h3>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fact(t("preferredWeekdays"), dayNames(requirement.preferredWeekdays))}
            {fact(
              t("window"),
              requirement.preferredStart && requirement.preferredEnd
                ? `${requirement.preferredStart} – ${requirement.preferredEnd}`
                : "",
            )}
            {fact(t("preferredGyms"), gymNames(requirement.preferredGymIds))}
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
