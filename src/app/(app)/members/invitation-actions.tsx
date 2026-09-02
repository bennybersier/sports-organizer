"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { revokeInvitationAction } from "@/server/actions/members";

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const t = useTranslations("members");
  const { run, isPending } = useAction();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        run(() => revokeInvitationAction(invitationId), { success: () => t("revoked") })
      }
    >
      <X aria-hidden />
      {t("revoke")}
    </Button>
  );
}
