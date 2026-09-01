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
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span>
        {t.rich("message", {
          club: tenantName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 border-amber-500/40 bg-transparent hover:bg-amber-500/20"
        disabled={isPending}
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
        {t("leave")}
      </Button>
    </div>
  );
}
