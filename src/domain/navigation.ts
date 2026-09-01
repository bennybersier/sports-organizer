import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarDays,
  Dumbbell,
  LayoutDashboard,
  MapPin,
  Plug,
  ScrollText,
  Settings,
  Sparkles,
  Trophy,
  UserCog,
  Users,
} from "lucide-react";

import type { Permission } from "./permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Hidden when the user lacks this. Hiding is never the authorization check. */
  permission?: Permission;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * The sidebar, defined once.
 *
 * Items are filtered by permission so people aren't shown doors they can't
 * open — but the page behind each one re-checks server-side. Hidden UI is a
 * courtesy, not a control.
 */
export const NAVIGATION: NavSection[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Calendar", href: "/calendar", icon: CalendarDays, permission: "calendar.read" },
      { title: "Smart Organizer", href: "/organizer", icon: Sparkles, permission: "schedule.generate" },
    ],
  },
  {
    label: "Club",
    items: [
      { title: "Seasons", href: "/seasons", icon: Trophy, permission: "seasons.read" },
      { title: "Teams", href: "/teams", icon: Users, permission: "teams.read" },
      { title: "Athletes", href: "/athletes", icon: Dumbbell, permission: "athletes.read" },
      { title: "Trainers", href: "/trainers", icon: UserCog, permission: "trainers.read" },
      { title: "Gyms", href: "/gyms", icon: MapPin, permission: "gyms.read" },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Members", href: "/members", icon: Building2, permission: "members.read" },
      { title: "Integrations", href: "/integrations", icon: Plug, permission: "integrations.read" },
      { title: "Audit log", href: "/audit-log", icon: ScrollText, permission: "audit_logs.read" },
      { title: "Settings", href: "/settings", icon: Settings, permission: "tenant.read" },
    ],
  },
];
