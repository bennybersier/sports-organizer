"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action";

/**
 * Runs a Server Action with the handling every call site needs anyway:
 * a toast on success, a translated toast on failure, and a refresh so the
 * server-rendered list reflects the change.
 *
 * Actions return a discriminated result rather than throwing, so there is no
 * try/catch here — a failure is an ordinary value.
 */
export function useAction() {
  const router = useRouter();
  const tErrors = useTranslations("errors");
  const [isPending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    options: { success?: (data: T) => string; onSuccess?: (data: T) => void } = {},
  ) {
    startTransition(async () => {
      const result = await action();

      if (!result.ok) {
        /*
          A validation failure names the fields it rejected, and for a form that
          can highlight them the generic sentence is right. Several of these
          surfaces cannot — a register is a table of rows, and an error at
          `lines.4.note` has no input to mark — so telling somebody to check the
          highlighted fields when nothing is highlighted is worse than saying
          nothing. Where there is a specific complaint, show it.
        */
        const specific = Object.values(result.error.fieldErrors ?? {})
          .flat()
          .find(Boolean);

        toast.error(specific ?? result.error.message ?? tErrors(result.error.code));
        return;
      }

      if (options.success) toast.success(options.success(result.data));
      options.onSuccess?.(result.data);
      router.refresh();
    });
  }

  return { run, isPending };
}
