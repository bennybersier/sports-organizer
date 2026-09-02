import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarSync, Sparkles } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { env } from "@/env";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAiConfigs } from "@/server/services/ai-config-service";

import { AiProviderList } from "./ai-provider-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("title") };
}

export default async function IntegrationsPage() {
  const context = await requireAuthContext();
  if (!hasPermission(context, "integrations.read")) return <AccessDenied />;

  const t = await getTranslations("integrations");

  const canReadAi = hasPermission(context, "ai.read");
  const configs = canReadAi ? await listAiConfigs(context) : [];

  // Google is a deployment-level capability: without credentials in the
  // environment, no club can connect, and saying so is more useful than
  // showing a button that fails.
  const googleConfigured = Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET,
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {canReadAi ? (
        <AiProviderList
          configs={configs}
          canManage={hasPermission(context, "ai.manage")}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarSync className="size-4" aria-hidden />
            {t("google")}
          </CardTitle>
          <CardDescription>{t("googleSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {googleConfigured ? (
            <p className="text-sm text-muted-foreground">{t("notConnected")}</p>
          ) : (
            <Alert>
              <Sparkles aria-hidden />
              <AlertDescription>
                <strong>{t("googleNotConfigured")}</strong>
                <br />
                {t("googleNotConfiguredBody")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
