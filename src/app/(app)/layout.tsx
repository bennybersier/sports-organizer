import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { getAuthContext, getCurrentUser, getMemberships } from "@/server/auth/context";

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

  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/no-access");

  const context = await getAuthContext();
  // Belongs to several clubs but hasn't picked one (or the cookie is stale).
  if (!context) redirect("/select-club");

  return (
    <SidebarProvider>
      <AppSidebar
        tenants={memberships.map((membership) => ({
          id: membership.tenantId,
          name: membership.tenantName,
          roleName: membership.roleName,
        }))}
        activeTenantId={context.tenant.id}
        user={{
          name: user.fullName ?? user.email,
          email: user.email,
          avatarUrl: user.avatarUrl,
        }}
        permissions={[...context.permissions]}
      />

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{context.tenant.name}</span>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
