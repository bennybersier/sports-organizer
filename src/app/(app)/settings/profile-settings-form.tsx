"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { updateProfileAction } from "@/server/actions/settings";

export function ProfileSettingsForm({
  profile,
}: {
  profile: { fullName: string; email: string; timezone: string };
}) {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();

  const [fullName, setFullName] = useState(profile.fullName);
  const [timezone, setTimezone] = useState(profile.timezone);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("yourAccount")}</CardTitle>
        <CardDescription>{profile.email}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-1">
          <Label htmlFor="profile-name">{t("yourName")}</Label>
          <Input
            id="profile-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>

        <div className="grid gap-1">
          <Label htmlFor="profile-timezone">{t("yourTimezone")}</Label>
          <Input
            id="profile-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Europe/Zurich"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {tCommon("language")}: {t("yourLanguage")} \u2014 {tCommon("accountMenu")}
        </p>

        <Button
          disabled={isPending}
          onClick={() =>
            run(() => updateProfileAction({ fullName, timezone }), {
              success: () => t("accountSaved"),
            })
          }
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t("save")}
        </Button>
      </CardContent>
    </Card>
  );
}
