"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { leaveTenantAsStaff } from "@/server/actions/platform-admin";

/**
 * Shown whenever platform staff are working inside a club they don't belong to.
 *
 * The bypass is powerful, so it is never invisible: the person using it sees
 * this the whole time, and the club sees the corresponding audit entry.
 */
export function StaffBanner({ tenantName }: { tenantName: string }) {
  const router = useRouter();
  const t = useTranslations("staffBanner");
  const tErrors = useTranslations("errors");
  const [isPending, startTransition] = useTransition();

  return (
    <div
      role="status"
      data-slot="staff-banner"
      className="mx-4 mt-4 flex items-center gap-x-3 gap-y-2 rounded-lg border border-orange-500/30 bg-orange-500/5 p-2 text-sm sm:flex-wrap sm:p-3 md:mx-6"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/15 text-orange-600 dark:text-orange-400">
        <ShieldAlert className="size-4" aria-hidden />
      </span>
      {/*
        One line on a phone: the full sentence wraps into a column of words
        there and pushes the page a screen down. The short form says who and
        where; the sidebar chip and the audit log carry the rest.
      */}
      <span className="min-w-0 flex-1 truncate sm:hidden">
        {t.rich("short", {
          club: tenantName,
          strong: (chunks) => (
            <strong className="text-orange-700 dark:text-orange-400">{chunks}</strong>
          ),
        })}
      </span>
      <span className="hidden min-w-0 flex-1 sm:inline">
        {t.rich("message", {
          club: tenantName,
          strong: (chunks) => (
            <strong className="text-orange-700 dark:text-orange-400">{chunks}</strong>
          ),
        })}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0 border-orange-500/30 bg-transparent hover:bg-orange-500/10 max-sm:size-8 max-sm:px-0"
        disabled={isPending}
        aria-label={t("leave")}
        onClick={() =>
          startTransition(async () => {
            const result = await leaveTenantAsStaff();
            if (!result.ok) {
              toast.error(result.error.message || tErrors(result.error.code));
              return;
            }
            router.push("/admin");
            router.refresh();
          })
        }
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        <span className="max-sm:hidden">{t("leave")}</span>
      </Button>
    </div>
  );
}
