"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const granted = new Set(permissions);

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
                <Link href="/dashboard">
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
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
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
                        tooltip={item.title}
                      >
                        <Link href={item.href} aria-current={isActive ? "page" : undefined}>
                          <item.icon aria-hidden />
                          <span>{item.title}</span>
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
