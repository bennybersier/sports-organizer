import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { UserMenuStandalone } from "@/components/layout/user-menu-standalone";
import { requirePlatformAdmin } from "@/server/auth/context";
import { getCurrentUser } from "@/server/auth/context";

/**
 * Shell for the platform console.
 *
 * Deliberately not the club sidebar: staff here are outside every club, and the
 * chrome should make that unambiguous rather than looking like normal club use.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-muted/40 px-4 md:px-6">
        <Link href="/admin" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <CalendarClock className="size-4" aria-hidden />
          </span>
          Sport Club Organizer
        </Link>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          System
        </span>
        <div className="ml-auto">
          {user ? (
            <UserMenuStandalone
              user={{
                name: user.fullName ?? user.email,
                email: user.email,
                avatarUrl: user.avatarUrl,
              }}
            />
          ) : null}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
