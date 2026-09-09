"use client";

import { useTranslations } from "next-intl";

import { fromMinutes } from "@/domain/availability";

/**
 * Turns an engine finding into a sentence.
 *
 * The engine deals in codes and numbers — weekday 4, minute 1200 — because the
 * same finding has to read correctly in English and Italian. Formatting them
 * is the UI's job, and doing it in one place keeps the calendar's conflict
 * list and the organizer's shortfall list saying the same thing.
 */
const WEEKDAY_KEYS = [
  "",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** Fields carrying minutes since midnight rather than a plain number. */
const TIME_FIELDS = new Set([
  "gymFrom",
  "gymUntil",
  "trainerFrom",
  "trainerUntil",
  "from",
  "until",
]);

/** Matches the empty branch of the `select` in every message that names a team. */
const NO_TEAM = "__none__";

export function useFindingText() {
  const t = useTranslations("conflicts");
  const tWeekdays = useTranslations("weekdays");

  return (code: string, values?: Record<string, string | number>) => {
    const formatted: Record<string, string | number> = {};

    /*
      An ICU `select` with only an `other` branch always matches it, so a
      message reading "{team, select, other { with {team}}}" printed "with ."
      whenever the clashing team had no name — which is every shortfall the
      optimizer reports, because it counts candidates rather than naming a
      side. The catalogues now carry a `__none__` branch, and the absence of a
      value is turned into that token here rather than at each call site.
    */
    if (!values?.team) formatted.team = NO_TEAM;

    for (const [key, value] of Object.entries(values ?? {})) {
      if (key === "team" && (value === "" || value === undefined)) {
        formatted.team = NO_TEAM;
        continue;
      }
      if (key === "weekday" && typeof value === "number") {
        formatted[key] = tWeekdays(
          WEEKDAY_KEYS[value] as Exclude<(typeof WEEKDAY_KEYS)[number], "">,
        );
      } else if (TIME_FIELDS.has(key) && typeof value === "number") {
        formatted[key] = fromMinutes(value);
      } else {
        formatted[key] = value;
      }
    }

    /*
      The code is only known at runtime, so the key cannot be checked against
      the catalogue here. Every FindingCode is required to have a key in this
      namespace, and the calendar's conflict list — which passes a typed
      FindingCode — is what enforces that at build time.

      Values are interpolated by ICU; a missing one degrades to the base
      sentence rather than showing a raw placeholder.
    */
    const translate = t as unknown as (
      key: string,
      values?: Record<string, string | number>,
    ) => string;

    return translate(code, { team: "", expected: 0, actual: 0, ...formatted });
  };
}
