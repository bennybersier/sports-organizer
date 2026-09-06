"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleSlash, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { cancelRegisterAction, reopenRegisterAction } from "@/server/actions/attendance";
import type { RegisterState } from "@/types/database";

/**
 * The two things you do to a register that are not marking it.
 *
 * Both are deliberately behind a confirmation. "This session did not happen"
 * removes the whole squad's session from every percentage in the club, and
 * reopening a closed register edits history — neither is a thing to do with a
 * stray tap on a phone held in one hand at courtside.
 */
export function RegisterStateActions({
  registerId,
  state,
  canRecord,
  canManage,
}: {
  registerId: string;
  state: RegisterState;
  canRecord: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { run, isPending } = useAction();

  if (state === "RECORDED" || state === "CANCELLED") {
    if (!canManage) return null;
    return (
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() => run(() => reopenRegisterAction(registerId))}
      >
        <RotateCcw aria-hidden />
        {t("reopen")}
      </Button>
    );
  }

  if (!canRecord) return null;

  return (
    <>
      <Button variant="outline" disabled={isPending} onClick={() => setConfirmOpen(true)}>
        <CircleSlash aria-hidden />
        {t("cancelSession")}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("cancelSession")}
        description={t("cancelConfirmBody")}
        confirmLabel={tCommon("confirm")}
        onConfirm={() => run(() => cancelRegisterAction(registerId, null))}
      />
    </>
  );
}
