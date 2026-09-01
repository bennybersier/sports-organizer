import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MailQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, getIsPlatformAdmin, getMemberships } from "@/server/auth/context";
import { signOut } from "@/server/actions/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("noAccess");
  return { title: t("title") };
}

/**
 * Signed in, but not a member of any club.
 *
 * This is the intended landing spot for a Google sign-in by someone who was
 * never invited: authentication succeeded, but authentication is not
 * membership, and no club membership is ever created implicitly.
 */
export default async function NoAccessPage() {
  const t = await getTranslations("noAccess");
  const tCommon = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [memberships, isPlatformAdmin] = await Promise.all([
    getMemberships(),
    getIsPlatformAdmin(),
  ]);
  if (memberships.length > 0) redirect("/dashboard");
  if (isPlatformAdmin) redirect("/admin");

  return (
    <Card>
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MailQuestion className="size-5" aria-hidden />
        </div>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
<CardDescription>{t("body", { email: user.email })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full">
            {tCommon("signOut")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
