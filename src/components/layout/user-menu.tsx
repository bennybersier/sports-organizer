"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Languages, LogOut, Palette, Settings2, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut } from "@/server/actions/auth";
import { LocaleToggle } from "./locale-toggle";
import { ThemeToggle } from "./theme-toggle";

export interface UserMenuUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  /** Their role in the active club, shown under the name in place of the email. */
  role?: string;
}

export function UserMenu({ user }: { user: UserMenuUser }) {
  const { isMobile } = useSidebar();
  const t = useTranslations("common");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="pr-10 data-[state=open]:bg-sidebar-accent"
              aria-label={t("accountMenu")}
            >
              <Avatar className="size-8 rounded-lg">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                <AvatarFallback className="rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                {user.role ? (
                  <span className="label-caps truncate text-sidebar-primary">
                    {user.role}
                  </span>
                ) : (
                  <span className="truncate text-xs text-sidebar-foreground/60">{user.email}</span>
                )}
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            align="end"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="grid text-sm">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account">
                <UserRound aria-hidden />
                {t("yourProfile")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/preferences">
                <Settings2 aria-hidden />
                {t("preferences")}
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette aria-hidden />
                {t("theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <ThemeToggle />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages aria-hidden />
                {t("language")}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <LocaleToggle />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              {/* A form post, so signing out is never triggered by a prefetch. */}
              <form action={signOut}>
                <button type="submit" className="flex w-full items-center gap-2">
                  <LogOut aria-hidden />
                  {t("signOut")}
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Sign out in one tap, as well as from the menu. A form post, as below. */}
        <form action={signOut}>
          <SidebarMenuAction
            type="submit"
            className="top-3! size-6"
            aria-label={t("signOut")}
            title={t("signOut")}
          >
            <LogOut aria-hidden />
          </SidebarMenuAction>
        </form>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}
