"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, PartyPopper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitation } from "@/server/actions/auth";

export function AcceptInvitationForm({
  token,
  tenantName,
  roleName,
}: {
  token: string;
  tenantName: string;
  roleName: string;
}) {
  const router = useRouter();
  const t = useTranslations("invitation");
  const tErrors = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation({ token });
      if (!result.ok) {
        setError(result.error.message || tErrors(result.error.code));
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <PartyPopper className="size-5" aria-hidden />
        </div>
        <CardTitle className="text-xl">{t("join", { club: tenantName })}</CardTitle>
<CardDescription>{t("invitedAs", { role: roleName })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="w-full" onClick={accept} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              {t("joining")}
            </>
          ) : (
            t("accept")
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
