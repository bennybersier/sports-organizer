import { getTranslations } from "next-intl/server";
import { ShieldOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * The permission-denied state.
 *
 * Pages check their permission and render this instead of letting the service
 * throw. An AuthorizationError from a Server Component would surface through
 * the error boundary as "Something went wrong", which is both alarming and
 * untrue — nothing went wrong, the user simply isn't allowed in.
 *
 * The service still asserts the permission underneath: this is the friendly
 * face, not the control.
 */
export async function AccessDenied() {
  const t = await getTranslations("errors");

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ShieldOff className="size-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{t("forbiddenTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("forbiddenBody")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
