"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import {
  openMatchRegisterAction,
  openTrainingRegisterAction,
} from "@/server/actions/attendance";

/**
 * Opens a sheet, or continues one already open.
 *
 * Opening is idempotent server-side, so two coaches tapping the same session
 * land on the same register rather than creating two — which is why this can be
 * a plain button with no optimistic guard around it.
 */
export function OpenRegisterButton({
  registerId,
  scheduleEntryId,
  eventId,
  teamId,
  label,
}: {
  registerId: string | null;
  scheduleEntryId: string | null;
  eventId: string | null;
  teamId: string;
  /** "Pick squad" before a match reads better than "Mark". */
  label?: "pickSquad";
}) {
  const t = useTranslations("attendance");
  const router = useRouter();
  const { run, isPending } = useAction();

  if (registerId) {
    return (
      <Button size="sm" variant="secondary" asChild>
        <Link href={`/attendance/${registerId}`}>{t("continueRegister")}</Link>
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      disabled={isPending}
      onClick={() =>
        run(
          () =>
            scheduleEntryId
              ? openTrainingRegisterAction(scheduleEntryId)
              : openMatchRegisterAction(eventId!, teamId),
          { onSuccess: (data) => router.push(`/attendance/${data.registerId}`) },
        )
      }
    >
      {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <PenLine aria-hidden />}
      {t(label ?? "openRegister")}
    </Button>
  );
}
