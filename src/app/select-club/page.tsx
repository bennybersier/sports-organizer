import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, getMemberships } from "@/server/auth/context";

import { ClubPicker } from "./club-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("selectClub");
  return { title: t("title") };
}

export default async function SelectClubPage() {
  const t = await getTranslations("selectClub");
  const tApp = await getTranslations("app");
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/no-access");
  if (memberships.length === 1) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        {tApp("name")}
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <ClubPicker
          clubs={memberships.map((membership) => ({
            id: membership.tenantId,
            name: membership.tenantName,
            roleName: membership.roleName,
          }))}
        />
      </Card>
    </div>
  );
}
