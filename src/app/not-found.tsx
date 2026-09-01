import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("notFoundBody")}
      </p>
      <Button asChild>
        <Link href="/dashboard">{t("backToDashboard")}</Link>
      </Button>
    </div>
  );
}
