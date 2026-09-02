"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

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
import { ISO_WEEKDAYS, WEEKDAY_KEYS } from "@/domain/availability";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { updateClubAction } from "@/server/actions/settings";

/** Timezones a European club is realistically in, plus UTC. */
const TIMEZONES = [
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/London",
  "Europe/Vienna",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Lisbon",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "UTC",
];

export function ClubSettingsForm({
  club,
}: {
  club: { name: string; slug: string; timezone: string; locale: string; weekStart: number };
}) {
  const t = useTranslations("settings");
  const tWeekdays = useTranslations("weekdays");
  const { run, isPending } = useAction();

  const [name, setName] = useState(club.name);
  const [timezone, setTimezone] = useState(club.timezone);
  const [locale, setLocale] = useState(club.locale);
  const [weekStart, setWeekStart] = useState(String(club.weekStart));

  // The club's own timezone must remain selectable even if it isn't on the list.
  const zones = TIMEZONES.includes(club.timezone) ? TIMEZONES : [club.timezone, ...TIMEZONES];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("club")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-1">
          <Label htmlFor="club-name">{t("clubName")}</Label>
          <Input id="club-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className="grid gap-1">
          <Label htmlFor="club-slug">{t("urlName")}</Label>
          {/* Read-only: the slug appears in invitation links that may already
              be in someone's inbox. */}
          <Input id="club-slug" readOnly disabled value={club.slug} className="font-mono text-sm" />
        </div>

        <div className="grid gap-1">
          <Label htmlFor="club-timezone">{t("timezone")}</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="club-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("timezoneHint")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="club-locale">{t("locale")}</Label>
            <Select value={locale} onValueChange={setLocale}>
              <SelectTrigger id="club-locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {LOCALE_NAMES[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="club-weekstart">{t("weekStart")}</Label>
            <Select value={weekStart} onValueChange={setWeekStart}>
              <SelectTrigger id="club-weekstart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISO_WEEKDAYS.map((day) => (
                  <SelectItem key={day} value={String(day)}>
                    {tWeekdays(WEEKDAY_KEYS[day])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          disabled={isPending}
          onClick={() =>
            run(() => updateClubAction({ name, timezone, locale, weekStart }), {
              success: () => t("saved"),
            })
          }
        >
          {isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              {t("save")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
