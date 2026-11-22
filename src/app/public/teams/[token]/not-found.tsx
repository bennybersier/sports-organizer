import { getTranslations } from "next-intl/server";
import { LinkIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Revoked, mistyped, or the team has gone: the same answer for all three, so
 * a stranger probing links learns nothing from which it was.
 */
export default async function PublicTeamNotFound() {
  const t = await getTranslations("publicTeam");

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LinkIcon className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-bold">{t("goneTitle")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("goneBody")}</p>
      </CardContent>
    </Card>
  );
}
