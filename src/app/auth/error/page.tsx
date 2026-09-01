import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const REASON_KEYS = {
  missing_code: "errorMissingCode",
  exchange_failed: "errorExchangeFailed",
  access_denied: "errorAccessDenied",
} as const;

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const t = await getTranslations("auth");
  const tApp = await getTranslations("app");
  const key = reason && reason in REASON_KEYS
    ? REASON_KEYS[reason as keyof typeof REASON_KEYS]
    : null;
  const message = key ? t(key) : t("signInFailedBody");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        {tApp("name")}
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-5" aria-hidden />
          </div>
          <CardTitle>{t("signInFailed")}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">{t("backToSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
