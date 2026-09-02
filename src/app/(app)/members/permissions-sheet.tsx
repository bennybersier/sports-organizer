"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Minus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import {
  getPermissionMatrixAction,
  type PermissionMatrixRow,
} from "@/server/actions/permissions-read";
import { setOverrideAction } from "@/server/actions/members";
import { cn } from "@/lib/utils";

type Effect = "INHERIT" | "ALLOW" | "DENY";

/**
 * Per-user permission overrides.
 *
 * Three states, not two: a permission comes from the role by default, and can
 * be explicitly always-allowed or never-allowed for this person. Removing an
 * override restores the role's default — which is why "From role" is a distinct
 * choice from "Never allow", and why the resolution order is
 * `override > role > deny`.
 */
export function PermissionsSheet({
  userId,
  name,
  open,
  onOpenChange,
}: {
  userId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("members");
  const { run, isPending } = useAction();
  const [rows, setRows] = useState<PermissionMatrixRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPermissionMatrixAction(userId).then((result) => {
      if (!cancelled && result.ok) setRows(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const categories = [...new Set((rows ?? []).map((row) => row.category))];

  function change(row: PermissionMatrixRow, effect: Effect) {
    // Update locally first so the matrix doesn't jump while the server catches
    // up; the refresh from useAction reconciles it.
    setRows((current) =>
      (current ?? []).map((candidate) =>
        candidate.key === row.key
          ? {
              ...candidate,
              override: effect === "INHERIT" ? null : effect,
              effective: effect === "INHERIT" ? candidate.fromRole : effect === "ALLOW",
            }
          : candidate,
      ),
    );

    run(() => setOverrideAction({ userId, permissionKey: row.key, effect }), {
      success: () => t("overrideSaved"),
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("permissionsFor", { name })}</SheetTitle>
          <SheetDescription>{t("permissionsBody")}</SheetDescription>
        </SheetHeader>

        {rows === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-10rem)] px-4">
            <div className="space-y-6 pb-8">
              {categories.map((category) => (
                <section key={category}>
                  <h3 className="sticky top-0 bg-background py-1 text-sm font-medium">
                    {category}
                  </h3>
                  <ul className="space-y-1">
                    {rows
                      .filter((row) => row.category === category)
                      .map((row) => (
                        <li
                          key={row.key}
                          className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">{row.description}</p>
                            <p className="font-mono text-xs text-muted-foreground">{row.key}</p>
                          </div>

                          {row.override ? (
                            <Badge variant="secondary">{t("overridden")}</Badge>
                          ) : null}

                          <Tabs
                            value={row.override ?? "INHERIT"}
                            onValueChange={(value) => change(row, value as Effect)}
                          >
                            <TabsList className="h-8">
                              <TabsTrigger
                                value="INHERIT"
                                disabled={isPending}
                                className="px-2"
                                aria-label={t("inherit")}
                                title={t("inherit")}
                              >
                                <Minus className="size-3.5" aria-hidden />
                              </TabsTrigger>
                              <TabsTrigger
                                value="ALLOW"
                                disabled={isPending}
                                className="px-2"
                                aria-label={t("allow")}
                                title={t("allow")}
                              >
                                <Check className="size-3.5" aria-hidden />
                              </TabsTrigger>
                              <TabsTrigger
                                value="DENY"
                                disabled={isPending}
                                className="px-2"
                                aria-label={t("deny")}
                                title={t("deny")}
                              >
                                <X className="size-3.5" aria-hidden />
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>

                          {/* The resolved answer, never colour alone. */}
                          <span
                            className={cn(
                              "w-16 shrink-0 text-right text-xs font-medium",
                              row.effective
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {row.effective ? t("allow") : t("deny")}
                          </span>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
