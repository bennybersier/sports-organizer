import type { Metadata } from "next";
import { Building2, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/server/auth/context";
import { fromDatabaseError } from "@/lib/errors";

import { TenantTable } from "./tenant-table";
import { CreateTenantDialog } from "./create-tenant-dialog";

export const metadata: Metadata = { title: "System console" };

/**
 * The platform console.
 *
 * Only reachable by system staff — `requirePlatformAdmin` throws otherwise, and
 * `admin_list_tenants` returns nothing to anyone else regardless, so the guard
 * is enforced in the database as well as here.
 */
export default async function AdminPage() {
  const user = await requirePlatformAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_tenants");
  if (error) throw fromDatabaseError(error, { resource: "club" });

  const tenants = data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 md:p-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System console</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user.email} — platform administrator.
          </p>
        </div>
        <CreateTenantDialog defaultOwnerEmail={user.email} />
      </div>

      <Alert>
        <ShieldAlert aria-hidden />
        <AlertTitle>You have system-wide access</AlertTitle>
        <AlertDescription>
          You can read and administer every club here without being a member of any of
          them. Entering a club is written to that club&apos;s audit log, and the app shows
          a banner while you&apos;re inside one.
        </AlertDescription>
      </Alert>

      {tenants.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Building2 className="size-5" aria-hidden />
            </div>
            <CardTitle>No clubs yet</CardTitle>
            <CardDescription>
              Create the first club to get started. You&apos;ll pick an Owner for it — that
              person needs an account already, since accounts are never created implicitly.
            </CardDescription>
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
