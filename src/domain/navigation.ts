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
  Swords,
  Sparkles,
  Trophy,
  UserCog,
  Users,
} from "lucide-react";

import type messages from "../../messages/en.json";

import type { Permission } from "./permissions";

/**
 * Keys of the `nav` message catalogue. Typing these as a union rather than
 * `string` means a nav label that has no translation is a build error, not a
 * raw key rendered into the sidebar.
 */
type NavMessageKey = keyof typeof messages.nav;

export interface NavItem {
  /** Key into the `nav` message catalogue, resolved where it is rendered. */
  titleKey: NavMessageKey;
  href: string;
  icon: LucideIcon;
  /** Hidden when the user lacks this. Hiding is never the authorization check. */
  permission?: Permission;
}

export interface NavSection {
  /** Key into the `nav` message catalogue. */
  labelKey: NavMessageKey;
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
    labelKey: "overview",
    items: [
      { titleKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
      { titleKey: "calendar", href: "/calendar", icon: CalendarDays, permission: "calendar.read" },
      { titleKey: "organizer", href: "/organizer", icon: Sparkles, permission: "schedule.generate" },
    ],
  },
  {
    labelKey: "club",
    items: [
      { titleKey: "seasons", href: "/seasons", icon: Trophy, permission: "seasons.read" },
      { titleKey: "teams", href: "/teams", icon: Users, permission: "teams.read" },
      { titleKey: "athletes", href: "/athletes", icon: Dumbbell, permission: "athletes.read" },
      { titleKey: "trainers", href: "/trainers", icon: UserCog, permission: "trainers.read" },
      { titleKey: "gyms", href: "/gyms", icon: MapPin, permission: "gyms.read" },
      {
        titleKey: "competitions",
        href: "/competitions",
        icon: Swords,
        permission: "competitions.read",
      },
    ],
  },
  {
    labelKey: "administration",
    items: [
      { titleKey: "members", href: "/members", icon: Building2, permission: "members.read" },
      { titleKey: "integrations", href: "/integrations", icon: Plug, permission: "integrations.read" },
      { titleKey: "auditLog", href: "/audit-log", icon: ScrollText, permission: "audit_logs.read" },
      { titleKey: "settings", href: "/settings", icon: Settings, permission: "tenant.read" },
    ],
  },
];
