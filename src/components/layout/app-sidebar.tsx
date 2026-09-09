"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";

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

import { TenantSwitcher, type TenantOption } from "./tenant-switcher";
import { UserMenu, type UserMenuUser } from "./user-menu";

export interface AppSidebarProps {
  tenants: TenantOption[];
  activeTenantId: string;
  user: UserMenuUser;
  /** Permission keys the signed-in user holds in the active club. */
  permissions: string[];
}

export function AppSidebar({ tenants, activeTenantId, user, permissions }: AppSidebarProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
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
              <SidebarMenuButton size="lg" asChild>
                <Link href="/dashboard" onClick={dismissOnMobile}>
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <CalendarClock className="size-4" aria-hidden />
                  </span>
                  <span className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {tenants[0]?.name ?? "Sport Club Organizer"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {tenants[0]?.roleName}
                    </span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.labelKey}>
            <SidebarGroupLabel>{t(section.labelKey)}</SidebarGroupLabel>
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

      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
