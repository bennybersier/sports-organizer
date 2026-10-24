"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClipboardCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { openMatchRegisterAction } from "@/server/actions/attendance";

/**
 * What stands in for the squad sheet before one exists.
 *
 * A register is created the first time somebody needs it, which is the whole
 * point of it not existing by default: a row per team per session, created in
 * advance, would be a backlog of empty sheets to keep in step with a schedule
 * that is regenerated whenever the optimizer runs.
 *
 * So the button makes one here rather than sending anybody to another page to
 * do it. Uploading a game sheet does the same thing, so a club that works off
 * the photograph never has to know the word "register" at all.
 */
export function OpenSquadCard({
  eventId,
  teamId,
  canRecord,
}: {
  eventId: string;
  teamId: string;
  canRecord: boolean;
}) {
  const t = useTranslations("matches");
  const router = useRouter();
  const { run, isPending } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4" aria-hidden />
          {t("noRegister")}
        </CardTitle>
        <CardDescription>{t("noRegisterBody")}</CardDescription>
      </CardHeader>
      {canRecord ? (
        <CardContent>
          <Button
            disabled={isPending}
            onClick={() =>
              run(() => openMatchRegisterAction(eventId, teamId), {
                // Same page, now with a sheet on it.
                onSuccess: () => router.refresh(),
              })
            }
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t("pickSquad")}
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
