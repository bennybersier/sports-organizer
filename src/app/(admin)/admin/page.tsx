import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Building2, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/server/auth/context";
import { fromDatabaseError } from "@/lib/errors";

import { TenantTable } from "./tenant-table";
import { CreateTenantDialog } from "./create-tenant-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("title") };
}

/**
 * The platform console.
 *
 * Only reachable by system staff — `requirePlatformAdmin` throws otherwise, and
 * `admin_list_tenants` returns nothing to anyone else regardless, so the guard
 * is enforced in the database as well as here.
 */
export default async function AdminPage() {
  const user = await requirePlatformAdmin();
  const t = await getTranslations("admin");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_tenants");
  if (error) throw fromDatabaseError(error, { resource: "club" });

  const tenants = data ?? [];

  return (
    <div className="flex w-full flex-col gap-6 p-6 md:p-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("signedInAs", { email: user.email })}</p>
        </div>
        <CreateTenantDialog defaultOwnerEmail={user.email} />
      </div>

      <Alert>
        <ShieldAlert aria-hidden />
        <AlertTitle>{t("systemAccessTitle")}</AlertTitle>
<AlertDescription>{t("systemAccessBody")}</AlertDescription>
      </Alert>

      {tenants.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Building2 className="size-5" aria-hidden />
            </div>
            <CardTitle>{t("noClubsTitle")}</CardTitle>
<CardDescription>{t("noClubsBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateTenantDialog defaultOwnerEmail={user.email} />
          </CardContent>
        </Card>
      ) : (
        <TenantTable tenants={tenants} />
      )}
    </div>
  );
}
