"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { setActiveTenant } from "@/server/actions/auth";
import { toast } from "sonner";

import { ClubBrand } from "./club-brand";

export interface TenantOption {
  id: string;
  name: string;
  roleName: string;
}

/**
 * Club switcher.
 *
 * Selecting a club only writes a cookie; the server re-resolves membership on
 * every request, so this can never grant access to a club the user isn't in.
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: TenantOption[];
  activeTenantId: string;
}) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const t = useTranslations("tenantSwitcher");
  const tErrors = useTranslations("errors");
  const tApp = useTranslations("app");
  const [isPending, startTransition] = useTransition();

  const active = tenants.find((tenant) => tenant.id === activeTenantId) ?? tenants[0];

  function switchTo(tenantId: string) {
    if (tenantId === activeTenantId) return;
    startTransition(async () => {
      const result = await setActiveTenant(tenantId);
      if (!result.ok) {
        toast.error(result.error.message || tErrors(result.error.code));
        return;
      }
      // Land on the dashboard: the current page may not exist for this club.
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              disabled={isPending}
              className="h-14 data-[state=open]:bg-sidebar-accent"
              aria-label={t("currentClub", { name: active?.name ?? "" })}
            >
              <ClubBrand name={active?.name ?? ""} subtitle={tApp("name")} pending={isPending} />
              <ChevronsUpDown className="ml-auto size-4" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("yourClubs")}
            </DropdownMenuLabel>
            {tenants.map((tenant) => (
              <DropdownMenuItem key={tenant.id} onSelect={() => switchTo(tenant.id)}>
                <span className="flex-1 truncate">{tenant.name}</span>
                {tenant.id === activeTenantId ? (
                  <Check className="size-4" aria-label={t("current")} />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
