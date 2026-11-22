"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, Share2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { setTeamPublicPageAction } from "@/server/actions/teams";

/**
 * The link a coach drops in the parents' WhatsApp group.
 *
 * Anyone with `teams.read` can copy a link that exists; only `teams.update`
 * can make one, replace it or turn it off. Replacing is the only way to take
 * a link back once it has been forwarded, so it is offered beside the link
 * rather than hidden.
 */
export function PublicPageDialog({
  teamId,
  token,
  canManage,
}: {
  teamId: string;
  token: string | null;
  canManage: boolean;
}) {
  const t = useTranslations("publicTeam");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [confirming, setConfirming] = useState<"rotate" | "disable" | null>(null);

  // Read on render rather than from config: the link should be the address the
  // coach is actually using, preview deployments included. The content only
  // renders once the dialog opens, which is always in the browser.
  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/public/teams/${token}`
      : null;

  function set(enabled: boolean, success: string) {
    run(() => setTeamPublicPageAction(teamId, enabled), { success: () => success });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tCommon("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  if (!token && !canManage) return null;

  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Share2 aria-hidden />
            {t("shareButton")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("shareTitle")}</DialogTitle>
            <DialogDescription>{t("shareHint")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="label-caps text-muted-foreground">{t("shown")}</p>
              <ul className="space-y-1">
                {(["shownRoster", "shownFixtures", "shownResults", "shownTraining"] as const).map((key) => (
                  <li key={key} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <p className="label-caps text-muted-foreground">{t("hidden")}</p>
              <ul className="space-y-1">
                {(["hiddenAthletes", "hiddenStaff", "hiddenNotes"] as const).map((key) => (
                  <li key={key} className="flex gap-2">
                    <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {url ? (
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label={t("linkLabel")}
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button variant="outline" size="icon" onClick={copy} aria-label={tCommon("copy")}>
                <Copy aria-hidden />
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("open")}>
                  <ExternalLink aria-hidden />
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("off")}</p>
          )}

          {canManage ? (
            <DialogFooter className="gap-2 sm:justify-between">
              {token ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setConfirming("disable")}
                  >
                    {t("disable")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setConfirming("rotate")}
                  >
                    {t("rotate")}
                  </Button>
                </>
              ) : (
                <Button disabled={isPending} onClick={() => set(true, t("enabled"))}>
                  {t("enable")}
                </Button>
              )}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming === "disable" ? t("disableTitle") : t("rotateTitle")}
        description={t("revokeWarning")}
        confirmLabel={confirming === "disable" ? t("disable") : t("rotate")}
        onConfirm={() => {
          if (confirming === "disable") set(false, t("disabled"));
          else set(true, t("rotated"));
          setConfirming(null);
        }}
      />
    </>
  );
}
