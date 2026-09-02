import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { StaffBanner } from "@/components/layout/staff-banner";
import {
  getAuthContext,
  getCurrentUser,
  getIsPlatformAdmin,
  getMemberships,
} from "@/server/auth/context";

/**
 * The authenticated app shell.
 *
 * Resolves the auth context once per request — user, active club, role and
 * fully-resolved permissions — and hands the permission set to the sidebar so
 * navigation matches what the user can actually do. Pages beneath still perform
 * their own `requirePermission` checks.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [memberships, isPlatformAdmin] = await Promise.all([
    getMemberships(),
    getIsPlatformAdmin(),
  ]);

  const context = await getAuthContext();

  if (!context) {
    // Platform staff belong to no club, so the console — not the club picker —
    // is their home.
    if (isPlatformAdmin) redirect("/admin");
    if (memberships.length === 0) redirect("/no-access");
    // Belongs to several clubs but hasn't picked one (or the cookie is stale).
    redirect("/select-club");
  }

  const t = await getTranslations("common");
  const skipToContent = t("skipToContent");

  return (
    <SidebarProvider>
      {/*
        The sidebar carries ~15 links before the page content. Without this, a
        keyboard or screen-reader user tabs through all of them on every
        navigation.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        {skipToContent}
      </a>

      <AppSidebar
        tenants={
          memberships.length > 0
            ? memberships.map((membership) => ({
                id: membership.tenantId,
                name: membership.tenantName,
                roleName: membership.roleName,
              }))
            : [
                {
                  id: context.tenant.id,
                  name: context.tenant.name,
                  roleName: context.role.name,
                },
              ]
        }
        activeTenantId={context.tenant.id}
        user={{
          name: user.fullName ?? user.email,
          email: user.email,
          avatarUrl: user.avatarUrl,
        }}
        permissions={[...context.permissions]}
      />

      <SidebarInset>
        {context.isActingAsStaff ? <StaffBanner tenantName={context.tenant.name} /> : null}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{context.tenant.name}</span>
        </header>
        <div id="main-content" tabIndex={-1} className="flex-1 p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
