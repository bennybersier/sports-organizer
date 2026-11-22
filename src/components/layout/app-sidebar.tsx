"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAVIGATION, type NavSection } from "@/domain/navigation";

import { ClubBrand } from "./club-brand";
import { TenantSwitcher, type TenantOption } from "./tenant-switcher";
import { UserMenu, type UserMenuUser } from "./user-menu";

export interface AppSidebarProps {
  tenants: TenantOption[];
  activeTenantId: string;
  user: UserMenuUser;
  /** Permission keys the signed-in user holds in the active club. */
  permissions: string[];
  /** Platform staff inside a club they don't belong to. See StaffBanner. */
  isActingAsStaff?: boolean;
}

export function AppSidebar({
  tenants,
  activeTenantId,
  user,
  permissions,
  isActingAsStaff = false,
}: AppSidebarProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tStaff = useTranslations("staffBanner");
  const tApp = useTranslations("app");
  const granted = new Set(permissions);

  /*
    On a phone the sidebar is a sheet drawn over the page. Tapping a link
    navigates underneath it and leaves the drawer sitting open on top of the
    page it just asked for, so it has to be dismissed by hand before anything
    can be read. Closing on navigation is what a drawer is expected to do.

    Only on mobile: on a desktop the sidebar is permanent furniture, and
    collapsing it every time someone changes page would be maddening.
  */
  const { isMobile, setOpenMobile } = useSidebar();
  const dismissOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const sections: NavSection[] = NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || granted.has(item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {tenants.length > 1 ? (
          <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="h-14" asChild>
                <Link href="/dashboard" onClick={dismissOnMobile}>
                  <ClubBrand name={tenants[0]?.name ?? tApp("name")} subtitle={tApp("name")} />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {/*
          Repeated from the banner over the page, because the banner scrolls
          out of sight and this does not.
        */}
        {isActingAsStaff ? (
          <div className="label-caps flex items-center gap-2 rounded-md border border-sidebar-primary/30 bg-sidebar-primary/10 px-2.5 py-2 text-sidebar-primary group-data-[collapsible=icon]:hidden">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            {tStaff("mode")}
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.labelKey}>
            <SidebarGroupLabel className="label-caps text-sidebar-foreground/50">
              {t(section.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={t(item.titleKey)}
                        className="h-9 text-sidebar-foreground/80 data-active:bg-sidebar-primary data-active:font-semibold data-active:text-sidebar-primary-foreground data-active:shadow-sm"
                      >
                        <Link
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          onClick={dismissOnMobile}
                        >
                          <item.icon aria-hidden />
                          <span>{t(item.titleKey)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
