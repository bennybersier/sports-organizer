import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, ChevronRight, Circle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { getOnboardingSteps } from "@/server/services/onboarding-service";
import { cn } from "@/lib/utils";

import { ClubSettingsForm } from "./club-settings-form";
import { ProfileSettingsForm } from "./profile-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const context = await requireAuthContext();
  if (!hasPermission(context, "tenant.read")) return <AccessDenied />;

  const t = await getTranslations("settings");
  const steps = await getOnboardingSteps(context);
  const done = steps.filter((step) => step.done).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {done < steps.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("onboardingTitle")}</CardTitle>
            <CardDescription>{t("onboardingBody")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Progress value={(done / steps.length) * 100} className="flex-1" />
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {t("stepsDone", { done, total: steps.length })}
              </span>
            </div>

            <ul className="divide-y rounded-lg border">
              {steps.map((step) => (
                <li key={step.key}>
                  <Link
                    href={step.href}
                    className="flex items-center gap-3 p-3 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {step.done ? (
                      <Check
                        className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className={cn("flex-1 text-sm", step.done && "text-muted-foreground")}>
                      {t(step.key as "stepSeason")}
                    </span>
                    <span className="sr-only">{step.done ? "done" : "to do"}</span>
                    {!step.done ? (
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {hasPermission(context, "tenant.update") ? (
        <ClubSettingsForm
          club={{
            name: context.tenant.name,
            slug: context.tenant.slug,
            timezone: context.tenant.timezone,
            locale: context.tenant.locale,
            weekStart: context.tenant.weekStart,
          }}
        />
      ) : null}

      <ProfileSettingsForm
        profile={{
          fullName: context.user.fullName ?? "",
          email: context.user.email,
          timezone: context.user.timezone,
        }}
      />
    </div>
  );
}
