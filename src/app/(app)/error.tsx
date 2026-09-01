"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Error boundary for the app shell.
 *
 * Renders only a generic message: the real error is already on the server logs,
 * and its text may contain database or provider detail the user must not see.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  const tCommon = useTranslations("common");

  useEffect(() => {
    console.error("[app] render error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md items-center justify-center py-16">
      <Card className="w-full">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="size-5" aria-hidden />
          </div>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>
            {t("pageBody")}
            {error.digest ? (
              <span className="mt-2 block font-mono text-xs">
                {t("reference", { digest: error.digest })}
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={reset}>
            <RotateCw aria-hidden />
            {tCommon("tryAgain")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
